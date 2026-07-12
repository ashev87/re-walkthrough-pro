import type { RoomLabel } from "@prisma/client";

/**
 * Zurückhaltende, raumspezifische Kamerabewegungen. Die Prompts dürfen
 * ausschließlich das Eingabebild beschreiben — niemals Objekte, Personen,
 * bauliche Änderungen, Text oder unbelegte Ausblicke hinzufügen.
 */

export interface CameraMove {
  key: string;
  /** Deutsche Beschreibung für die UI. */
  label: string;
  /** Englische Bewegungs-Instruktion für Video-Provider. */
  instruction: string;
  /** Ken-Burns-Parameter für den Mock-Provider. */
  kenBurns: {
    zoomFrom: number;
    zoomTo: number;
    panX: -1 | 0 | 1; // -1 = nach links, 1 = nach rechts
    panY: -1 | 0 | 1; // -1 = nach oben, 1 = nach unten
  };
}

const MOVES = {
  approach: {
    key: "approach",
    label: "Dezente Annäherung",
    instruction:
      "Subtle slow approach toward the building, or a gentle lateral reveal; stable horizon, no tilt.",
    kenBurns: { zoomFrom: 1.0, zoomTo: 1.12, panX: 0, panY: 0 },
  },
  forward: {
    key: "forward",
    label: "Langsame Vorwärtsbewegung",
    instruction:
      "Slow steady forward movement along the corridor axis, eye level, constant speed.",
    kenBurns: { zoomFrom: 1.0, zoomTo: 1.16, panX: 0, panY: 0 },
  },
  orbit: {
    key: "orbit",
    label: "Sanfter Orbit/Push-in",
    instruction:
      "Gentle partial orbit or slow push-in across the living space, smooth and unhurried.",
    kenBurns: { zoomFrom: 1.04, zoomTo: 1.14, panX: 1, panY: 0 },
  },
  lateral: {
    key: "lateral",
    label: "Langsame Seitwärtsfahrt",
    instruction:
      "Slow lateral glide along the kitchen line, parallel to the counters, constant height.",
    kenBurns: { zoomFrom: 1.08, zoomTo: 1.08, panX: 1, panY: 0 },
  },
  pushIn: {
    key: "pushIn",
    label: "Ruhiger Push-in",
    instruction: "Calm slow push-in toward the center of the room, eye level.",
    kenBurns: { zoomFrom: 1.0, zoomTo: 1.12, panX: 0, panY: 0 },
  },
  reveal: {
    key: "reveal",
    label: "Langsames Aufdecken",
    instruction:
      "Slow reveal of the room, minimal movement, soft and steady framing.",
    kenBurns: { zoomFrom: 1.12, zoomTo: 1.02, panX: 0, panY: 0 },
  },
  outwardReveal: {
    key: "outwardReveal",
    label: "Sanftes Öffnen nach außen",
    instruction:
      "Gentle outward reveal toward the open space, slow and steady, no sky-only framing.",
    kenBurns: { zoomFrom: 1.14, zoomTo: 1.0, panX: 0, panY: 0 },
  },
  still: {
    key: "still",
    label: "Nahezu statisch",
    instruction: "Nearly static shot with a barely perceptible drift.",
    kenBurns: { zoomFrom: 1.0, zoomTo: 1.04, panX: 0, panY: 0 },
  },
} as const satisfies Record<string, CameraMove>;

export type CameraMoveKey = keyof typeof MOVES;

export const CAMERA_MOVES: Record<string, CameraMove> = MOVES;

/** Raum → Standard-Kamerabewegung laut Produktvorgabe. */
export const ROOM_CAMERA_MOVES: Record<RoomLabel, CameraMoveKey> = {
  AUSSENANSICHT: "approach",
  EINGANG: "forward",
  FLUR: "forward",
  WOHNZIMMER: "orbit",
  KUECHE: "lateral",
  ESSBEREICH: "orbit",
  SCHLAFZIMMER: "pushIn",
  ARBEITSZIMMER: "pushIn",
  BAD: "reveal",
  BALKON_TERRASSE: "outwardReveal",
  GARTEN: "outwardReveal",
  AUSSICHT: "outwardReveal",
  GRUNDRISS: "still",
  SONSTIGES: "still",
};

export function cameraMoveForRoom(label: RoomLabel): CameraMove {
  return MOVES[ROOM_CAMERA_MOVES[label]];
}

/**
 * Harte Leitplanken gegen erfundene Inhalte — Bestandteil jedes Prompts an
 * jeden Video-Provider.
 */
export const CONTENT_GUARDRAILS =
  "Preserve the input photograph exactly as provided. Do not add, remove or alter " +
  "any objects, furniture, people, animals, text, logos or watermarks. Do not " +
  "change architecture, materials, lighting fixtures, room layout or views. Do " +
  "not invent anything outside the visible frame. Photorealistic, faithful to the " +
  "source image only.";

export interface ShotPromptInput {
  roomLabel: RoomLabel;
  roomName: string; // deutscher Anzeigename
  moveInstruction: string;
}

/**
 * Erzeugt den Provider-Prompt für einen Shot. Bewusst frei von Exposé-Fakten:
 * Der Prompt beschreibt nur Kamerabewegung + Leitplanken, nie Objekteigenschaften.
 */
export function buildShotPrompt(input: ShotPromptInput): string {
  return (
    `Cinematic real-estate walkthrough scene (${input.roomName}). ` +
    `Camera: ${input.moveInstruction} ` +
    CONTENT_GUARDRAILS
  );
}
