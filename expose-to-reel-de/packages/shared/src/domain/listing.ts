import { z } from "zod";

/**
 * Validierungsschema für manuell erfasste Exposé-Daten. Nur diese
 * freigegebenen Eingaben dürfen in Videotexten/Untertiteln erscheinen.
 */

const money = z.coerce.number().min(0).max(100_000_000);

export const listingDataSchema = z
  .object({
    marketingType: z.enum(["KAUF", "MIETE"]),
    objectType: z.string().trim().min(2).max(80),
    titel: z.string().trim().min(3).max(160),
    plz: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "PLZ muss aus 5 Ziffern bestehen"),
    ort: z.string().trim().min(2).max(120),
    strasse: z.string().trim().max(160).optional().or(z.literal("")),
    hausnummer: z.string().trim().max(20).optional().or(z.literal("")),
    addressVisibility: z
      .enum(["FULL", "STREET_ONLY", "CITY_ONLY"])
      .default("CITY_ONLY"),
    kaufpreis: money.optional(),
    kaltmiete: money.optional(),
    nebenkosten: money.optional(),
    warmmiete: money.optional(),
    zimmer: z.coerce.number().min(0.5).max(100).optional(),
    wohnflaeche: z.coerce.number().min(1).max(100_000).optional(),
    grundstuecksflaeche: z.coerce.number().min(1).max(10_000_000).optional(),
    baujahr: z.coerce.number().int().min(1200).max(2100).optional(),
    provision: z.string().trim().max(200).optional().or(z.literal("")),
    energieausweisTyp: z
      .enum(["Bedarfsausweis", "Verbrauchsausweis"])
      .optional(),
    energiekennwert: z.coerce.number().min(0).max(2000).optional(),
    energieklasse: z
      .enum(["A+", "A", "B", "C", "D", "E", "F", "G", "H"])
      .optional(),
    energietraeger: z.string().trim().max(80).optional().or(z.literal("")),
    beschreibung: z.string().trim().max(10_000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.marketingType === "KAUF" && data.kaufpreis == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kaufpreis"],
        message: "Kaufpreis ist bei Vermarktungsart Kauf erforderlich.",
      });
    }
    if (data.marketingType === "MIETE" && data.kaltmiete == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kaltmiete"],
        message: "Kaltmiete ist bei Vermarktungsart Miete erforderlich.",
      });
    }
    if (data.marketingType === "KAUF" && data.kaltmiete != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kaltmiete"],
        message: "Kaltmiete ist bei Kauf nicht zulässig.",
      });
    }
    const energieFields = [
      data.energiekennwert,
      data.energieklasse,
      data.energietraeger || undefined,
    ];
    if (energieFields.some((v) => v != null) && !data.energieausweisTyp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["energieausweisTyp"],
        message:
          "Energieangaben nur zusammen mit dem Energieausweis-Typ erfassen.",
      });
    }
  });

export type ListingDataInput = z.infer<typeof listingDataSchema>;

/** Leere Strings optionaler Felder → null (für Prisma). */
export function normalizeListingInput(input: ListingDataInput) {
  const nn = <T>(value: T | "" | undefined): T | null =>
    value === "" || value === undefined ? null : value;
  return {
    marketingType: input.marketingType,
    objectType: input.objectType,
    titel: input.titel,
    plz: input.plz,
    ort: input.ort,
    strasse: nn(input.strasse),
    hausnummer: nn(input.hausnummer),
    addressVisibility: input.addressVisibility,
    kaufpreis: input.kaufpreis ?? null,
    kaltmiete: input.kaltmiete ?? null,
    nebenkosten: input.nebenkosten ?? null,
    warmmiete: input.warmmiete ?? null,
    zimmer: input.zimmer ?? null,
    wohnflaeche: input.wohnflaeche ?? null,
    grundstuecksflaeche: input.grundstuecksflaeche ?? null,
    baujahr: input.baujahr ?? null,
    provision: nn(input.provision),
    energieausweisTyp: input.energieausweisTyp ?? null,
    energiekennwert: input.energiekennwert ?? null,
    energieklasse: input.energieklasse ?? null,
    energietraeger: nn(input.energietraeger),
    beschreibung: nn(input.beschreibung),
  };
}
