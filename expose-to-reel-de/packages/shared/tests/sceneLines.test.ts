import { describe, expect, test } from "vitest";
import {
  buildSceneLinesPrompt,
  narrationWordBudget,
  sceneLinesSchema,
  truncateLine,
  SCENE_LINE_MAX_CHARS,
} from "../src/providers/texts/sceneLines";

describe("sceneLines", () => {
  test("Wortbudget ≈ 2,5 Wörter/s, min. 4", () => {
    expect(narrationWordBudget(4)).toBe(10);
    expect(narrationWordBudget(1)).toBe(4);
  });

  test("truncateLine kappt an Wortgrenze auf max. Länge", () => {
    const long = "wort ".repeat(40).trim();
    const cut = truncateLine(long);
    expect(cut.length).toBeLessThanOrEqual(SCENE_LINE_MAX_CHARS);
    expect(cut.endsWith("wort")).toBe(true);
  });

  test("Schema akzeptiert Zeilen und kappt Überlänge", () => {
    const parsed = sceneLinesSchema.parse({
      sceneLines: [
        { sortIndex: 0, text: "Kurz." },
        { sortIndex: 1, text: "x".repeat(300) },
      ],
    });
    expect(parsed.sceneLines[1]!.text.length).toBeLessThanOrEqual(
      SCENE_LINE_MAX_CHARS
    );
  });

  test("Prompt enthält Raum, Dauer und Wortbudget je Shot", () => {
    const prompt = buildSceneLinesPrompt(
      "Titel: Testvilla",
      [
        { sortIndex: 0, roomName: "Außenansicht", durationSec: 4 },
        { sortIndex: 1, roomName: "Küche", durationSec: 6 },
      ],
      false
    );
    expect(prompt).toContain("Außenansicht");
    expect(prompt).toContain("max. 10 Wörter");
    expect(prompt).toContain("max. 15 Wörter");
    expect(prompt).toContain("FREIGEGEBENE FAKTEN");
  });
});
