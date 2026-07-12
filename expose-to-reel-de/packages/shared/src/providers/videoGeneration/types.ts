/**
 * Video-Generierung: ein kurzer Clip pro ausgewähltem Bild.
 * MockVideoProvider (ffmpeg-Ken-Burns) ist der Entwicklungs-Standard.
 */

export interface SceneRenderSpec {
  /** Quellbild (normalisiert, JPEG/PNG). */
  imageBytes: Buffer;
  /** Vollständiger Prompt inkl. Inhalts-Leitplanken. */
  prompt: string;
  /** Schlüssel der Kamerabewegung (siehe domain/cameraMoves). */
  cameraMoveKey: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** Sichtbares Label (z. B. „MOCK-VORSCHAU“); leer = kein Overlay. */
  overlayLabel?: string;
  /**
   * Dezentes Szenen-Label (Raum-Name) unten links — Opt-in-Option
   * „Text-Overlays“ der Generierung.
   */
  sceneLabel?: string;
  /** Szenentext (Option „Text-Overlays“) — wird über dem Raum-Label gezeichnet. */
  narrationText?: string;
  /** Breite/Höhe des Quellbilds (für die 9:16-Moduswahl). */
  sourceAspect?: number;
  /** Grundriss → Blur-Pad statt Sweep im Portrait-Format. */
  isFloorplan?: boolean;
  /** Schwenkrichtung im 9:16-Sweep: 1 = links→rechts, −1 = rechts→links. */
  sweepDirection?: 1 | -1;
}

export interface SceneRenderResult {
  /** H.264-MP4-Bytes des gerenderten Clips. */
  videoBytes: Buffer;
  providerKey: string;
}

export interface VideoGenerationProvider {
  readonly key: string;
  readonly displayName: string;
  /**
   * Sichtbares Label, das der Worker in jede Szene einbrennt (Demo-/Mock-
   * Betrieb). undefined ⇒ Ausgabe ohne Overlay (finales Material).
   */
  readonly watermarkLabel?: string;
  isEnabled(): boolean;
  renderScene(spec: SceneRenderSpec): Promise<SceneRenderResult>;
}
