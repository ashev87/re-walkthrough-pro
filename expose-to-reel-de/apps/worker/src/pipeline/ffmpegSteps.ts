import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffprobe, runFfmpeg } from "@e2r/shared/ffmpeg";

/**
 * ffmpeg-Bausteine der Generierungs-Pipeline: Bildnormalisierung,
 * Clip-Konkatenation, Poster, Untertitel und Output-Validierung.
 */

/** EXIF/Metadaten entfernen, sRGB-JPEG, Kantenlänge begrenzen. */
export async function normalizeImage(image: Buffer): Promise<Buffer> {
  const { stdout } = await runFfmpeg(
    [
      "-i",
      "pipe:0",
      "-vf",
      "scale='min(3840,iw)':-2:flags=lanczos",
      "-frames:v",
      "1",
      "-map_metadata",
      "-1",
      "-q:v",
      "2",
      "-f",
      "image2pipe",
      "-c:v",
      "mjpeg",
      "pipe:1",
    ],
    { stdin: image, timeoutMs: 60_000 }
  );
  return stdout;
}

export interface ClipInput {
  path: string;
  durationSec: number;
}

/**
 * Gesamtdauer einer Clip-Folge mit Überblendungen: jede Blende überlappt
 * zwei Szenen, die Summe schrumpft um (n−1)·crossfade.
 */
export function totalDurationWithCrossfade(
  durations: readonly number[],
  crossfadeSec: number
): number {
  const sum = durations.reduce((acc, d) => acc + d, 0);
  return sum - Math.max(0, durations.length - 1) * crossfadeSec;
}

/**
 * Clips (gleicher Codec/Auflösung/fps) zusammenfügen. Mit crossfadeSec > 0
 * werden kurze Überblendungen (xfade) zwischen den Szenen gerendert;
 * andernfalls verlustfreies Concat (Streamcopy).
 */
export async function concatClips(
  clips: readonly ClipInput[],
  outputPath: string,
  crossfadeSec = 0
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (crossfadeSec > 0 && clips.length > 1) {
    const inputs = clips.flatMap((clip) => ["-i", clip.path]);
    const steps: string[] = [];
    let previousLabel = "[0:v]";
    let offset = 0;
    for (let i = 1; i < clips.length; i++) {
      offset += clips[i - 1]!.durationSec - crossfadeSec;
      const outLabel = i === clips.length - 1 ? "[vout]" : `[v${i}]`;
      steps.push(
        `${previousLabel}[${i}:v]xfade=transition=fade:duration=${crossfadeSec}:offset=${offset.toFixed(3)}${outLabel}`
      );
      previousLabel = outLabel;
    }
    await runFfmpeg([
      ...inputs,
      "-filter_complex",
      steps.join(";"),
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ]);
    return;
  }

  const listPath = path.join(path.dirname(outputPath), `concat-${path.basename(outputPath)}.txt`);
  const list = clips
    .map((clip) => `file '${clip.path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, list, "utf8");
  await runFfmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/** Posterframe (JPEG) aus dem fertigen Master ziehen. */
export async function extractPoster(
  videoPath: string,
  atSeconds = 0.5
): Promise<Buffer> {
  const posterPath = `${videoPath}.poster.jpg`;
  await runFfmpeg([
    "-ss",
    String(atSeconds),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    posterPath,
  ]);
  return readFile(posterPath);
}

function srtTimestamp(totalSeconds: number): string {
  const ms = Math.round(totalSeconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

export interface CaptionCue {
  text: string;
  durationSec: number;
}

/**
 * SRT-Untertitel aus Szenenfolge (nur freigegebene Fakten/Labels).
 * crossfadeSec verschiebt die Cue-Starts entsprechend der Überblendungen,
 * damit die Untertitel synchron zum tatsächlichen Szenenwechsel bleiben.
 */
export function buildSrt(cues: CaptionCue[], crossfadeSec = 0): string {
  let sceneStart = 0;
  return cues
    .map((cue, index) => {
      const isLast = index === cues.length - 1;
      const visibleEnd = isLast
        ? sceneStart + cue.durationSec
        : sceneStart + cue.durationSec - crossfadeSec;
      const start = srtTimestamp(sceneStart);
      const end = srtTimestamp(Math.max(visibleEnd - 0.1, sceneStart));
      sceneStart = visibleEnd;
      return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
    })
    .join("\n");
}

export interface OutputValidation {
  durationSec: number;
  width: number;
  height: number;
}

export class OutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputValidationError";
  }
}

/** Ergebnis mit ffprobe prüfen: H.264, exakte Zielgröße, plausible Dauer. */
export async function validateOutput(
  videoPath: string,
  expected: { width: number; height: number; durationSec: number }
): Promise<OutputValidation> {
  const probe = await ffprobe(videoPath);
  const video = probe.streams.find((s) => s.codec_type === "video");
  if (!video) throw new OutputValidationError("Kein Videostream im Output.");
  if (video.codec_name !== "h264") {
    throw new OutputValidationError(`Unerwarteter Codec: ${video.codec_name}`);
  }
  if (video.width !== expected.width || video.height !== expected.height) {
    throw new OutputValidationError(
      `Auflösung ${video.width}×${video.height} ≠ erwartet ${expected.width}×${expected.height}`
    );
  }
  const duration = Number(probe.format.duration ?? video.duration ?? 0);
  const tolerance = Math.max(1, expected.durationSec * 0.1);
  if (Math.abs(duration - expected.durationSec) > tolerance) {
    throw new OutputValidationError(
      `Dauer ${duration.toFixed(2)}s außerhalb der Toleranz (erwartet ~${expected.durationSec}s)`
    );
  }
  return { durationSec: duration, width: video.width!, height: video.height! };
}
