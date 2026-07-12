import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CAMERA_MOVES } from "../../domain/cameraMoves";
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
    const move = CAMERA_MOVES[spec.cameraMoveKey] ?? CAMERA_MOVES.still!;
    const frames = Math.max(2, Math.round(spec.durationSec * spec.fps));
    const { zoomFrom, zoomTo, panX, panY } = move.kenBurns;

    const eased = easedProgress(frames);
    const zoomExpr = `${zoomFrom}+(${zoomTo}-${zoomFrom})*${eased}`;
    const xExpr = panExpression(panX, "x", eased);
    const yExpr = panExpression(panY, "y", eased);

    // Vorskalierung auf Ziel-Seitenverhältnis + 2×-Überabtastung gegen
    // zoompan-Jitter; danach virtueller Kameraschwenk + Grading.
    const filters: string[] = [
      `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${spec.width}:${spec.height}`,
      `scale=${spec.width * 2}:${spec.height * 2}:flags=lanczos`,
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${spec.width}x${spec.height}:fps=${spec.fps}`,
      ...GRADE_FILTERS,
    ];

    const overlayLabel = spec.overlayLabel ?? this.watermarkLabel;
    if (overlayLabel) {
      const font = resolveFontPath();
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
