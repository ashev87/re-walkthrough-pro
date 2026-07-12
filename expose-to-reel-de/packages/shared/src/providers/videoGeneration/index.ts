import { env } from "../../env";
import { ExternalImageToVideoProvider } from "./external";
import { MockVideoProvider } from "./mock";
import type { VideoGenerationProvider } from "./types";

/** Provider-Auswahl über VIDEO_PROVIDER; Fallback ist immer der Mock. */
export function getVideoProvider(): VideoGenerationProvider {
  if (env.videoProvider === "external") {
    const external = new ExternalImageToVideoProvider();
    if (external.isEnabled()) return external;
    console.warn(
      "[video] Externer Provider nicht konfiguriert — Fallback auf MockVideoProvider."
    );
  }
  return new MockVideoProvider();
}

export * from "./types";
export { MockVideoProvider, resolveFontPath } from "./mock";
export { ExternalImageToVideoProvider } from "./external";
