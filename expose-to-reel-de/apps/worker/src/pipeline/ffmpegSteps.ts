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

/** Clips (gleicher Codec/Auflösung/fps) verlustfrei zusammenfügen. */
export async function concatClips(
  clipPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = path.join(path.dirname(outputPath), `concat-${path.basename(outputPath)}.txt`);
  const list = clipPaths
    .map((clip) => `file '${clip.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await mkdir(path.dirname(outputPath), { recursive: true });
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

/** SRT-Untertitel aus Szenenfolge (nur freigegebene Fakten/Labels). */
export function buildSrt(cues: CaptionCue[]): string {
  let cursor = 0;
  return cues
    .map((cue, index) => {
      const start = srtTimestamp(cursor);
      cursor += cue.durationSec;
      const end = srtTimestamp(Math.max(cursor - 0.1, 0));
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
