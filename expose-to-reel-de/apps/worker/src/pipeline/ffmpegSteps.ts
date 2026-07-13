import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffprobe, runFfmpeg } from "@e2r/shared/ffmpeg";
import { resolveFontPath, wrapText, wrapTextFits } from "@e2r/shared";

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

/**
 * ffmpeg-Filter-Escaping (Windows-Doppelpunkte, Quotes).
 * Apostroph innerhalb eines '-gequoteten Werts: Quote schließen, escaptes
 * Literal einfügen, wieder öffnen ('\'') — \' allein bricht den Filtergraphen.
 */
function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\''");
}

export interface EndCardLine {
  text: string;
  /** Relative Schriftgröße (Anteil der Videohöhe). */
  scale: number;
}

/** Fertiges Layout eines Endkarten-Blocks (ggf. mehrzeilig via \n). */
export interface EndCardBlockLayout {
  text: string;
  fontSize: number;
  y: number;
}

/** Zeilenhöhe innerhalb eines mehrzeiligen Blocks (≈ 1,25 × Schriftgröße). */
const END_CARD_LINE_HEIGHT = 1.25;
/** Untergrenze beim Nachschrumpfen: nie unter 60 % der Wunschgröße. */
const END_CARD_MIN_SHRINK = 0.6;
/** Maximale Zeilen pro Endkarten-Block, bevor die Ellipse greift. */
const END_CARD_MAX_LINES = 3;

/**
 * Layout der Endkarten-Zeilen (pur, testbar): Zu lange Zeilen werden
 * umbrochen (max. 3 Zeilen) statt auf Mini-Schrift geschrumpft. Passt der
 * komplette Text bei der Wunschgröße nicht, wird die Schrift schrittweise
 * verkleinert (mehr Zeichen pro Zeile), bis er vollständig unterkommt —
 * nie unter 60 % der Wunschgröße; erst darunter greift die „…“-Kappung.
 * Der Gesamtblock bleibt vertikal zentriert.
 * Näherung der Zeichenbreite: ≈ 0,55 × Schriftgröße.
 */
export function layoutEndCardLines(
  lines: EndCardLine[],
  width: number,
  height: number
): EndCardBlockLayout[] {
  const gap = height * 0.035;
  const maxTextWidth = width * 0.92;
  const maxCharsAt = (size: number) => Math.floor(maxTextWidth / (size * 0.55));

  const blocks = lines.map((line) => {
    const desired = Math.max(12, Math.round(line.scale * height));
    if (line.text.length <= maxCharsAt(desired)) {
      return { text: line.text, fontSize: desired };
    }
    // Größte Schrift ≥ 60 %-Untergrenze suchen, bei der der komplette Text
    // in max. 3 Zeilen passt; sonst Untergrenze mit Ellipsen-Fallback.
    const minSize = Math.max(12, Math.round(desired * END_CARD_MIN_SHRINK));
    let fontSize = minSize;
    for (let size = desired; size >= minSize; size--) {
      if (wrapTextFits(line.text, maxCharsAt(size), END_CARD_MAX_LINES)) {
        fontSize = size;
        break;
      }
    }
    const wrapped = wrapText(line.text, maxCharsAt(fontSize), END_CARD_MAX_LINES);
    // Sicherung gegen einzelne überlange Wörter (wrapText zerschneidet nie):
    // notfalls unter die Schätzbreite schrumpfen, aber nie unter die Untergrenze.
    const longest = Math.max(
      ...wrapped.split("\n").map((wrappedLine) => wrappedLine.length)
    );
    if (longest * fontSize * 0.55 > maxTextWidth) {
      fontSize = Math.max(
        minSize,
        Math.floor(maxTextWidth / (longest * 0.55))
      );
    }
    return { text: wrapped, fontSize };
  });

  const blockHeight = (block: { text: string; fontSize: number }) => {
    const lineCount = block.text.split("\n").length;
    return (
      block.fontSize +
      (lineCount - 1) * Math.round(block.fontSize * END_CARD_LINE_HEIGHT)
    );
  };
  const totalHeight =
    blocks.reduce((sum, block) => sum + blockHeight(block), 0) +
    gap * Math.max(0, blocks.length - 1);

  let cursor = (height - totalHeight) / 2;
  return blocks.map((block) => {
    const y = Math.round(cursor);
    cursor += blockHeight(block) + gap;
    return { ...block, y };
  });
}

/**
 * Abschluss-Karte (Opt-in „Endkarte“): dunkler Hintergrund mit den
 * freigegebenen Fakten. Liefert false, wenn keine Schrift verfügbar ist —
 * dann wird die Option übersprungen statt eine leere Karte anzuhängen.
 */
export async function renderEndCard(
  lines: EndCardLine[],
  outputPath: string,
  options: { width: number; height: number; durationSec: number; fps: number }
): Promise<boolean> {
  const font = resolveFontPath();
  if (!font) return false;

  const { width, height, durationSec, fps } = options;
  const layout = layoutEndCardLines(lines, width, height);

  const drawFilters = layout.map((block) => {
    // Zusätzlicher Zeilenabstand für mehrzeilige Blöcke (drawtext rendert \n).
    const lineSpacing = Math.round(block.fontSize * (END_CARD_LINE_HEIGHT - 1));
    return (
      `drawtext=fontfile='${escapeFilterValue(font)}'` +
      `:text='${escapeFilterValue(block.text)}'` +
      `:fontcolor=0xF2F0EA:fontsize=${block.fontSize}` +
      `:line_spacing=${lineSpacing}` +
      `:x=(w-text_w)/2:y=${block.y}` +
      `:alpha='min(1,t/0.8)'`
    );
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=0x14181f:s=${width}x${height}:d=${durationSec}:r=${fps}`,
    "-vf",
    [...drawFilters, "format=yuv420p"].join(","),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-an",
    outputPath,
  ]);
  return true;
}

/** Audiodauer (Sekunden) per ffprobe. */
export async function audioDurationSec(audioPath: string): Promise<number> {
  const probe = await ffprobe(audioPath);
  const duration = Number(
    probe.format.duration ??
      probe.streams.find((s) => s.codec_type === "audio")?.duration ??
      0
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Keine Audiodauer ermittelbar: ${audioPath}`);
  }
  return duration;
}

export interface VoiceoverSegment {
  path: string;
  /** Startzeit im Gesamtvideo (Sekunden). */
  startSec: number;
  /** Hartes Limit — Segment wird darauf gekürzt und ausgeblendet (0,3 s). */
  maxDurationSec?: number;
}

/**
 * Szenen-Voiceover: TTS-Segmente an ihren Szenenstart legen (adelay), zu
 * kürzende Segmente mit Fade-out kappen, alles mischen und exakt auf die
 * Videolänge bringen (apad + atrim). Ausgabe AAC (m4a).
 */
export async function buildSegmentedVoiceover(
  segments: readonly VoiceoverSegment[],
  totalDurationSec: number,
  outputPath: string
): Promise<void> {
  if (segments.length === 0) {
    throw new Error("buildSegmentedVoiceover ohne Segmente aufgerufen.");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });

  const args: string[] = [];
  const filters: string[] = [];
  segments.forEach((segment, index) => {
    args.push("-i", segment.path);
    const steps: string[] = [];
    if (segment.maxDurationSec != null) {
      const fadeStart = Math.max(0, segment.maxDurationSec - 0.3);
      steps.push(
        `atrim=0:${segment.maxDurationSec.toFixed(3)}`,
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.3`
      );
    }
    const delayMs = Math.max(0, Math.round(segment.startSec * 1000));
    steps.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${index}:a]${steps.join(",")}[s${index}]`);
  });
  const inputLabels = segments.map((_, index) => `[s${index}]`).join("");
  const mix =
    segments.length === 1
      ? `${inputLabels}anull[mixed]`
      : `${inputLabels}amix=inputs=${segments.length}:duration=longest:normalize=0[mixed]`;
  filters.push(
    mix,
    `[mixed]apad,atrim=0:${totalDurationSec.toFixed(3)}[aout]`
  );

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    outputPath,
  ]);
}

export interface AudioMixInput {
  musicPath?: string | null;
  voiceoverPath?: string | null;
  videoDurationSec: number;
  /** Verzögerung der Voiceover-Spur; 0 für bereits fertig getimte Spuren. */
  voiceoverDelayMs?: number;
}

/**
 * Hintergrundmusik und/oder Voiceover unter das fertige Video mischen.
 * Musik wird geloopt, leiser gemischt (stärker abgesenkt, wenn ein
 * Voiceover dabei ist) und am Ende ausgeblendet; das Video bleibt unberührt
 * (Streamcopy).
 */
export async function mixAudio(
  videoPath: string,
  outputPath: string,
  input: AudioMixInput
): Promise<void> {
  const { musicPath, voiceoverPath, videoDurationSec } = input;
  if (!musicPath && !voiceoverPath) {
    throw new Error("mixAudio ohne Audioquellen aufgerufen.");
  }

  const args: string[] = ["-i", videoPath];
  const filters: string[] = [];
  let audioIndex = 1;
  let musicLabel: string | null = null;
  let voiceLabel: string | null = null;

  if (musicPath) {
    args.push("-stream_loop", "-1", "-i", musicPath);
    const volume = voiceoverPath ? 0.16 : 0.3;
    const fadeStart = Math.max(0, videoDurationSec - 2);
    filters.push(
      `[${audioIndex}:a]volume=${volume},afade=t=in:d=1,afade=t=out:st=${fadeStart.toFixed(2)}:d=2[music]`
    );
    musicLabel = "[music]";
    audioIndex++;
  }
  if (voiceoverPath) {
    args.push("-i", voiceoverPath);
    // Leichter Vorlauf, damit das Voiceover nicht auf dem ersten Frame startet;
    // 0 für bereits fertig getimte Spuren (Szenen-Voiceover).
    const delayMs = input.voiceoverDelayMs ?? 600;
    filters.push(
      delayMs > 0
        ? `[${audioIndex}:a]adelay=${delayMs}|${delayMs}[voice]`
        : `[${audioIndex}:a]anull[voice]`
    );
    voiceLabel = "[voice]";
  }

  let outLabel: string;
  if (musicLabel && voiceLabel) {
    filters.push(
      `${musicLabel}${voiceLabel}amix=inputs=2:duration=longest:normalize=0[aout]`
    );
    outLabel = "[aout]";
  } else {
    outLabel = (musicLabel ?? voiceLabel)!;
  }

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    outLabel,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-t",
    videoDurationSec.toFixed(3),
    "-movflags",
    "+faststart",
    outputPath,
  ]);
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
