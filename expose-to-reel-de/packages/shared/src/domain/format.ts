/**
 * Deutsche Zahlen- und Faktenformatierung. Es werden ausschließlich
 * gelieferte, freigegebene Werte formatiert — nie Werte erfunden.
 */

const numberFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
});

const currencyFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const currencyFormatCents = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export function formatEuro(value: number): string {
  return Number.isInteger(value)
    ? currencyFormat.format(value)
    : currencyFormatCents.format(value);
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatArea(value: number): string {
  return `${numberFormat.format(value)} m²`;
}

export function formatRooms(value: number): string {
  const label = value === 1 ? "Zimmer" : "Zimmer";
  return `${numberFormat.format(value)} ${label}`;
}

export interface ApprovedListingFacts {
  marketingType: "KAUF" | "MIETE";
  objectType: string;
  titel: string;
  plz: string;
  ort: string;
  kaufpreis?: number | null;
  kaltmiete?: number | null;
  warmmiete?: number | null;
  zimmer?: number | null;
  wohnflaeche?: number | null;
  grundstuecksflaeche?: number | null;
  baujahr?: number | null;
  energieklasse?: string | null;
}

/**
 * Kurze Faktenzeile für Untertitel/Poster — nur aus gelieferten Feldern.
 */
export function buildFactLine(facts: ApprovedListingFacts): string {
  const parts: string[] = [];
  if (facts.zimmer != null) parts.push(formatRooms(facts.zimmer));
  if (facts.wohnflaeche != null) parts.push(formatArea(facts.wohnflaeche));
  if (facts.marketingType === "KAUF" && facts.kaufpreis != null) {
    parts.push(formatEuro(facts.kaufpreis));
  }
  if (facts.marketingType === "MIETE" && facts.kaltmiete != null) {
    parts.push(`${formatEuro(facts.kaltmiete)} Kaltmiete`);
  }
  return parts.join(" · ");
}

/** Ortszeile unter Berücksichtigung der Adress-Sichtbarkeit. */
export function buildLocationLine(
  facts: { plz: string; ort: string; strasse?: string | null; hausnummer?: string | null },
  visibility: "FULL" | "STREET_ONLY" | "CITY_ONLY"
): string {
  if (visibility === "FULL" && facts.strasse) {
    const street = [facts.strasse, facts.hausnummer].filter(Boolean).join(" ");
    return `${street}, ${facts.plz} ${facts.ort}`;
  }
  if (visibility === "STREET_ONLY" && facts.strasse) {
    return `${facts.strasse}, ${facts.plz} ${facts.ort}`;
  }
  return `${facts.plz} ${facts.ort}`;
}
