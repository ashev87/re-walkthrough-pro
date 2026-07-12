import { describe, expect, test } from "vitest";
import { parsePropstackId } from "../src/domain/propstack";

describe("Propstack-Eingabe-Parsing (Port von MWA parsePid)", () => {
  test("nackte numerische ID", () => {
    expect(parsePropstackId("5472912")).toBe("5472912");
    expect(parsePropstackId("  5472912  ")).toBe("5472912");
  });

  test("CRM-URLs mit units/ bzw. properties/", () => {
    expect(
      parsePropstackId("https://crm.propstack.de/app/units/5472912")
    ).toBe("5472912");
    expect(
      parsePropstackId("https://crm.propstack.de/app/units/5472912?tab=docs")
    ).toBe("5472912");
    expect(parsePropstackId("https://crm.propstack.de/unit/123456")).toBe(
      "123456"
    );
    expect(
      parsePropstackId("https://crm.propstack.de/properties/987654")
    ).toBe("987654");
  });

  test("Fallback: letzte lange Zahl im Text", () => {
    expect(parsePropstackId("Objekt Nr. 5472912 (Koserstraße)")).toBe("5472912");
  });

  test("Kontakt-Links liefern keine Objekt-ID", () => {
    expect(
      parsePropstackId("https://crm.propstack.de/app/contacts/clients/31692831")
    ).toBeNull();
  });

  test("leer/unbrauchbar → null", () => {
    expect(parsePropstackId("")).toBeNull();
    expect(parsePropstackId("   ")).toBeNull();
    expect(parsePropstackId(null)).toBeNull();
    expect(parsePropstackId("kein objekt")).toBeNull();
    expect(parsePropstackId("Anruf um 12 Uhr")).toBeNull(); // zu kurz für den Zahlen-Fallback
  });

  test("rein numerische Eingaben werden unverändert akzeptiert (Referenzverhalten)", () => {
    expect(parsePropstackId("12")).toBe("12");
  });
});
