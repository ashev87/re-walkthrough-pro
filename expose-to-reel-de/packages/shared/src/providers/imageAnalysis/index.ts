import { env } from "../../env";
import { AnthropicImageAnalysisProvider } from "./anthropic";
import { HeuristicImageAnalysisProvider } from "./heuristic";
import type { ImageAnalysisProvider } from "./types";

/**
 * Auswahl des Analyse-Providers. Ohne KI-Schlüssel (Standard) arbeitet die
 * deterministische Heuristik — die App funktioniert vollständig ohne KI.
 * IMAGE_ANALYSIS_PROVIDER="ai" + ANTHROPIC_API_KEY aktiviert Claude-Vision
 * (mit Heuristik-Fallback bei jedem Fehler).
 */
export function getImageAnalysisProvider(): ImageAnalysisProvider {
  if (env.imageAnalysisProvider === "ai") {
    if (AnthropicImageAnalysisProvider.isEnabled()) {
      return new AnthropicImageAnalysisProvider();
    }
    console.warn(
      "[analysis] IMAGE_ANALYSIS_PROVIDER=ai, aber ANTHROPIC_API_KEY fehlt — nutze Heuristik."
    );
  } else if (env.imageAnalysisProvider !== "heuristic") {
    console.warn(
      `[analysis] Provider "${env.imageAnalysisProvider}" nicht verfügbar — nutze Heuristik.`
    );
  }
  return new HeuristicImageAnalysisProvider();
}

export * from "./types";
export { HeuristicImageAnalysisProvider } from "./heuristic";
export { AnthropicImageAnalysisProvider } from "./anthropic";
