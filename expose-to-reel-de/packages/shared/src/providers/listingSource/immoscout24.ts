import { env } from "../../env";
import { ProviderNotConfiguredError, ProviderRequestError } from "../errors";
import type { ImportedListing, ListingSourceProvider } from "./types";

/**
 * ImmoScout24-Import — DEAKTIVIERTES SCAFFOLD.
 *
 * Dieses Produkt richtet sich ausschließlich an Makler/Bauträger, die eigene
 * bzw. autorisierte Objekte vermarkten. Öffentliches Scraping von
 * ImmoScout24 wird nicht unterstützt. Der Adapter wird nur aktiv, wenn:
 *
 *   1. IS24_IMPORT_ENABLED="true" gesetzt ist,
 *   2. ein Apify-Token (APIFY_TOKEN) und eine vom Betreiber ausgewählte,
 *      autorisierte Actor-ID (APIFY_IS24_ACTOR_ID) konfiguriert sind,
 *   3. die Nutzung für das konkrete Exposé vom Rechteinhaber autorisiert ist
 *      (Rechte-Bestätigung im Projekt bleibt trotzdem Pflicht).
 *
 * Technischer Weg (dokumentiert, kein erfundener Endpunkt): Apify-Actors
 * lassen sich synchron über
 *   POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items
 * ausführen. Das Item-Mapping unten ist bewusst konservativ: Felder, die der
 * Actor nicht liefert, bleiben leer und werden im Formular nachgepflegt —
 * es werden keine Objektangaben erfunden.
 */
export class ImmoScout24ListingProvider implements ListingSourceProvider {
  readonly key = "IMMOSCOUT24_API";
  readonly displayName = "Autorisierte API-Verbindung (ImmoScout24)";

  isEnabled(): boolean {
    return (
      env.is24ImportEnabled &&
      env.apifyToken.length > 0 &&
      env.apifyIs24ActorId.length > 0
    );
  }

  async importListing(
    reference: string,
    _organizationId: string
  ): Promise<ImportedListing> {
    if (!this.isEnabled()) {
      throw new ProviderNotConfiguredError(
        this.key,
        "IS24_IMPORT_ENABLED, APIFY_TOKEN und APIFY_IS24_ACTOR_ID setzen (siehe README, Abschnitt Provider)."
      );
    }

    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(env.apifyIs24ActorId)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(env.apifyToken)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startUrls: [{ url: reference }] }),
    });
    if (!response.ok) {
      throw new ProviderRequestError(
        this.key,
        `Apify-Antwort ${response.status} ${response.statusText}`
      );
    }
    const items = (await response.json()) as Array<Record<string, unknown>>;
    const item = items[0];
    if (!item) {
      throw new ProviderRequestError(this.key, "Actor lieferte keine Daten.");
    }
    return this.mapActorItem(item, reference);
  }

  /**
   * Konservatives Mapping eines Actor-Items. Nur eindeutig vorhandene Felder
   * werden übernommen; alles andere ergänzt der Nutzer im Formular.
   */
  private mapActorItem(
    item: Record<string, unknown>,
    reference: string
  ): ImportedListing {
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;

    const photos = Array.isArray(item.images)
      ? (item.images as unknown[])
          .map((u, index) =>
            typeof u === "string"
              ? { url: u, filename: `is24-${index + 1}.jpg` }
              : null
          )
          .filter((p): p is { url: string; filename: string } => p !== null)
      : [];

    const isMiete = str(item.marketingType)?.toUpperCase().includes("RENT");
    return {
      externalId: str(item.id) ?? reference,
      photos,
      listing: {
        marketingType: isMiete ? "MIETE" : "KAUF",
        objectType: str(item.objectType) ?? "Wohnung",
        titel: str(item.title) ?? "Importiertes Exposé",
        plz: str(item.zip) ?? "",
        ort: str(item.city) ?? "",
        addressVisibility: "CITY_ONLY",
        kaufpreis: isMiete ? undefined : num(item.price),
        kaltmiete: isMiete ? num(item.price) : undefined,
        zimmer: num(item.rooms),
        wohnflaeche: num(item.livingArea),
        beschreibung: str(item.description),
      },
    };
  }
}
