import { randomUUID } from "node:crypto";
import {
  buildShotPrompt,
  cameraMoveForRoom,
  getStorage,
  hashPassword,
  prisma,
  projectStorageKey,
  ROOM_LABEL_NAMES,
  sha256Hex,
} from "@e2r/shared";
import { ffprobe } from "@e2r/shared/ffmpeg";
import type { RoomLabel } from "@prisma/client";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CROSSFADE_SEC, processGenerationJob } from "../src/pipeline/processJob";
import { roomImage } from "../../../packages/shared/prisma/seedImages";

/**
 * Mock-Generierungsjob, kompletter Lebenszyklus — ohne Redis, direkt gegen
 * die Pipeline. Benötigt Postgres (docker compose) und ffmpeg.
 */

/** Fake-TTS: 1-Sekunden-Sinuston als MP3 (echte, ffprobe-lesbare Datei). */
const fakeTts = vi.hoisted(() => {
  let cached: Buffer | null = null;
  return {
    key: "fake",
    displayName: "Fake TTS",
    isEnabled: () => true,
    async synthesize(): Promise<Buffer> {
      if (!cached) {
        const { runFfmpeg } = await import("@e2r/shared/ffmpeg");
        const { stdout } = await runFfmpeg(
          [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "96k",
            "-f",
            "mp3",
            "pipe:1",
          ],
          { timeoutMs: 60_000 }
        );
        cached = stdout;
      }
      return cached;
    },
  };
});

vi.mock("@e2r/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@e2r/shared")>()),
  getTtsProvider: () => fakeTts,
}));

let organizationId: string;
let userId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Worker-Test-Org ${randomUUID()}` },
  });
  organizationId = organization.id;
  const user = await prisma.user.create({
    data: {
      email: `worker-${randomUUID()}@example.com`,
      name: "Worker-Test",
      passwordHash: hashPassword("test1234"),
      organizationId,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.propertyProject.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

async function createReadyProject(
  shotRooms: RoomLabel[],
  shotOptions: { narrations?: string[]; durationSec?: number } = {}
) {
  const project = await prisma.propertyProject.create({
    data: {
      organizationId,
      title: "Worker-Testprojekt",
      status: "GENERATING",
      listingData: {
        create: {
          marketingType: "MIETE",
          objectType: "Wohnung",
          titel: "Worker-Testwohnung",
          plz: "04155",
          ort: "Leipzig",
          kaltmiete: 890,
          zimmer: 3,
          wohnflaeche: 84.5,
        },
      },
      rightsAttestations: {
        create: { userId, scope: "Alle Fotos", sourceDescription: "Testbilder" },
      },
    },
  });

  const storage = getStorage();
  for (const [index, roomLabel] of shotRooms.entries()) {
    const image = roomImage([120 + index * 30, 140, 200], [240, 240, 250], index, 960, 640);
    const storageKey = projectStorageKey(
      organizationId,
      project.id,
      "source",
      `test-${index}.png`
    );
    await storage.put(storageKey, image.buffer, "image/png");
    const asset = await prisma.mediaAsset.create({
      data: {
        projectId: project.id,
        kind: "SOURCE_IMAGE",
        storageKey,
        filename: `test-${index}.png`,
        mimeType: "image/png",
        sizeBytes: image.buffer.length,
        width: image.width,
        height: image.height,
        sha256: sha256Hex(image.buffer),
        sortIndex: index,
        roomLabel,
      },
    });
    const move = cameraMoveForRoom(roomLabel);
    await prisma.shot.create({
      data: {
        projectId: project.id,
        mediaAssetId: asset.id,
        roomLabel,
        sortIndex: index,
        selected: true,
        durationSec: shotOptions.durationSec ?? 2,
        narration: shotOptions.narrations?.[index],
        cameraMove: move.key,
        prompt: buildShotPrompt({
          roomLabel,
          roomName: ROOM_LABEL_NAMES[roomLabel],
          moveInstruction: move.instruction,
        }),
      },
    });
  }
  return project;
}

describe("Mock-Generierungsjob-Lebenszyklus", () => {
  test("verarbeitet Job vollständig: Szenen, 16:9, 9:16, Poster, Untertitel", async () => {
    const project = await createReadyProject(["AUSSENANSICHT", "WOHNZIMMER"]);
    const job = await prisma.generationJob.create({
      data: { projectId: project.id, status: "QUEUED" },
    });

    const progress: number[] = [];
    await processGenerationJob(job.id, {
      onProgress: (percent) => {
        progress.push(percent);
      },
    });

    const finished = await prisma.generationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe("COMPLETED");
    expect(finished.progress).toBe(100);
    expect(progress.length).toBeGreaterThan(2);

    const updatedProject = await prisma.propertyProject.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(updatedProject.status).toBe("READY");

    const shots = await prisma.shot.findMany({ where: { projectId: project.id } });
    expect(shots.every((shot) => shot.status === "DONE")).toBe(true);
    expect(shots.every((shot) => shot.sceneAssetId)).toBeTruthy();

    const version = await prisma.videoVersion.findFirstOrThrow({
      where: { projectId: project.id },
    });
    expect(version.captionsAssetId).toBeTruthy();
    expect(version.posterAssetId).toBeTruthy();

    // Ausgaben mit ffprobe verifizieren: H.264 + exakte Zielauflösungen.
    const storage = getStorage();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-verify-"));
    const expectations: Array<[string, number, number]> = [
      [version.master16x9AssetId, 1920, 1080],
      [version.reel9x16AssetId, 1080, 1920],
    ];
    for (const [assetId, width, height] of expectations) {
      const asset = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: assetId },
      });
      const filePath = path.join(tempDir, asset.filename);
      await writeFile(filePath, await storage.get(asset.storageKey));
      const probe = await ffprobe(filePath);
      const stream = probe.streams.find((s) => s.codec_type === "video");
      expect(stream?.codec_name).toBe("h264");
      expect(stream?.width).toBe(width);
      expect(stream?.height).toBe(height);
      const duration = Number(probe.format.duration);
      expect(duration).toBeGreaterThan(3.4);
      expect(duration).toBeLessThan(4.6);
    }

    // Untertitel enthalten nur freigegebene Fakten.
    const captions = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: version.captionsAssetId! },
    });
    const srt = (await storage.get(captions.storageKey)).toString("utf8");
    expect(srt).toContain("Worker-Testwohnung");
    expect(srt).toContain("04155 Leipzig");
    expect(srt).toContain("84,5 m²");
    expect(srt).toContain("Wohnzimmer");
  });

  test("Szenen-Voiceover: gemeinsame Timeline, Narration im SRT, Voiceover-Asset", async () => {
    const project = await createReadyProject(["AUSSENANSICHT", "WOHNZIMMER"], {
      durationSec: 4,
      narrations: ["Erste Szene.", "Zweite Szene."],
    });
    const job = await prisma.generationJob.create({
      data: {
        projectId: project.id,
        status: "QUEUED",
        options: { withVoiceover: true },
      },
    });

    await processGenerationJob(job.id);

    const finished = await prisma.generationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe("COMPLETED");

    const version = await prisma.videoVersion.findFirstOrThrow({
      where: { projectId: project.id },
    });

    // Beide Formate teilen die volle Szenendauer — der alte Reel-Cap (3 s)
    // würde das 9:16-Video auf ~5,65 s kürzen.
    const minDuration = 4 + 4 - CROSSFADE_SEC - 0.4; // Toleranz für Rundung
    const storage = getStorage();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-verify-vo-"));
    const expectations: Array<[string, number, number]> = [
      [version.master16x9AssetId, 1920, 1080],
      [version.reel9x16AssetId, 1080, 1920],
    ];
    for (const [assetId, width, height] of expectations) {
      const asset = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: assetId },
      });
      const filePath = path.join(tempDir, asset.filename);
      await writeFile(filePath, await storage.get(asset.storageKey));
      const probe = await ffprobe(filePath);
      const stream = probe.streams.find((s) => s.codec_type === "video");
      expect(stream?.width).toBe(width);
      expect(stream?.height).toBe(height);
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(minDuration);
      // Voiceover muss im finalen MP4 landen (Audio-Stream vorhanden).
      expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
    }

    // SRT trägt den Szenentext (Cue 1 bleibt die Fakten-Einblendung).
    const captions = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: version.captionsAssetId! },
    });
    expect(captions.filename).toBe("untertitel-v1.srt");
    const srt = (await storage.get(captions.storageKey)).toString("utf8");
    expect(srt).toContain("Zweite Szene.");

    // Synchronisierte Voiceover-Spur wird als Asset abgelegt.
    const voiceover = await prisma.mediaAsset.findFirst({
      where: { projectId: project.id, kind: "VOICEOVER" },
    });
    expect(voiceover?.filename).toBe("voiceover-v1.m4a");
  });

  test("Abbruch: cancelRequested beendet Job als CANCELLED", async () => {
    const project = await createReadyProject(["KUECHE", "BAD"]);
    const job = await prisma.generationJob.create({
      data: { projectId: project.id, status: "QUEUED", cancelRequested: true },
    });

    await processGenerationJob(job.id);

    const finished = await prisma.generationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe("CANCELLED");
    const updatedProject = await prisma.propertyProject.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(updatedProject.status).toBe("NEEDS_REVIEW");
    const versions = await prisma.videoVersion.count({
      where: { projectId: project.id },
    });
    expect(versions).toBe(0);
  });

  test("Fehler: Job ohne Shots wird FAILED", async () => {
    const project = await prisma.propertyProject.create({
      data: { organizationId, title: "Ohne Shots", status: "GENERATING" },
    });
    const job = await prisma.generationJob.create({
      data: { projectId: project.id, status: "QUEUED" },
    });
    await expect(processGenerationJob(job.id)).rejects.toThrow();
    const finished = await prisma.generationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe("FAILED");
    expect(finished.errorMessage).toBeTruthy();
  });
});
