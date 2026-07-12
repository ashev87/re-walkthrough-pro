import { env } from "../../env";
import { ExternalImageToVideoProvider } from "./external";
import { FotoMotionVideoProvider } from "./fotoMotion";
import type { VideoGenerationProvider } from "./types";

export const MOCK_WATERMARK_LABEL = "MOCK-VORSCHAU – KEIN FINALES MATERIAL";

/**
 * Provider-Auswahl über VIDEO_PROVIDER:
 *   "foto_motion" (Standard) — geglätteter Ken Burns, ohne Wasserzeichen.
 *   "mock"                   — derselbe Renderer, aber mit deutlich
 *                              sichtbarem MOCK-Label (Demos/Previews).
 *   "external"               — künftiger KI-Provider; fällt ohne
 *                              Konfiguration auf Foto-Motion zurück.
 */
export function getVideoProvider(): VideoGenerationProvider {
  switch (env.videoProvider) {
    case "external": {
      const external = new ExternalImageToVideoProvider();
      if (external.isEnabled()) return external;
      console.warn(
        "[video] Externer Provider nicht konfiguriert — Fallback auf Foto-Motion."
      );
      return new FotoMotionVideoProvider();
    }
    case "mock":
      return new FotoMotionVideoProvider({
        watermarkLabel: MOCK_WATERMARK_LABEL,
      });
    default:
      return new FotoMotionVideoProvider();
  }
}

export * from "./types";
export { FotoMotionVideoProvider, resolveFontPath } from "./fotoMotion";
export { ExternalImageToVideoProvider } from "./external";
