import { env } from "../../env";
import { ProviderNotConfiguredError } from "../errors";
import type { PublishInput, PublishResult, PublishingProvider } from "./types";

/**
 * ImmoScout24-Medienveröffentlichung — DEAKTIVIERTES SCAFFOLD.
 *
 * Voraussetzungen für eine spätere Aktivierung (siehe README):
 *   1. Offizieller API-Zugang des Betreibers (OAuth-Client) mit dokumentierten
 *      Credentials; Ablage ausschließlich verschlüsselt in ProviderConnection
 *      oder über Umgebungsvariablen (IS24_OAUTH_CLIENT_ID/-SECRET).
 *   2. IS24_PUBLISH_ENABLED="true" + IS24_API_BASE_URL konfiguriert.
 *   3. Projekt ist APPROVED und der Nutzer löst die Veröffentlichung explizit
 *      aus — dieser Adapter wird nie automatisch aufgerufen.
 *   4. Implementierung: Video als Anhang zum eigenen Exposé des Kunden
 *      hochladen (Attachment-Endpunkte der offiziellen API), niemals fremde
 *      Exposés anfassen.
 *
 * Ohne diese Voraussetzungen wirft publish() ProviderNotConfiguredError.
 */
export class ImmoScout24PublishingAdapter implements PublishingProvider {
  readonly key = "immoscout24_publish";
  readonly displayName = "ImmoScout24-Medien (autorisierte API, inaktiv)";

  isEnabled(): boolean {
    return (
      env.is24PublishEnabled &&
      Boolean(process.env.IS24_API_BASE_URL) &&
      Boolean(process.env.IS24_OAUTH_CLIENT_ID) &&
      Boolean(process.env.IS24_OAUTH_CLIENT_SECRET)
    );
  }

  publish(_input: PublishInput): Promise<PublishResult> {
    if (!this.isEnabled()) {
      return Promise.reject(
        new ProviderNotConfiguredError(
          this.key,
          "Offizielle API-Credentials fehlen — Veröffentlichung bleibt deaktiviert (siehe README)."
        )
      );
    }
    // Bewusst nicht implementiert: keine verifizierten Endpunkt-Details
    // vorhanden. Implementierungsschritte siehe Klassen-Kommentar.
    return Promise.reject(
      new ProviderNotConfiguredError(
        this.key,
        "Adapter ist ein Scaffold; Implementierung erfordert dokumentierten API-Vertrag."
      )
    );
  }
}
