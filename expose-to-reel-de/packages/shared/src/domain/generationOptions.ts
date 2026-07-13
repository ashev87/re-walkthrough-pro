import { z } from "zod";

/**
 * Opt-in-Optionen einer Video-Generierung. Alle Optionen sind standardmäßig
 * aus; die Verfügbarkeit hängt von der Konfiguration ab (siehe Capabilities
 * im Web-Server) und wird server-seitig geprüft.
 */
export const generationOptionsSchema = z.object({
  /** Hintergrundmusik aus MUSIC_TRACK_PATH einmischen. */
  withMusic: z.boolean().default(false),
  /** Raum-Label als dezentes Text-Overlay in jede Szene rendern. */
  withTextOverlays: z.boolean().default(false),
  /**
   * Stil der Text-Overlays: „klein“ = dezente Zeile unten links (Standard),
   * „gross“ = großer zentrierter Szenentext für Ton-aus-Wiedergabe.
   * Unbekannte/fehlende Werte fallen tolerant auf „klein“ zurück.
   */
  overlayStyle: z.enum(["klein", "gross"]).catch("klein").default("klein"),
  /** Abschluss-Karte mit freigegebenen Fakten anhängen. */
  withEndCard: z.boolean().default(false),
  /** Gespeichertes Voiceover-Skript per TTS einsprechen und einmischen. */
  withVoiceover: z.boolean().default(false),
});

export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  withMusic: false,
  withTextOverlays: false,
  overlayStyle: "klein",
  withEndCard: false,
  withVoiceover: false,
};

export function parseGenerationOptions(value: unknown): GenerationOptions {
  const parsed = generationOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_GENERATION_OPTIONS;
}
