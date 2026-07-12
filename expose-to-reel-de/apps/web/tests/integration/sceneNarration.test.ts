import { describe, expect, test } from "vitest";
import { mapSceneLinesToShots } from "@/server/services/texts";

describe("mapSceneLinesToShots", () => {
  const shots = [
    { id: "a", sortIndex: 0 },
    { id: "b", sortIndex: 2 },
  ];

  test("ordnet Zeilen per sortIndex zu; fehlende → null", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 2, text: "Zeile für b" },
    ]);
    expect(result).toEqual([
      { id: "a", narration: null },
      { id: "b", narration: "Zeile für b" },
    ]);
  });

  test("leere/Whitespace-Zeilen werden zu null", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 0, text: "   " },
    ]);
    expect(result[0]).toEqual({ id: "a", narration: null });
  });
});
