import type { RoomLabel } from "@prisma/client";

/** Anzeige-Namen der deutschen Raum-Taxonomie. */
export const ROOM_LABEL_NAMES: Record<RoomLabel, string> = {
  AUSSENANSICHT: "Aussenansicht",
  EINGANG: "Eingang",
  FLUR: "Flur",
  WOHNZIMMER: "Wohnzimmer",
  KUECHE: "Küche",
  ESSBEREICH: "Essbereich",
  SCHLAFZIMMER: "Schlafzimmer",
  ARBEITSZIMMER: "Arbeitszimmer",
  BAD: "Bad",
  BALKON_TERRASSE: "Balkon/Terrasse",
  GARTEN: "Garten",
  AUSSICHT: "Aussicht",
  GRUNDRISS: "Grundriss",
  SONSTIGES: "Sonstiges",
};

export const ALL_ROOM_LABELS = Object.keys(ROOM_LABEL_NAMES) as RoomLabel[];

/**
 * Natürliche Begehungsreihenfolge: außen → Eingang → Wohnbereiche → private
 * Räume → Außenflächen. Grundrisse laufen nicht ins Video (nur Exposé).
 */
export const WALKTHROUGH_ORDER: readonly RoomLabel[] = [
  "AUSSENANSICHT",
  "EINGANG",
  "FLUR",
  "WOHNZIMMER",
  "ESSBEREICH",
  "KUECHE",
  "ARBEITSZIMMER",
  "SCHLAFZIMMER",
  "BAD",
  "BALKON_TERRASSE",
  "GARTEN",
  "AUSSICHT",
  "SONSTIGES",
];

export function walkthroughRank(label: RoomLabel): number {
  const index = WALKTHROUGH_ORDER.indexOf(label);
  return index === -1 ? WALKTHROUGH_ORDER.length : index;
}

/** Räume, die standardmäßig nicht im Video landen. */
export const EXCLUDED_FROM_VIDEO: readonly RoomLabel[] = ["GRUNDRISS"];
