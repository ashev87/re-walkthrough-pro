import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildFactLine,
  buildLocationLine,
  getStorage,
  getVideoProvider,
  prisma,
  projectStorageKey,
  recordAudit,
  ROOM_LABEL_NAMES,
  sha256Hex,
} from "@e2r/shared";
import type { MediaKind, Prisma, Shot } from "@prisma/client";
import {
  buildSrt,
  concatClips,
  extractPoster,
  normalizeImage,
  validateOutput,
  type CaptionCue,
} from "./ffmpegSteps";

/**
 * Verarbeitet einen GenerationJob vollständig: Normalisierung → Szenen
 * (16:9 und 9:16) → Konkatenation → Poster → Untertitel → Validierung →
 * VideoVersion. Ausgelegt auf Fortschritts-Updates, Abbruch und Retries.
 */

export const FPS = 25;
export const MASTER = { width: 1920, height: 1080, suffix: "16x9" } as const;
export const REEL = { width: 1080, height: 1920, suffix: "9x16" } as const;

export class JobCancelledError extends Error {
  constructor() {
    super("Generierung wurde abgebrochen.");
    this.name = "JobCancelledError";
  }
}

export interface ProcessHooks {
  /** BullMQ-Progress (0–100) — optional für Tests. */
  onProgress?(percent: number, step: string): Promise<void> | void;
}

async function isCancelRequested(generationJobId: string): Promise<boolean> {
  const job = await prisma.generationJob.findUnique({
    where: { id: generationJobId },
    select: { cancelRequested: true },
  });
  return job?.cancelRequested ?? false;
}

async function updateProgress(
  generationJobId: string,
  percent: number,
  step: string,
  hooks: ProcessHooks
): Promise<void> {
  await prisma.generationJob.update({
    where: { id: generationJobId },
    data: { progress: Math.min(100, Math.round(percent)), currentStep: step },
  });
  await hooks.onProgress?.(percent, step);
}

async function upsertAsset(input: {
  projectId: string;
  kind: MediaKind;
  storageKey: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  width?: number | null;
  height?: number | null;
}): Promise<string> {
  const storage = getStorage();
  await storage.put(input.storageKey, input.data, input.mimeType);
  const asset = await prisma.mediaAsset.upsert({
    where: { storageKey: input.storageKey },
    update: {
      sizeBytes: input.data.length,
      sha256: sha256Hex(input.data),
      width: input.width ?? null,
      height: input.height ?? null,
    },
    create: {
      projectId: input.projectId,
      kind: input.kind,
      storageKey: input.storageKey,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      sha256: sha256Hex(input.data),
      width: input.width ?? null,
      height: input.height ?? null,
    },
  });
  return asset.id;
}

const toNumber = (value: Prisma.Decimal | number | null): number | null =>
  value == null ? null : Number(value);

async function renderSceneWithRetry(
  provider: ReturnType<typeof getVideoProvider>,
  spec: Parameters<ReturnType<typeof getVideoProvider>["renderScene"]>[0],
  retries = 1
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await provider.renderScene(spec);
      return result.videoBytes;
    } catch (error) {
      lastError = error;
      console.warn(`[worker] Szene fehlgeschlagen (Versuch ${attempt + 1}):`, error);
    }
  }
  throw lastError;
}

export async function processGenerationJob(
  generationJobId: string,
  hooks: ProcessHooks = {}
): Promise<void> {
  const job = await prisma.generationJob.findUniqueOrThrow({
    where: { id: generationJobId },
    include: {
      project: {
        include: {
          listingData: true,
          shots: {
            where: { selected: true },
            orderBy: { sortIndex: "asc" },
            include: { mediaAsset: true },
          },
        },
      },
    },
  });
  const { project } = job;
  const shots = project.shots;
  if (shots.length === 0) {
    const message = "Keine ausgewählten Shots — Generierung nicht möglich.";
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    await prisma.propertyProject.update({
      where: { id: project.id },
      data: { status: "FAILED" },
    });
    throw new Error(message);
  }

  await prisma.generationJob.update({
    where: { id: generationJobId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });
  await prisma.propertyProject.update({
    where: { id: project.id },
    data: { status: "GENERATING" },
  });

  const storage = getStorage();
  const provider = getVideoProvider();
  const overlayLabel =
    provider.key === "mock" ? "MOCK-VORSCHAU – KEIN FINALES MATERIAL" : undefined;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-job-"));
  try {
    const totalRenderSteps = shots.length * 2;
    let completedRenders = 0;
    const clipPaths: Record<string, string[]> = { "16x9": [], "9x16": [] };

    for (const shot of shots) {
      if (await isCancelRequested(generationJobId)) throw new JobCancelledError();

      await prisma.shot.update({
        where: { id: shot.id },
        data: { status: "RENDERING", errorMessage: null },
      });
      const roomName = ROOM_LABEL_NAMES[shot.roomLabel];

      try {
        const sourceBytes = await storage.get(shot.mediaAsset.storageKey);

        // Normalisiertes Bild einmalig pro Quellbild erzeugen/wiederverwenden.
        const normalizedKey = projectStorageKey(
          project.organizationId,
          project.id,
          "normalized",
          `${shot.mediaAssetId}.jpg`
        );
        let normalizedBytes: Buffer;
        if (await storage.exists(normalizedKey)) {
          normalizedBytes = await storage.get(normalizedKey);
        } else {
          normalizedBytes = await normalizeImage(sourceBytes);
          await upsertAsset({
            projectId: project.id,
            kind: "NORMALIZED_IMAGE",
            storageKey: normalizedKey,
            filename: `${shot.mediaAssetId}.jpg`,
            mimeType: "image/jpeg",
            data: normalizedBytes,
          });
        }

        for (const target of [MASTER, REEL]) {
          if (await isCancelRequested(generationJobId)) throw new JobCancelledError();

          const clipBytes = await renderSceneWithRetry(provider, {
            imageBytes: normalizedBytes,
            prompt: shot.prompt,
            cameraMoveKey: shot.cameraMove,
            durationSec: shot.durationSec,
            width: target.width,
            height: target.height,
            fps: FPS,
            overlayLabel,
          });

          const sceneFilename = `szene-${String(shot.sortIndex + 1).padStart(2, "0")}-${shot.roomLabel.toLowerCase()}-${target.suffix}.mp4`;
          const sceneKey = projectStorageKey(
            project.organizationId,
            project.id,
            "scenes",
            `${generationJobId}/${sceneFilename}`
          );
          const sceneAssetId = await upsertAsset({
            projectId: project.id,
            kind: "SCENE_CLIP",
            storageKey: sceneKey,
            filename: sceneFilename,
            mimeType: "video/mp4",
            data: clipBytes,
            width: target.width,
            height: target.height,
          });

          const clipPath = path.join(tempDir, sceneFilename);
          await writeFile(clipPath, clipBytes);
          clipPaths[target.suffix]!.push(clipPath);

          if (target.suffix === MASTER.suffix) {
            await prisma.shot.update({
              where: { id: shot.id },
              data: { sceneAssetId },
            });
          }

          completedRenders++;
          await updateProgress(
            generationJobId,
            (completedRenders / totalRenderSteps) * 72,
            `Szene ${roomName} (${target.suffix}) gerendert`,
            hooks
          );
        }

        await prisma.shot.update({
          where: { id: shot.id },
          data: { status: "DONE" },
        });
      } catch (error) {
        if (!(error instanceof JobCancelledError)) {
          await prisma.shot.update({
            where: { id: shot.id },
            data: {
              status: "FAILED",
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          });
        }
        throw error;
      }
    }

    // --- Konkatenation ---
    const expectedDuration = shots.reduce((sum, s) => sum + s.durationSec, 0);
    const version =
      ((await prisma.videoVersion.aggregate({
        where: { projectId: project.id },
        _max: { version: true },
      }))._max.version ?? 0) + 1;

    const finals: Record<string, { assetId: string; durationSec: number }> = {};
    for (const target of [MASTER, REEL]) {
      if (await isCancelRequested(generationJobId)) throw new JobCancelledError();
      const outputPath = path.join(tempDir, `walkthrough-${target.suffix}.mp4`);
      await concatClips(clipPaths[target.suffix]!, outputPath);
      const validation = await validateOutput(outputPath, {
        width: target.width,
        height: target.height,
        durationSec: expectedDuration,
      });
      const filename = `walkthrough-${target.suffix}-v${version}.mp4`;
      const finalKey = projectStorageKey(
        project.organizationId,
        project.id,
        "final",
        filename
      );
      const { readFile } = await import("node:fs/promises");
      const finalBytes = await readFile(outputPath);
      const assetId = await upsertAsset({
        projectId: project.id,
        kind: "FINAL_VIDEO",
        storageKey: finalKey,
        filename,
        mimeType: "video/mp4",
        data: finalBytes,
        width: target.width,
        height: target.height,
      });
      finals[target.suffix] = { assetId, durationSec: validation.durationSec };
      await updateProgress(
        generationJobId,
        target.suffix === MASTER.suffix ? 80 : 88,
        `Walkthrough ${target.suffix} zusammengefügt`,
        hooks
      );
    }

    // --- Poster ---
    const masterPath = path.join(tempDir, `walkthrough-${MASTER.suffix}.mp4`);
    const posterBytes = await extractPoster(masterPath);
    const posterAssetId = await upsertAsset({
      projectId: project.id,
      kind: "POSTER",
      storageKey: projectStorageKey(
        project.organizationId,
        project.id,
        "final",
        `poster-v${version}.jpg`
      ),
      filename: `poster-v${version}.jpg`,
      mimeType: "image/jpeg",
      data: posterBytes,
      width: MASTER.width,
      height: MASTER.height,
    });
    await updateProgress(generationJobId, 92, "Posterbild erstellt", hooks);

    // --- Untertitel (nur gelieferte, freigegebene Fakten) ---
    let captionsAssetId: string | null = null;
    const listing = project.listingData;
    if (listing) {
      const introParts = [
        listing.titel,
        buildLocationLine(
          {
            plz: listing.plz,
            ort: listing.ort,
            strasse: listing.strasse,
            hausnummer: listing.hausnummer,
          },
          listing.addressVisibility
        ),
        buildFactLine({
          marketingType: listing.marketingType,
          objectType: listing.objectType,
          titel: listing.titel,
          plz: listing.plz,
          ort: listing.ort,
          kaufpreis: toNumber(listing.kaufpreis),
          kaltmiete: toNumber(listing.kaltmiete),
          zimmer: toNumber(listing.zimmer),
          wohnflaeche: toNumber(listing.wohnflaeche),
        }),
      ].filter(Boolean);

      const cues: CaptionCue[] = shots.map((shot: Shot, index: number) => ({
        text:
          index === 0
            ? `${introParts.join("\n")}`
            : ROOM_LABEL_NAMES[shot.roomLabel],
        durationSec: shot.durationSec,
      }));
      const srt = buildSrt(cues);
      captionsAssetId = await upsertAsset({
        projectId: project.id,
        kind: "CAPTIONS",
        storageKey: projectStorageKey(
          project.organizationId,
          project.id,
          "final",
          `untertitel-v${version}.srt`
        ),
        filename: `untertitel-v${version}.srt`,
        mimeType: "application/x-subrip",
        data: Buffer.from(srt, "utf8"),
      });
    }

    // --- VideoVersion + Abschluss ---
    await prisma.videoVersion.create({
      data: {
        projectId: project.id,
        generationJobId,
        version,
        master16x9AssetId: finals[MASTER.suffix]!.assetId,
        reel9x16AssetId: finals[REEL.suffix]!.assetId,
        posterAssetId,
        captionsAssetId,
        durationSec: finals[MASTER.suffix]!.durationSec,
      },
    });
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: "COMPLETED", finishedAt: new Date(), progress: 100, currentStep: "Fertig" },
    });
    await prisma.propertyProject.update({
      where: { id: project.id },
      data: { status: "READY" },
    });
    await recordAudit(prisma, {
      organizationId: project.organizationId,
      projectId: project.id,
      type: "generation.completed",
      data: { generationJobId, version },
    });
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await prisma.$transaction([
        prisma.generationJob.update({
          where: { id: generationJobId },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            currentStep: "Abgebrochen",
          },
        }),
        prisma.shot.updateMany({
          where: { projectId: project.id, status: "RENDERING" },
          data: { status: "PENDING" },
        }),
        prisma.propertyProject.update({
          where: { id: project.id },
          data: { status: "NEEDS_REVIEW" },
        }),
      ]);
      await recordAudit(prisma, {
        organizationId: project.organizationId,
        projectId: project.id,
        type: "generation.cancelled",
        data: { generationJobId },
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    await prisma.propertyProject.update({
      where: { id: project.id },
      data: { status: "FAILED" },
    });
    await recordAudit(prisma, {
      organizationId: project.organizationId,
      projectId: project.id,
      type: "generation.failed",
      data: { generationJobId, error: message },
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
