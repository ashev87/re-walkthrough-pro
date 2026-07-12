import { ProviderNotConfiguredError, ProviderRequestError } from "../errors";

/**
 * Text-to-Speech für das Voiceover (Opt-in). Zwei Anbieter:
 *
 *   "openai"     — OpenAI Audio-Speech-API (OPENAI_API_KEY)
 *   "elevenlabs" — ElevenLabs TTS (ELEVENLABS_API_KEY); Standardmodell
 *                  eleven_multilingual_v2 erkennt Deutsch automatisch
 *
 * Auswahl über TTS_PROVIDER; ohne explizite Wahl gewinnt der Anbieter,
 * dessen Key gesetzt ist (OpenAI vor ElevenLabs, wenn beide da sind).
 * Ohne Konfiguration bleibt die Voiceover-Option in der UI deaktiviert —
 * die App funktioniert vollständig ohne TTS.
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

/**
 * ElevenLabs TTS (POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id},
 * Auth über xi-api-key — dokumentierter, stabiler Endpunkt). Das
 * Standardmodell eleven_multilingual_v2 erkennt die Sprache (Deutsch)
 * automatisch aus dem Text.
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly key = "elevenlabs";
  readonly displayName = "ElevenLabs TTS";

  /** Premade-Stimme „Rachel“ — überschreibbar via ELEVENLABS_VOICE_ID. */
  static readonly DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
  static readonly DEFAULT_MODEL = "eleven_multilingual_v2";

  isEnabled(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY);
  }

  async synthesize(script: string): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new ProviderNotConfiguredError(
        this.key,
        "ELEVENLABS_API_KEY setzen, um Voiceover zu aktivieren (siehe README)."
      );
    }
    const voiceId =
      process.env.ELEVENLABS_VOICE_ID || ElevenLabsTtsProvider.DEFAULT_VOICE_ID;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: script,
          model_id: process.env.TTS_MODEL || ElevenLabsTtsProvider.DEFAULT_MODEL,
        }),
      }
    );
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

/**
 * Provider-Auswahl: TTS_PROVIDER ("openai" | "elevenlabs") gewinnt; ohne
 * explizite Wahl entscheidet der vorhandene Key.
 */
export function getTtsProvider(): TtsProvider {
  const configured = (process.env.TTS_PROVIDER || "").toLowerCase();
  if (configured === "elevenlabs") return new ElevenLabsTtsProvider();
  if (configured === "openai") return new OpenAiTtsProvider();
  if (configured) {
    console.warn(`[tts] Unbekannter TTS_PROVIDER "${configured}" — nutze Auto-Auswahl.`);
  }
  if (process.env.OPENAI_API_KEY) return new OpenAiTtsProvider();
  if (process.env.ELEVENLABS_API_KEY) return new ElevenLabsTtsProvider();
  return new OpenAiTtsProvider(); // deaktiviert; UI zeigt den Hinweis
}
