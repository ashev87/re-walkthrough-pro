import { describe, expect, test } from "vitest";
import { wrapText } from "../src/domain/textWrap";

describe("wrapText", () => {
  test("kurzer Text bleibt eine Zeile", () => {
    expect(wrapText("Helles Wohnzimmer", 34)).toBe("Helles Wohnzimmer");
  });

  test("bricht an Wortgrenzen in max. 2 Zeilen um", () => {
    const result = wrapText(
      "Großzügiger Wohnbereich mit Kamin und Süd-Terrasse",
      30
    );
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
    expect(result.replace("\n", " ")).toBe(
      "Großzügiger Wohnbereich mit Kamin und Süd-Terrasse"
    );
  });

  test("kappt Überlänge mit Ellipse", () => {
    const long =
      "Dieser wirklich sehr lange Szenentext passt niemals in zwei kurze Zeilen und muss deshalb am Ende gekappt werden";
    const result = wrapText(long, 20);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(22);
  });

  test("Ellipse kappt auch ein einzelnes überlanges Wort hart (Layout-Garantie)", () => {
    const result = wrapText(
      "ab cd Supercalifragilisticexpialidocious xyz mehr",
      10,
      2
    );
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  test("einzelnes überlanges Wort wird nicht zerschnitten, aber einzeilig gelassen", () => {
    expect(wrapText("Donaudampfschifffahrtsgesellschaft", 10)).toBe(
      "Donaudampfschifffahrtsgesellschaft"
    );
  });
});
