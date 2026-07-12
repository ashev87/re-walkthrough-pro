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
 * Entwicklungs-Provider: erzeugt aus einem Foto einen funktionsfähigen
 * Ken-Burns-Clip (H.264/yuv420p) und brennt ein deutlich sichtbares
 * MOCK-Label ein. Es wird nichts generiert, was nicht im Quellbild steckt —
 * nur ein virtueller Kameraschwenk über das Original.
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

function panExpression(direction: -1 | 0 | 1, axis: "x" | "y", frames: number): string {
  const range = axis === "x" ? "(iw-iw/zoom)" : "(ih-ih/zoom)";
  if (direction === 0) return `${range}/2`;
  const progress = `on/${frames}`;
  return direction > 0
    ? `${range}*${progress}`
    : `${range}*(1-${progress})`;
}

export class MockVideoProvider implements VideoGenerationProvider {
  readonly key = "mock";
  readonly displayName = "Mock-Vorschau (ffmpeg Ken Burns)";

  isEnabled(): boolean {
    return true;
  }

  async renderScene(spec: SceneRenderSpec): Promise<SceneRenderResult> {
    const move = CAMERA_MOVES[spec.cameraMoveKey] ?? CAMERA_MOVES.still!;
    const frames = Math.max(2, Math.round(spec.durationSec * spec.fps));
    const { zoomFrom, zoomTo, panX, panY } = move.kenBurns;

    const zoomExpr = `${zoomFrom}+(${zoomTo}-${zoomFrom})*on/${frames}`;
    const xExpr = panExpression(panX, "x", frames);
    const yExpr = panExpression(panY, "y", frames);

    // Vorskalierung auf Ziel-Seitenverhältnis + 2×-Überabtastung gegen
    // zoompan-Jitter; danach virtueller Kameraschwenk.
    const filters: string[] = [
      `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${spec.width}:${spec.height}`,
      `scale=${spec.width * 2}:${spec.height * 2}:flags=lanczos`,
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${spec.width}x${spec.height}:fps=${spec.fps}`,
    ];

    if (spec.overlayLabel) {
      const font = resolveFontPath();
      const bandHeight = Math.round(spec.height * 0.055);
      filters.push(
        `drawbox=x=0:y=ih-${bandHeight * 2}:w=iw:h=${bandHeight}:color=black@0.55:t=fill`
      );
      if (font) {
        filters.push(
          `drawtext=fontfile='${escapeFilterValue(font)}'` +
            `:text='${escapeFilterValue(spec.overlayLabel)}'` +
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
