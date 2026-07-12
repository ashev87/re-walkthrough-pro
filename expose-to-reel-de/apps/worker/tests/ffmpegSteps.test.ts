import { describe, expect, test } from "vitest";
import { buildSrt, totalDurationWithCrossfade } from "../src/pipeline/ffmpegSteps";

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
