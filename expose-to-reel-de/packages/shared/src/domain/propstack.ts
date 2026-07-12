/**
 * Propstack-Eingabe-Parsing: numerische Objekt-ID oder Propstack-CRM-URL.
 * Port von MWA `app/static/js/app.js` parsePid(); zusätzlich werden
 * Kontakt-Links (/app/contacts/clients/{id}) explizit abgelehnt — das sind
 * Kontakt-IDs, keine Objekt-IDs.
 */
export function parsePropstackId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/contacts?\//i.test(value)) return null;
  const match =
    value.match(/units?\/(\d+)/i) ?? value.match(/properties?\/(\d+)/i);
  if (match) return match[1]!;
  if (/^\d+$/.test(value)) return value;
  const numbers = value.match(/\d{3,}/g);
  return numbers ? numbers[numbers.length - 1]! : null;
}
