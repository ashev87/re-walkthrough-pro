import { existsSync } from "node:fs";
import {
  ExternalImageToVideoProvider,
  getTtsProvider,
  isAnthropicConfigured,
  resolveFromWorkspaceRoot,
} from "@e2r/shared";

/**
 * Welche Opt-in-Funktionen sind auf dieser Installation konfiguriert?
 * Steuert, welche Optionen die UI anbietet; die Server-Routen prüfen
 * zusätzlich selbst.
 */
export interface Capabilities {
  /** KI-Texte + KI-Bildanalyse (ANTHROPIC_API_KEY). */
  aiTexts: boolean;
  /** Voiceover per TTS (OPENAI_API_KEY). */
  tts: boolean;
  /** Hintergrundmusik (MUSIC_TRACK_PATH zeigt auf eine Datei). */
  music: boolean;
  /** Externer KI-Video-Provider konfiguriert (Hybrid-Modus pro Shot). */
  externalVideo: boolean;
}

export function getCapabilities(): Capabilities {
  const musicTrack = process.env.MUSIC_TRACK_PATH;
  return {
    aiTexts: isAnthropicConfigured(),
    tts: getTtsProvider().isEnabled(),
    music: Boolean(
      musicTrack && existsSync(resolveFromWorkspaceRoot(musicTrack))
    ),
    externalVideo: new ExternalImageToVideoProvider().isEnabled(),
  };
}
