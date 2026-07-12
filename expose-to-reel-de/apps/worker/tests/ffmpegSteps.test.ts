import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ffprobe, runFfmpeg } from "@e2r/shared/ffmpeg";
import {
  audioDurationSec,
  buildSegmentedVoiceover,
  buildSrt,
  mixAudio,
  renderEndCard,
  totalDurationWithCrossfade,
} from "../src/pipeline/ffmpegSteps";

describe("Crossfade-Timing", () => {
  test("Gesamtdauer schrumpft um (n−1)·Blende", () => {
    expect(totalDurationWithCrossfade([4, 4, 4], 0.35)).toBeCloseTo(11.3, 5);
    expect(totalDurationWithCrossfade([4], 0.35)).toBe(4);
    expect(totalDurationWithCrossfade([3, 2], 0)).toBe(5);
    expect(totalDurationWithCrossfade([], 0.35)).toBe(0);
  });

  test("SRT-Cues folgen den Szenenwechseln inkl. Überblendungs-Versatz", () => {
    const srt = buildSrt(
      [
        { text: "Intro", durationSec: 4 },
        { text: "Wohnzimmer", durationSec: 4 },
        { text: "Küche", durationSec: 4 },
      ],
      0.35
    );
    // Szene 2 startet bei 4 − 0,35 = 3,65 s; Szene 3 bei 7,3 s.
    expect(srt).toContain("00:00:00,000 --> 00:00:03,550\nIntro");
    expect(srt).toContain("00:00:03,650 --> 00:00:07,200\nWohnzimmer");
    expect(srt).toContain("00:00:07,300 --> 00:00:11,200\nKüche");
  });

  test("ohne Überblendung bleibt das alte Timing erhalten", () => {
    const srt = buildSrt([
      { text: "A", durationSec: 2 },
      { text: "B", durationSec: 2 },
    ]);
    expect(srt).toContain("00:00:00,000 --> 00:00:01,900\nA");
    expect(srt).toContain("00:00:02,000 --> 00:00:03,900\nB");
  });
});

describe("Endkarte & Audio-Mix (ffmpeg)", () => {
  test("rendert eine Endkarte mit korrekter Auflösung und Dauer", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-test-"));
    try {
      const outputPath = path.join(tempDir, "endcard.mp4");
      const rendered = await renderEndCard(
        [
          { text: "Helle 3-Zimmer-Wohnung", scale: 0.055 },
          { text: "04155 Leipzig", scale: 0.035 },
          { text: "Demo Immobilien GmbH", scale: 0.027 },
        ],
        outputPath,
        { width: 1280, height: 720, durationSec: 2, fps: 25 }
      );
      expect(rendered).toBe(true);
      const probe = await ffprobe(outputPath);
      const video = probe.streams.find((s) => s.codec_type === "video");
      expect(video?.codec_name).toBe("h264");
      expect(video?.width).toBe(1280);
      expect(Number(probe.format.duration)).toBeCloseTo(2, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("mischt einen Musik-Track unter ein Video (Audio-Stream vorhanden)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-test-"));
    try {
      const videoPath = path.join(tempDir, "video.mp4");
      const musicPath = path.join(tempDir, "ton.wav");
      // Stummes Testvideo + Sinuston als „Musik“ erzeugen.
      await runFfmpeg([
        "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=4:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath,
      ]);
      await runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        musicPath,
      ]);

      const mixedPath = path.join(tempDir, "mixed.mp4");
      await mixAudio(videoPath, mixedPath, {
        musicPath,
        voiceoverPath: null,
        videoDurationSec: 4,
      });

      const probe = await ffprobe(mixedPath);
      const video = probe.streams.find((s) => s.codec_type === "video");
      const audio = probe.streams.find((s) => s.codec_type === "audio");
      expect(video?.codec_name).toBe("h264");
      expect(audio?.codec_name).toBe("aac");
      // Loop + -t: Audio läuft über die volle Videolänge trotz 1-s-Quelle.
      expect(Number(probe.format.duration)).toBeCloseTo(4, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("mischt eine fertig getimte Voiceover-Spur ohne Verzögerung (voiceoverDelayMs: 0)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-test-"));
    try {
      const videoPath = path.join(tempDir, "video.mp4");
      const voiceoverPath = path.join(tempDir, "voice.wav");
      await runFfmpeg([
        "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath,
      ]);
      await runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        voiceoverPath,
      ]);

      const mixedPath = path.join(tempDir, "mixed.mp4");
      await mixAudio(videoPath, mixedPath, {
        musicPath: null,
        voiceoverPath,
        videoDurationSec: 2,
        voiceoverDelayMs: 0,
      });

      const probe = await ffprobe(mixedPath);
      const audio = probe.streams.find((s) => s.codec_type === "audio");
      expect(audio?.codec_name).toBe("aac");
      // Audio bleibt trotz 1-s-Quelle im Rahmen der Videolänge.
      expect(Number(probe.format.duration)).toBeCloseTo(2, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("buildSegmentedVoiceover", () => {
  test("setzt Segmente an ihre Startzeiten und füllt auf Gesamtlänge auf", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "e2r-vo-"));
    try {
      const seg = path.join(dir, "seg.wav");
      await runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:a", "pcm_s16le", seg,
      ]);
      expect(await audioDurationSec(seg)).toBeCloseTo(1, 1);

      const out = path.join(dir, "voiceover.m4a");
      await buildSegmentedVoiceover(
        [
          { path: seg, startSec: 0.3 },
          { path: seg, startSec: 4.0, maxDurationSec: 0.5 },
        ],
        8,
        out
      );
      expect(await audioDurationSec(out)).toBeCloseTo(8, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
