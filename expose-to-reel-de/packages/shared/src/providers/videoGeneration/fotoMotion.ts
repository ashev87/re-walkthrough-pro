import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CAMERA_MOVES } from "../../domain/cameraMoves";
import { wrapText } from "../../domain/textWrap";
import { env } from "../../env";
import { runFfmpeg } from "../../ffmpeg";
import type {
  SceneRenderResult,
  SceneRenderSpec,
  VideoGenerationProvider,
} from "./types";

/**
 * Foto-Motion-Provider: erzeugt aus einem Foto einen kinoreif anmutenden
 * Ken-Burns-Clip (H.264/yuv420p) — geglättete Kamerafahrt (Ease-in/out),
 * dezentes Farb-Grading und Vignette. Es entsteht nichts, was nicht im
 * Quellbild steckt: nur eine virtuelle Kamerabewegung über das Original.
 *
 * Mit `watermarkLabel` (VIDEO_PROVIDER=mock) wird ein deutlich sichtbares
 * Label eingebrannt — für Demos/Previews, nie für finales Material.
 */

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arial.ttf",
  "C:/Windows/Fonts/segoeui.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
];

export function resolveFontPath(): string | null {
  if (env.ffmpegFontPath && existsSync(env.ffmpegFontPath)) {
    return env.ffmpegFontPath;
  }
  return FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** ffmpeg-Filter-Escaping für Pfade/Texte (Windows-Doppelpunkte!). */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Geglätteter Fortschritt 0→1 über `frames` Ausgabeframes (Smoothstep,
 * 3p²−2p³) — nimmt der Kamerafahrt das Lineare/Roboterhafte.
 */
function easedProgress(frames: number): string {
  const p = `(on/${frames})`;
  return `(${p}*${p}*(3-2*${p}))`;
}

function panExpression(
  direction: -1 | 0 | 1,
  axis: "x" | "y",
  eased: string
): string {
  const range = axis === "x" ? "(iw-iw/zoom)" : "(ih-ih/zoom)";
  if (direction === 0) return `${range}/2`;
  return direction > 0 ? `${range}*${eased}` : `${range}*(1-${eased})`;
}

/** Dezentes Grading: leichter Kontrast-/Sättigungs-Lift + weiche Vignette. */
const GRADE_FILTERS = [
  "eq=contrast=1.06:saturation=1.12:brightness=0.01",
  "vignette=angle=PI/6",
];

export interface FotoMotionOptions {
  /** Sichtbares Overlay (z. B. „MOCK-VORSCHAU …“); undefined = kein Label. */
  watermarkLabel?: string;
}

/** Schwelle, ab der eine Quelle als Querformat gilt (Sweep statt Blur-Pad). */
const SWEEP_MIN_SOURCE_ASPECT = 1.2;

/** Smoothstep-Fortschritt 0→1 über die Szenendauer, in Sekunden (crop-Filter, t-basiert). */
function easedProgressT(durationSec: number): string {
  const p = `(t/${durationSec})`;
  return `(${p}*${p}*(3-2*${p}))`;
}

export interface SceneFilterOptions {
  font: string | null;
  watermarkLabel?: string;
}

/**
 * Baut den kompletten -vf-Filtergraphen einer Szene (pur, testbar).
 * Drei Bildpfade:
 *  - Standard (Quer-Ziel): Scale-to-fill + Crop + Ken-Burns-zoompan.
 *  - 9:16-Sweep (Querformat-Quelle): animiertes crop schwenkt über die volle Breite.
 *  - 9:16-Blur-Pad (Grundriss/Hochformat): unscharfer Füll-Hintergrund + zoompan.
 */
export function buildSceneFilters(
  spec: SceneRenderSpec,
  options: SceneFilterOptions
): string[] {
  const move = CAMERA_MOVES[spec.cameraMoveKey] ?? CAMERA_MOVES.still!;
  const frames = Math.max(2, Math.round(spec.durationSec * spec.fps));
  const { zoomFrom, zoomTo, panX, panY } = move.kenBurns;

  const isPortraitTarget = spec.height > spec.width;
  const useSweep =
    isPortraitTarget &&
    !spec.isFloorplan &&
    (spec.sourceAspect ?? 0) >= SWEEP_MIN_SOURCE_ASPECT;

  const filters: string[] = [];
  if (useSweep) {
    // Volle Bildhöhe zeigen, Fenster schwenkt horizontal (Smoothstep in t).
    const eased = easedProgressT(spec.durationSec);
    const x =
      (spec.sweepDirection ?? 1) > 0
        ? `(iw-ow)*${eased}`
        : `(iw-ow)*(1-${eased})`;
    filters.push(
      `scale=-2:${spec.height * 2}:flags=lanczos`,
      `fps=${spec.fps}`,
      `crop=w='min(iw,ih*${spec.width}/${spec.height})':h=ih:x='${x}':y=0`,
      `scale=${spec.width}:${spec.height}:flags=lanczos`
    );
  } else {
    const eased = easedProgress(frames);
    const zoomExpr = `${zoomFrom}+(${zoomTo}-${zoomFrom})*${eased}`;
    const xExpr = panExpression(panX, "x", eased);
    const yExpr = panExpression(panY, "y", eased);
    const w2 = spec.width * 2;
    const h2 = spec.height * 2;
    if (isPortraitTarget) {
      // Blur-Pad: Bild eingepasst auf unscharfem, abgedunkeltem Füllbild.
      filters.push(
        `split[e2rbg][e2rfg];` +
          `[e2rbg]scale=${w2}:${h2}:force_original_aspect_ratio=increase:flags=lanczos,` +
          `crop=${w2}:${h2},gblur=sigma=40,eq=brightness=-0.08[e2rbgo];` +
          `[e2rfg]scale=${w2}:${h2}:force_original_aspect_ratio=decrease:flags=lanczos[e2rfgo];` +
          `[e2rbgo][e2rfgo]overlay=x=(W-w)/2:y=(H-h)/2`
      );
    } else {
      // Vorskalierung auf Ziel-Seitenverhältnis + 2×-Überabtastung gegen
      // zoompan-Jitter; danach virtueller Kameraschwenk + Grading.
      filters.push(
        `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase:flags=lanczos`,
        `crop=${spec.width}:${spec.height}`,
        `scale=${w2}:${h2}:flags=lanczos`
      );
    }
    filters.push(
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${spec.width}x${spec.height}:fps=${spec.fps}`
    );
  }
  filters.push(...GRADE_FILTERS);

  const font = options.font;
  if (spec.sceneLabel && font) {
    const size = Math.round(spec.height * 0.032);
    const margin = Math.round(spec.height * 0.045);
    filters.push(
      `drawtext=fontfile='${escapeFilterValue(font)}'` +
        `:text='${escapeFilterValue(spec.sceneLabel)}'` +
        `:fontcolor=white:fontsize=${size}` +
        `:box=1:boxcolor=black@0.35:boxborderw=${Math.round(size * 0.45)}` +
        `:x=${margin}:y=h-${margin + size}`
    );
    if (spec.narrationText) {
      // Szenentext oberhalb des Raum-Labels, kleiner, gleiche Box-Optik.
      const narrSize = Math.round(spec.height * 0.026);
      const maxChars = isPortraitTarget ? 34 : 60;
      const wrapped = wrapText(spec.narrationText, maxChars);
      const lineCount = wrapped.split("\n").length;
      const blockHeight = Math.round(narrSize * 1.35 * lineCount);
      const y = spec.height - margin - size - narrSize - blockHeight;
      filters.push(
        `drawtext=fontfile='${escapeFilterValue(font)}'` +
          `:text='${escapeFilterValue(wrapped)}'` +
          `:fontcolor=white:fontsize=${narrSize}` +
          `:box=1:boxcolor=black@0.35:boxborderw=${Math.round(narrSize * 0.45)}` +
          `:x=${margin}:y=${y}`
      );
    }
  }

  const overlayLabel = spec.overlayLabel ?? options.watermarkLabel;
  if (overlayLabel) {
    const bandHeight = Math.round(spec.height * 0.055);
    filters.push(
      `drawbox=x=0:y=ih-${bandHeight * 2}:w=iw:h=${bandHeight}:color=black@0.55:t=fill`
    );
    if (font) {
      filters.push(
        `drawtext=fontfile='${escapeFilterValue(font)}'` +
          `:text='${escapeFilterValue(overlayLabel)}'` +
          `:fontcolor=white:fontsize=${Math.round(bandHeight * 0.6)}` +
          `:x=(w-text_w)/2:y=h-${Math.round(bandHeight * 1.7)}`
      );
    }
  }
  filters.push("format=yuv420p");
  return filters;
}

export class FotoMotionVideoProvider implements VideoGenerationProvider {
  readonly key = "foto_motion";
  readonly displayName = "Foto-Motion (ffmpeg Ken Burns, geglättet)";
  readonly watermarkLabel?: string;

  constructor(options: FotoMotionOptions = {}) {
    this.watermarkLabel = options.watermarkLabel;
  }

  isEnabled(): boolean {
    return true;
  }

  async renderScene(spec: SceneRenderSpec): Promise<SceneRenderResult> {
    const frames = Math.max(2, Math.round(spec.durationSec * spec.fps));
    const filters = buildSceneFilters(spec, {
      font: resolveFontPath(),
      watermarkLabel: this.watermarkLabel,
    });

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-scene-"));
    try {
      const inputPath = path.join(tempDir, "input.img");
      const outputPath = path.join(tempDir, "scene.mp4");
      await writeFile(inputPath, spec.imageBytes);

      await runFfmpeg([
        "-loop",
        "1",
        "-i",
        inputPath,
        "-vf",
        filters.join(","),
        "-frames:v",
        String(frames),
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

      return {
        videoBytes: await readFile(outputPath),
        providerKey: this.key,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
