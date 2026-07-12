import Anthropic from "@anthropic-ai/sdk";

/**
 * LLM-Client für die KI-Optionen (Bildanalyse, Marketing-Texte).
 *
 * Unterstützte Provider (LLM_PROVIDER):
 *   "anthropic" (Standard) — Claude über die Anthropic-API (ANTHROPIC_API_KEY).
 *   "minimax"              — MiniMax M3 über deren Anthropic-kompatiblen
 *                            Endpunkt https://api.minimax.io/anthropic
 *                            (MINIMAX_API_KEY). M3 unterstützt Bild-Eingabe
 *                            und Tool-Use über dieselben Content-Blöcke;
 *                            strukturierte Ausgabe (output_config.format)
 *                            ist dort nicht dokumentiert — dafür nutzt der
 *                            Code Prompt-basiertes JSON (siehe
 *                            supportsJsonSchemaOutput/extractJsonObject).
 *
 * Alle KI-Funktionen bleiben Opt-in: ohne Key des gewählten Providers sind
 * sie deaktiviert und die App arbeitet mit den deterministischen Fallbacks.
 * Keys werden nie geloggt.
 */

export type LlmProviderKey = "anthropic" | "minimax";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";
export const DEFAULT_MINIMAX_MODEL = "MiniMax-M3";
export const MINIMAX_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic";

export function getLlmProviderKey(): LlmProviderKey {
  const configured = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (configured === "minimax") return "minimax";
  if (configured !== "anthropic") {
    console.warn(
      `[llm] Unbekannter LLM_PROVIDER "${configured}" — nutze "anthropic".`
    );
  }
  return "anthropic";
}

function apiKeyForProvider(provider: LlmProviderKey): string | undefined {
  return provider === "minimax"
    ? process.env.MINIMAX_API_KEY
    : process.env.ANTHROPIC_API_KEY;
}

/** Ist der gewählte Provider einsatzbereit (Key vorhanden)? */
export function isLlmConfigured(): boolean {
  return Boolean(apiKeyForProvider(getLlmProviderKey()));
}

/** Abwärtskompatibler Alias (historischer Name). */
export const isAnthropicConfigured = isLlmConfigured;

function defaultModel(provider: LlmProviderKey): string {
  return provider === "minimax" ? DEFAULT_MINIMAX_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

/** Modell für Vision-Bildanalyse (LLM_VISION_MODEL, Alt: ANTHROPIC_VISION_MODEL). */
export function llmVisionModel(): string {
  return (
    process.env.LLM_VISION_MODEL ||
    process.env.ANTHROPIC_VISION_MODEL ||
    defaultModel(getLlmProviderKey())
  );
}

/** Modell für Textgenerierung (LLM_TEXT_MODEL, Alt: ANTHROPIC_TEXT_MODEL). */
export function llmTextModel(): string {
  return (
    process.env.LLM_TEXT_MODEL ||
    process.env.ANTHROPIC_TEXT_MODEL ||
    defaultModel(getLlmProviderKey())
  );
}

/**
 * Unterstützt der Provider Anthropic-Structured-Outputs
 * (output_config.format)? MiniMax dokumentiert das Feature nicht — dort
 * wird stattdessen Prompt-basiertes JSON verwendet.
 */
export function supportsJsonSchemaOutput(): boolean {
  return getLlmProviderKey() === "anthropic";
}

let client: Anthropic | undefined;
let clientProvider: LlmProviderKey | undefined;

export function getLlmClient(): Anthropic {
  const provider = getLlmProviderKey();
  const apiKey = apiKeyForProvider(provider);
  if (!apiKey) {
    throw new Error(
      provider === "minimax"
        ? "MINIMAX_API_KEY ist nicht gesetzt — KI-Funktionen sind deaktiviert (siehe README)."
        : "ANTHROPIC_API_KEY ist nicht gesetzt — KI-Funktionen sind deaktiviert (siehe README)."
    );
  }
  if (!client || clientProvider !== provider) {
    client =
      provider === "minimax"
        ? new Anthropic({
            apiKey,
            baseURL: process.env.MINIMAX_BASE_URL || MINIMAX_ANTHROPIC_BASE_URL,
          })
        : new Anthropic({ apiKey });
    clientProvider = provider;
  }
  return client;
}

/** Abwärtskompatibler Alias (historischer Name). */
export const getAnthropicClient = getLlmClient;

/**
 * Tolerantes JSON-Extrahieren aus einer Modell-Antwort: direktes Parsen,
 * sonst Markdown-Zäune entfernen, sonst erstes {...}-Objekt ausschneiden.
 * Für Provider ohne Structured-Output-Garantie.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* weiter mit Heuristiken */
  }
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    /* weiter */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Antwort enthält kein parsebares JSON-Objekt.");
}
