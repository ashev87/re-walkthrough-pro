import { describe, expect, test } from "vitest";
import {
  buildFactLine,
  buildLocationLine,
  formatArea,
  formatEuro,
  formatNumber,
} from "../src/domain/format";

describe("Deutsche Formatierung", () => {
  test("Zahlen mit deutschem Tausendertrennzeichen", () => {
    expect(formatNumber(1234.5)).toBe((1234.5).toLocaleString("de-DE"));
    expect(formatNumber(84.5)).toContain(",");
  });

  test("Flächen mit m²", () => {
    expect(formatArea(84.5)).toMatch(/m²$/);
    expect(formatArea(84.5)).toContain("84,5");
  });

  test("Euro-Beträge", () => {
    const value = formatEuro(425000);
    expect(value).toContain("425.000");
    expect(value).toContain("€");
  });

  test("Faktenzeile nur aus gelieferten Werten (Miete)", () => {
    const line = buildFactLine({
      marketingType: "MIETE",
      objectType: "Wohnung",
      titel: "Test",
      plz: "04155",
      ort: "Leipzig",
      kaltmiete: 890,
      zimmer: 3,
      wohnflaeche: 84.5,
    });
    expect(line).toContain("3 Zimmer");
    expect(line).toContain("84,5 m²");
    expect(line).toContain("Kaltmiete");
    expect(line).not.toContain("null");
  });

  test("Faktenzeile lässt fehlende Werte weg", () => {
    const line = buildFactLine({
      marketingType: "KAUF",
      objectType: "Haus",
      titel: "Test",
      plz: "14482",
      ort: "Potsdam",
    });
    expect(line).toBe("");
  });

  test("Adress-Sichtbarkeit wird respektiert", () => {
    const facts = {
      plz: "04155",
      ort: "Leipzig",
      strasse: "Georg-Schumann-Straße",
      hausnummer: "12",
    };
    expect(buildLocationLine(facts, "CITY_ONLY")).toBe("04155 Leipzig");
    expect(buildLocationLine(facts, "STREET_ONLY")).toBe(
      "Georg-Schumann-Straße, 04155 Leipzig"
    );
    expect(buildLocationLine(facts, "FULL")).toBe(
      "Georg-Schumann-Straße 12, 04155 Leipzig"
    );
  });
});
