import { describe, expect, test } from "vitest";
import type { RoomLabel } from "@prisma/client";
import {
  HERO_MAX,
  HERO_MIN,
  selectHeroShots,
  type SelectableImage,
} from "../src/domain/shotSelection";

let counter = 0;
function image(
  roomLabel: RoomLabel,
  overrides: Partial<SelectableImage> = {}
): SelectableImage {
  counter++;
  return {
    id: `img-${counter}`,
    roomLabel,
    sortIndex: counter,
    isLowResolution: false,
    isLikelyFloorplan: false,
    duplicateOfId: null,
    excluded: false,
    width: 1920,
    height: 1280,
    ...overrides,
  };
}

describe("Hero-Shot-Auswahl", () => {
  test("schließt Grundrisse, Duplikate und ausgeschlossene Bilder aus", () => {
    const floorplan = image("GRUNDRISS");
    const duplicate = image("WOHNZIMMER", { duplicateOfId: "x" });
    const excluded = image("KUECHE", { excluded: true });
    const keeper = image("WOHNZIMMER");
    const result = selectHeroShots([floorplan, duplicate, excluded, keeper]);
    expect(result.selectedIds).toEqual([keeper.id]);
  });

  test("wählt maximal 10 und bevorzugt Raumvielfalt", () => {
    const images: SelectableImage[] = [];
    const rooms: RoomLabel[] = [
      "AUSSENANSICHT",
      "FLUR",
      "WOHNZIMMER",
      "KUECHE",
      "ESSBEREICH",
      "SCHLAFZIMMER",
      "ARBEITSZIMMER",
      "BAD",
      "BALKON_TERRASSE",
      "GARTEN",
      "AUSSICHT",
    ];
    for (const room of rooms) {
      images.push(image(room), image(room));
    }
    const result = selectHeroShots(images);
    expect(result.selectedIds.length).toBe(HERO_MAX);
    // Raumvielfalt: die ersten 10 IDs decken 10 unterschiedliche Räume ab.
    const chosenRooms = result.selectedIds.map(
      (id) => images.find((img) => img.id === id)!.roomLabel
    );
    expect(new Set(chosenRooms).size).toBe(HERO_MAX);
  });

  test("füllt bis Minimum mit Zweitbildern auf", () => {
    const images = [
      image("WOHNZIMMER"),
      image("WOHNZIMMER"),
      image("WOHNZIMMER"),
      image("KUECHE"),
      image("KUECHE"),
      image("BAD"),
      image("BAD"),
    ];
    const result = selectHeroShots(images);
    expect(result.selectedIds.length).toBe(Math.min(HERO_MIN, images.length));
  });

  test("liefert Begehungsreihenfolge (außen → innen → Außenflächen)", () => {
    const garten = image("GARTEN");
    const bad = image("BAD");
    const aussen = image("AUSSENANSICHT");
    const wohnen = image("WOHNZIMMER");
    const result = selectHeroShots([garten, bad, aussen, wohnen]);
    expect(result.selectedIds).toEqual([aussen.id, wohnen.id, bad.id, garten.id]);
  });

  test("bevorzugt höhere Qualität innerhalb eines Raums", () => {
    const lowRes = image("WOHNZIMMER", { isLowResolution: true, width: 640, height: 480 });
    const highRes = image("WOHNZIMMER");
    const result = selectHeroShots([lowRes, highRes]);
    expect(result.selectedIds[0]).toBe(highRes.id);
  });

  test("kommt mit weniger Bildern als Minimum aus", () => {
    const a = image("AUSSENANSICHT");
    const b = image("WOHNZIMMER");
    const result = selectHeroShots([a, b]);
    expect(result.selectedIds).toEqual([a.id, b.id]);
  });
});
