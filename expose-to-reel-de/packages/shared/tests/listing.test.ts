import { describe, expect, test } from "vitest";
import { listingDataSchema, normalizeListingInput } from "../src/domain/listing";

const base = {
  marketingType: "KAUF" as const,
  objectType: "Wohnung",
  titel: "Testwohnung in Leipzig",
  plz: "04155",
  ort: "Leipzig",
  kaufpreis: 250000,
};

describe("Exposé-Validierung", () => {
  test("akzeptiert vollständigen Kauf-Datensatz", () => {
    expect(listingDataSchema.safeParse(base).success).toBe(true);
  });

  test("Kauf ohne Kaufpreis wird abgelehnt", () => {
    const { kaufpreis: _kaufpreis, ...rest } = base;
    const result = listingDataSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("Miete ohne Kaltmiete wird abgelehnt", () => {
    const result = listingDataSchema.safeParse({
      ...base,
      marketingType: "MIETE",
      kaufpreis: undefined,
    });
    expect(result.success).toBe(false);
  });

  test("Kaltmiete bei Kauf ist unzulässig", () => {
    const result = listingDataSchema.safeParse({ ...base, kaltmiete: 900 });
    expect(result.success).toBe(false);
  });

  test("ungültige PLZ wird abgelehnt", () => {
    expect(listingDataSchema.safeParse({ ...base, plz: "123" }).success).toBe(false);
    expect(listingDataSchema.safeParse({ ...base, plz: "ABCDE" }).success).toBe(false);
  });

  test("Energieangaben nur mit Ausweis-Typ", () => {
    const result = listingDataSchema.safeParse({ ...base, energieklasse: "B" });
    expect(result.success).toBe(false);
    const withType = listingDataSchema.safeParse({
      ...base,
      energieausweisTyp: "Bedarfsausweis",
      energieklasse: "B",
    });
    expect(withType.success).toBe(true);
  });

  test("normalizeListingInput wandelt leere Strings in null", () => {
    const parsed = listingDataSchema.parse({ ...base, strasse: "", provision: "" });
    const normalized = normalizeListingInput(parsed);
    expect(normalized.strasse).toBeNull();
    expect(normalized.provision).toBeNull();
    expect(normalized.kaufpreis).toBe(250000);
  });
});
