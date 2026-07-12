import { describe, expect, test } from "vitest";
import {
  buildShotPrompt,
  cameraMoveForRoom,
  CONTENT_GUARDRAILS,
  ROOM_CAMERA_MOVES,
} from "../src/domain/cameraMoves";
import { ALL_ROOM_LABELS, ROOM_LABEL_NAMES } from "../src/domain/rooms";

describe("Kamerabewegungen & Prompts", () => {
  test("jeder Raum hat eine zugeordnete Bewegung", () => {
    for (const label of ALL_ROOM_LABELS) {
      expect(ROOM_CAMERA_MOVES[label]).toBeTruthy();
      expect(cameraMoveForRoom(label).instruction.length).toBeGreaterThan(10);
    }
  });

  test("Produktvorgaben: Raum → Bewegung", () => {
    expect(ROOM_CAMERA_MOVES.AUSSENANSICHT).toBe("approach");
    expect(ROOM_CAMERA_MOVES.FLUR).toBe("forward");
    expect(ROOM_CAMERA_MOVES.WOHNZIMMER).toBe("orbit");
    expect(ROOM_CAMERA_MOVES.KUECHE).toBe("lateral");
    expect(ROOM_CAMERA_MOVES.SCHLAFZIMMER).toBe("pushIn");
    expect(ROOM_CAMERA_MOVES.BAD).toBe("reveal");
    expect(ROOM_CAMERA_MOVES.BALKON_TERRASSE).toBe("outwardReveal");
    expect(ROOM_CAMERA_MOVES.GARTEN).toBe("outwardReveal");
    expect(ROOM_CAMERA_MOVES.AUSSICHT).toBe("outwardReveal");
  });

  test("jeder Prompt enthält die Inhalts-Leitplanken", () => {
    for (const label of ALL_ROOM_LABELS) {
      const move = cameraMoveForRoom(label);
      const prompt = buildShotPrompt({
        roomLabel: label,
        roomName: ROOM_LABEL_NAMES[label],
        moveInstruction: move.instruction,
      });
      expect(prompt).toContain(CONTENT_GUARDRAILS);
      expect(prompt).toContain("Do not add");
    }
  });

  test("Prompts enthalten keine Objekt-Fakten (Preis/Fläche/Adresse)", () => {
    const prompt = buildShotPrompt({
      roomLabel: "WOHNZIMMER",
      roomName: ROOM_LABEL_NAMES.WOHNZIMMER,
      moveInstruction: cameraMoveForRoom("WOHNZIMMER").instruction,
    });
    expect(prompt).not.toMatch(/€|m²|straße|preis|miete/i);
  });
});
