import { describe, expect, test } from "vitest";
import { mapSceneLinesToShots } from "@/server/services/texts";

describe("mapSceneLinesToShots", () => {
  const shots = [
    { id: "a", sortIndex: 0 },
    { id: "b", sortIndex: 2 },
  ];

  test("nur Shots mit neuer Zeile werden aktualisiert; andere bleiben unangetastet", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 2, text: "Zeile für b" },
    ]);
    expect(result).toEqual([{ id: "b", narration: "Zeile für b" }]);
  });

  test("leere/Whitespace-Zeilen erzeugen kein Update", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 0, text: "   " },
    ]);
    expect(result).toEqual([]);
  });

  test("leere LLM-Antwort nullt keine bestehenden Zeilen (Regression)", () => {
    expect(mapSceneLinesToShots(shots, [])).toEqual([]);
  });
});
