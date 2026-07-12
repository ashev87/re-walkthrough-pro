import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildFactLine,
  buildLocationLine,
  CAMERA_MOVES,
  ExternalImageToVideoProvider,
  getStorage,
  getTtsProvider,
  getVideoProvider,
  parseGenerationOptions,
  prisma,
  projectStorageKey,
  recordAudit,
  resolveFromWorkspaceRoot,
  ROOM_LABEL_NAMES,
  sha256Hex,
  type GenerationOptions,
} from "@e2r/shared";
import type { MediaKind, Prisma, Shot } from "@prisma/client";
import {
  audioDurationSec,
  buildSegmentedVoiceover,
  buildSrt,
  concatClips,
  extractPoster,
  mixAudio,
  normalizeImage,
  renderEndCard,
  totalDurationWithCrossfade,
  validateOutput,
  type CaptionCue,
  type ClipInput,
  type EndCardLine,
} from "./ffmpegSteps";
import {
  NARRATION_LEAD_SEC,
  resolveSceneDuration,
  sceneStartTimes,
} from "./sceneTimeline";

/**
 * Verarbeitet einen GenerationJob vollständig: Normalisierung → Szenen
 * (16:9 und 9:16) → Konkatenation → Poster → Untertitel → Validierung →
 * VideoVersion. Ausgelegt auf Fortschritts-Updates, Abbruch und Retries.
 */

export const FPS = 25;
export const MASTER = { width: 1920, height: 1080, suffix: "16x9" } as const;
export const REEL = { width: 1080, height: 1920, suffix: "9x16" } as const;

/** Kurze Überblendung zwischen Szenen — knackig, kein „Screensaver“-Effekt. */
export const CROSSFADE_SEC = 0.35;

/** Länge der optionalen Abschluss-Karte. */
export const END_CARD_SEC = 3;

/** MUSIC_TRACK_PATH auflösen (relativ zum Monorepo-Root); null wenn unbrauchbar. */
function resolveMusicPath(): string | null {
  const configured = process.env.MUSIC_TRACK_PATH;
  if (!configured) return null;
  const resolved = resolveFromWorkspaceRoot(configured);
  if (!existsSync(resolved)) {
    console.warn(`[worker] MUSIC_TRACK_PATH nicht gefunden: ${resolved} — Musik übersprungen.`);
    return null;
  }
  return resolved;
}

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
          organization: { select: { name: true } },
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
  const options: GenerationOptions = parseGenerationOptions(job.options);
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

  // Szenen-Voiceover: pro Shot mit Szenentext ein eigenes TTS-Segment —
  // gewinnt gegenüber dem durchgehenden Skript, sobald Narration existiert.
  interface NarrationSegment {
    shotId: string;
    path: string;
    durationSec: number;
  }
  const narrationSegments = new Map<string, NarrationSegment>();
  const tts = getTtsProvider();
  const useSegmentedVoiceover =
    options.withVoiceover &&
    tts.isEnabled() &&
    shots.some((shot) => shot.narration?.trim());

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
  const externalProvider = new ExternalImageToVideoProvider();
  /** Pro Shot: KI-Video nur, wenn gewünscht UND ein externer Provider konfiguriert ist. */
  const providerFor = (shot: Shot) =>
    shot.preferAiVideo && externalProvider.isEnabled()
      ? externalProvider
      : provider;
  const overlayLabel = provider.watermarkLabel;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-job-"));
  try {
    const totalRenderSteps = shots.length * 2;
    let completedRenders = 0;
    const clips: Record<string, ClipInput[]> = { "16x9": [], "9x16": [] };

    if (useSegmentedVoiceover) {
      for (const shot of shots) {
        const line = shot.narration?.trim();
        if (!line) continue;
        try {
          const audio = await tts.synthesize(line);
          const segmentPath = path.join(tempDir, `narration-${shot.id}.mp3`);
          await writeFile(segmentPath, audio);
          narrationSegments.set(shot.id, {
            shotId: shot.id,
            path: segmentPath,
            durationSec: await audioDurationSec(segmentPath),
          });
        } catch (error) {
          console.warn(
            `[worker] Narration-Segment für Shot ${shot.id} fehlgeschlagen — Szene ohne Sprecher:`,
            error
          );
        }
      }
      await updateProgress(generationJobId, 4, "Szenen-Voiceover erzeugt", hooks);
    }

    // Finale Szenendauern (Auto-Extend, gilt für 16:9 UND 9:16).
    const resolvedDurations = new Map(
      shots.map((shot) => [
        shot.id,
        resolveSceneDuration(
          shot.durationSec,
          narrationSegments.get(shot.id)?.durationSec ?? null
        ),
      ])
    );

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

          const durationSec = resolvedDurations.get(shot.id)!.durationSec;
          const clipBytes = await renderSceneWithRetry(providerFor(shot), {
            imageBytes: normalizedBytes,
            prompt: shot.prompt,
            cameraMoveKey: shot.cameraMove,
            durationSec,
            width: target.width,
            height: target.height,
            fps: FPS,
            overlayLabel,
            sceneLabel: options.withTextOverlays
              ? ROOM_LABEL_NAMES[shot.roomLabel]
              : undefined,
            narrationText:
              options.withTextOverlays && shot.narration?.trim()
                ? shot.narration.trim()
                : undefined,
            sourceAspect:
              shot.mediaAsset.width && shot.mediaAsset.height
                ? shot.mediaAsset.width / shot.mediaAsset.height
                : undefined,
            isFloorplan:
              shot.roomLabel === "GRUNDRISS" || shot.mediaAsset.isLikelyFloorplan,
            sweepDirection:
              (CAMERA_MOVES[shot.cameraMove]?.kenBurns.panX ?? 0) !== 0
                ? (CAMERA_MOVES[shot.cameraMove]!.kenBurns.panX as 1 | -1)
                : shot.sortIndex % 2 === 0
                  ? 1
                  : -1,
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
          clips[target.suffix]!.push({ path: clipPath, durationSec });

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

    // --- Konkatenation (mit Überblendungen) ---
    const version =
      ((await prisma.videoVersion.aggregate({
        where: { projectId: project.id },
        _max: { version: true },
      }))._max.version ?? 0) + 1;

    // Option „Endkarte“: Abschluss-Karte mit freigegebenen Fakten pro Format.
    if (options.withEndCard && project.listingData) {
      const listing = project.listingData;
      const endCardLines: EndCardLine[] = [
        { text: listing.titel, scale: 0.055 },
        {
          text: buildLocationLine(
            {
              plz: listing.plz,
              ort: listing.ort,
              strasse: listing.strasse,
              hausnummer: listing.hausnummer,
            },
            listing.addressVisibility
          ),
          scale: 0.035,
        },
      ];
      const factLine = buildFactLine({
        marketingType: listing.marketingType,
        objectType: listing.objectType,
        titel: listing.titel,
        plz: listing.plz,
        ort: listing.ort,
        kaufpreis: toNumber(listing.kaufpreis),
        kaltmiete: toNumber(listing.kaltmiete),
        zimmer: toNumber(listing.zimmer),
        wohnflaeche: toNumber(listing.wohnflaeche),
      });
      if (factLine) endCardLines.push({ text: factLine, scale: 0.035 });
      endCardLines.push({ text: project.organization.name, scale: 0.027 });

      for (const target of [MASTER, REEL]) {
        const endCardPath = path.join(tempDir, `endcard-${target.suffix}.mp4`);
        const rendered = await renderEndCard(endCardLines, endCardPath, {
          width: target.width,
          height: target.height,
          durationSec: END_CARD_SEC,
          fps: FPS,
        });
        if (rendered) {
          clips[target.suffix]!.push({
            path: endCardPath,
            durationSec: END_CARD_SEC,
          });
        } else {
          console.warn(
            "[worker] Keine Schrift für die Endkarte gefunden — Option übersprungen."
          );
          break;
        }
      }
      await updateProgress(generationJobId, 74, "Endkarte erstellt", hooks);
    }

    // Option „Voiceover“: Szenen-Segmente auf der gemeinsamen Timeline —
    // Fallback bleibt das durchgehende, gespeicherte Skript.
    let voiceoverPath: string | null = null;
    let voiceoverDelayMs = 600;
    if (useSegmentedVoiceover && narrationSegments.size > 0) {
      const durations = shots.map(
        (shot) => resolvedDurations.get(shot.id)!.durationSec
      );
      const starts = sceneStartTimes(durations, CROSSFADE_SEC);
      const segments = shots.flatMap((shot, index) => {
        const segment = narrationSegments.get(shot.id);
        if (!segment) return [];
        const resolved = resolvedDurations.get(shot.id)!;
        return [
          {
            path: segment.path,
            startSec: starts[index]! + NARRATION_LEAD_SEC,
            maxDurationSec: resolved.fadeOutNarration
              ? resolved.durationSec - NARRATION_LEAD_SEC
              : undefined,
          },
        ];
      });
      // Gesamtlänge inkl. optionaler Endkarte — Segmentstarts bleiben davon
      // unberührt (die Karte hängt hinter den Szenen), Rest wird Stille.
      const totalSec = totalDurationWithCrossfade(
        clips[MASTER.suffix]!.map((clip) => clip.durationSec),
        CROSSFADE_SEC
      );
      voiceoverPath = path.join(tempDir, "voiceover.m4a");
      await buildSegmentedVoiceover(segments, totalSec, voiceoverPath);
      voiceoverDelayMs = 0;
      await upsertAsset({
        projectId: project.id,
        kind: "VOICEOVER",
        storageKey: projectStorageKey(
          project.organizationId,
          project.id,
          "final",
          `voiceover-v${version}.m4a`
        ),
        filename: `voiceover-v${version}.m4a`,
        mimeType: "audio/mp4",
        data: await readFile(voiceoverPath),
      });
      await updateProgress(generationJobId, 76, "Voiceover synchronisiert", hooks);
    } else if (options.withVoiceover) {
      const texts = project.marketingTexts as { voiceoverScript?: string } | null;
      const script = texts?.voiceoverScript?.trim();
      if (!script) {
        console.warn(
          "[worker] Voiceover-Option ohne gespeichertes Skript — übersprungen."
        );
      } else if (!tts.isEnabled()) {
        console.warn("[worker] Voiceover-Option ohne TTS-Konfiguration — übersprungen.");
      } else {
        const audioBytes = await tts.synthesize(script);
        voiceoverPath = path.join(tempDir, "voiceover.mp3");
        await writeFile(voiceoverPath, audioBytes);
        await upsertAsset({
          projectId: project.id,
          kind: "VOICEOVER",
          storageKey: projectStorageKey(
            project.organizationId,
            project.id,
            "final",
            `voiceover-v${version}.mp3`
          ),
          filename: `voiceover-v${version}.mp3`,
          mimeType: "audio/mpeg",
          data: audioBytes,
        });
        await updateProgress(generationJobId, 76, "Voiceover erzeugt", hooks);
      }
    }

    // Option „Musik“: Track aus MUSIC_TRACK_PATH.
    const musicPath = options.withMusic ? resolveMusicPath() : null;

    const finals: Record<string, { assetId: string; durationSec: number }> = {};
    for (const target of [MASTER, REEL]) {
      if (await isCancelRequested(generationJobId)) throw new JobCancelledError();
      const targetClips = clips[target.suffix]!;
      const outputPath = path.join(tempDir, `walkthrough-${target.suffix}.mp4`);
      await concatClips(targetClips, outputPath, CROSSFADE_SEC);

      const expectedDuration = totalDurationWithCrossfade(
        targetClips.map((clip) => clip.durationSec),
        CROSSFADE_SEC
      );
      let deliveryPath = outputPath;
      if (musicPath || voiceoverPath) {
        deliveryPath = path.join(tempDir, `walkthrough-${target.suffix}-audio.mp4`);
        await mixAudio(outputPath, deliveryPath, {
          musicPath,
          voiceoverPath,
          videoDurationSec: expectedDuration,
          voiceoverDelayMs,
        });
      }

      const validation = await validateOutput(deliveryPath, {
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
      const finalBytes = await readFile(deliveryPath);
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

      // Cue-Timing folgt dem 16:9-Master (inkl. Überblendungs-Versatz).
      const cues: CaptionCue[] = shots.map((shot: Shot, index: number) => ({
        text:
          index === 0
            ? `${introParts.join("\n")}`
            : shot.narration?.trim() || ROOM_LABEL_NAMES[shot.roomLabel],
        durationSec: resolvedDurations.get(shot.id)!.durationSec,
      }));
      const srt = buildSrt(cues, CROSSFADE_SEC);
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
      data: { generationJobId, version, options },
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
