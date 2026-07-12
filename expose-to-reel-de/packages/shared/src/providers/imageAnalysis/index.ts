import { env } from "../../env";
import { HeuristicImageAnalysisProvider } from "./heuristic";
import type { ImageAnalysisProvider } from "./types";

/**
 * Auswahl des Analyse-Providers. Ohne KI-Schlüssel (Standard) arbeitet die
 * deterministische Heuristik — die App funktioniert vollständig ohne KI.
 * Ein KI-Provider (IMAGE_ANALYSIS_PROVIDER="ai") kann später ergänzt werden;
 * bis dahin fällt die Factory bewusst auf die Heuristik zurück.
 */
export function getImageAnalysisProvider(): ImageAnalysisProvider {
  if (env.imageAnalysisProvider !== "heuristic") {
    console.warn(
      `[analysis] Provider "${env.imageAnalysisProvider}" nicht verfügbar — nutze Heuristik.`
    );
  }
  return new HeuristicImageAnalysisProvider();
}

export * from "./types";
export { HeuristicImageAnalysisProvider } from "./heuristic";
