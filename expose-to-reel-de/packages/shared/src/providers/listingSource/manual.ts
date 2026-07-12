import type { ImportedListing, ListingSourceProvider } from "./types";

/**
 * Manueller Upload — der Standard- und MVP-Pfad. Exposé-Daten und Fotos
 * kommen über die Formulare/Upload-Endpunkte der Web-App; dieser Provider
 * dient als Quellen-Marker und beantwortet keine Fernabfragen.
 */
export class ManualUploadProvider implements ListingSourceProvider {
  readonly key = "MANUAL_UPLOAD";
  readonly displayName = "Fotos hochladen (manuell)";

  isEnabled(): boolean {
    return true;
  }

  importListing(): Promise<ImportedListing> {
    return Promise.reject(
      new Error(
        "ManualUploadProvider importiert nicht: Daten werden über Formular und Foto-Upload erfasst."
      )
    );
  }
}
