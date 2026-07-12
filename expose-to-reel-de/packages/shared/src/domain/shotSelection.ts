import type { RoomLabel } from "@prisma/client";
import { EXCLUDED_FROM_VIDEO, walkthroughRank } from "./rooms";

/**
 * Deterministische Hero-Shot-Auswahl: 6–10 Bilder, Duplikate/Grundrisse/
 * niedrige Auflösung raus, Raumvielfalt vor Raumdopplung, Ergebnis in
 * Begehungsreihenfolge. Jede Entscheidung kann der Nutzer überstimmen.
 */

export const HERO_MIN = 6;
export const HERO_MAX = 10;

export interface SelectableImage {
  id: string;
  roomLabel: RoomLabel;
  sortIndex: number;
  isLowResolution: boolean;
  isLikelyFloorplan: boolean;
  duplicateOfId: string | null;
  excluded: boolean;
  width: number | null;
  height: number | null;
}

export interface ShotSelectionResult {
  /** Bild-IDs in finaler Begehungsreihenfolge. */
  selectedIds: string[];
}

function qualityScore(image: SelectableImage): number {
  let score = 0;
  if (!image.isLowResolution) score += 4;
  if (image.width && image.height) {
    const pixels = image.width * image.height;
    if (pixels >= 2_000_000) score += 2;
    else if (pixels >= 1_000_000) score += 1;
  }
  return score;
}

export function selectHeroShots(
  images: readonly SelectableImage[]
): ShotSelectionResult {
  const eligible = images.filter(
    (img) =>
      !img.excluded &&
      !img.isLikelyFloorplan &&
      img.duplicateOfId === null &&
      !EXCLUDED_FROM_VIDEO.includes(img.roomLabel)
  );

  // Gruppieren nach Raum, innerhalb der Gruppe: beste Qualität zuerst,
  // bei Gleichstand die vom Nutzer gewählte Reihenfolge.
  const byRoom = new Map<RoomLabel, SelectableImage[]>();
  for (const img of eligible) {
    const group = byRoom.get(img.roomLabel) ?? [];
    byRoom.set(img.roomLabel, [...group, img]);
  }
  for (const [label, group] of byRoom) {
    byRoom.set(
      label,
      [...group].sort(
        (a, b) => qualityScore(b) - qualityScore(a) || a.sortIndex - b.sortIndex
      )
    );
  }

  // Runde 1: ein bestes Bild pro Raum (Raumvielfalt), Räume in Begehungsreihenfolge.
  const rooms = [...byRoom.keys()].sort(
    (a, b) => walkthroughRank(a) - walkthroughRank(b)
  );
  const picked: SelectableImage[] = [];
  for (const room of rooms) {
    if (picked.length >= HERO_MAX) break;
    const best = byRoom.get(room)![0];
    if (best) picked.push(best);
  }

  // Runde 2: bis HERO_MIN mit zweitbesten Bildern auffüllen — Raumdopplungen
  // nur, wenn die Raumvielfalt allein das Minimum nicht erreicht.
  if (picked.length < HERO_MIN) {
    const seconds = rooms
      .flatMap((room) => byRoom.get(room)!.slice(1))
      .sort(
        (a, b) =>
          walkthroughRank(a.roomLabel) - walkthroughRank(b.roomLabel) ||
          qualityScore(b) - qualityScore(a)
      );
    for (const img of seconds) {
      if (picked.length >= HERO_MIN) break;
      picked.push(img);
    }
  }

  // Begehungsreihenfolge; innerhalb eines Raums beste Qualität zuerst.
  const ordered = [...picked].sort(
    (a, b) =>
      walkthroughRank(a.roomLabel) - walkthroughRank(b.roomLabel) ||
      qualityScore(b) - qualityScore(a) ||
      a.sortIndex - b.sortIndex
  );

  return { selectedIds: ordered.map((img) => img.id) };
}
