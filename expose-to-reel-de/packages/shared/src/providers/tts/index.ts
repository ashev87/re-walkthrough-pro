import { ProviderNotConfiguredError, ProviderRequestError } from "../errors";

/**
 * Text-to-Speech für das Voiceover (Opt-in: OPENAI_API_KEY). Hinter einem
 * Interface, damit später weitere Anbieter (z. B. ElevenLabs) ergänzt werden
 * können. Ohne Konfiguration bleibt die Voiceover-Option in der UI
 * deaktiviert — die App funktioniert vollständig ohne TTS.
 */

export interface TtsProvider {
  readonly key: string;
  readonly displayName: string;
  isEnabled(): boolean;
  /** Erzeugt gesprochenes Audio (MP3-Bytes) aus dem geprüften Skript. */
  synthesize(script: string): Promise<Buffer>;
}

/**
 * OpenAI Audio-Speech-API (POST https://api.openai.com/v1/audio/speech —
 * dokumentierter, stabiler Endpunkt). Raw HTTP ist hier bewusst: für einen
 * einzelnen Endpunkt lohnt keine SDK-Abhängigkeit.
 */
export class OpenAiTtsProvider implements TtsProvider {
  readonly key = "openai";
  readonly displayName = "OpenAI TTS";

  isEnabled(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async synthesize(script: string): Promise<Buffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ProviderNotConfiguredError(
        this.key,
        "OPENAI_API_KEY setzen, um Voiceover zu aktivieren (siehe README)."
      );
    }
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.TTS_VOICE || "alloy",
        input: script,
        response_format: "mp3",
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderRequestError(
        this.key,
        `TTS-Anfrage fehlgeschlagen (HTTP ${response.status}): ${detail.slice(0, 300)}`
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export function getTtsProvider(): TtsProvider {
  return new OpenAiTtsProvider();
}
