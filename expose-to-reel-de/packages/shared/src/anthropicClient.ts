import Anthropic from "@anthropic-ai/sdk";

/**
 * Gemeinsamer Anthropic-Client für die KI-Optionen (Bildanalyse,
 * Marketing-Texte). Alle KI-Funktionen sind Opt-in: ohne ANTHROPIC_API_KEY
 * bleiben sie deaktiviert und die App arbeitet mit den deterministischen
 * Fallbacks weiter. Der Key wird nie geloggt.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Modell für Vision-Bildanalyse (überschreibbar, z. B. claude-haiku-4-5). */
export function anthropicVisionModel(): string {
  return process.env.ANTHROPIC_VISION_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

/** Modell für Textgenerierung. */
export function anthropicTextModel(): string {
  return process.env.ANTHROPIC_TEXT_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!isAnthropicConfigured()) {
    throw new Error(
      "ANTHROPIC_API_KEY ist nicht gesetzt — KI-Funktionen sind deaktiviert (siehe README)."
    );
  }
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
