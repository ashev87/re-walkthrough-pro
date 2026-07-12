import type { ListingDataInput } from "../../domain/listing";

/**
 * Quelle für Exposé-Daten + Fotos. Der manuelle Upload ist der MVP-Pfad;
 * API-Quellen (z. B. autorisierte ImmoScout24-Verbindung) sind hinter
 * Feature-Flags gekapselt und ohne Credentials deaktiviert.
 */

export interface ImportedPhoto {
  /** Quelle des Bildes (z. B. signierte URL des autorisierten APIs). */
  url: string;
  filename: string;
  caption?: string;
}

export interface ImportedListing {
  listing: ListingDataInput;
  photos: ImportedPhoto[];
  /** Externe Referenz (z. B. Exposé-ID) für Audit-Zwecke. */
  externalId?: string;
}

export interface ListingSourceProvider {
  readonly key: string;
  readonly displayName: string;
  /** false ⇒ UI bietet die Quelle nicht an. */
  isEnabled(): boolean;
  /**
   * Importiert ein einzelnes, vom Nutzer autorisiertes Exposé.
   * @param reference Provider-spezifische Referenz (z. B. Exposé-ID/-URL).
   */
  importListing(reference: string, organizationId: string): Promise<ImportedListing>;
}
