import { ProviderNotConfiguredError } from "../errors";
import type {
  SceneRenderResult,
  SceneRenderSpec,
  VideoGenerationProvider,
} from "./types";

/**
 * Adapter-Schnittstelle für einen künftigen, freigegebenen
 * Image-to-Video-Provider (z. B. ein lizenzierter KI-Videodienst).
 *
 * BEWUSST NICHT IMPLEMENTIERT: Es existieren hier keine verifizierten
 * Endpunkte oder Credentials, und wir erfinden keine. Integrationsschritte
 * für später:
 *
 *   1. Provider-Vertrag/Schlüssel beschaffen; Credentials verschlüsselt in
 *      ProviderConnection ablegen (AES-256-GCM, siehe crypto.ts).
 *   2. `renderScene` implementieren: Bild + Prompt (inkl. CONTENT_GUARDRAILS
 *      aus domain/cameraMoves.ts) senden, Job pollen, MP4 laden.
 *   3. Ergebnis mit ffprobe validieren (Codec H.264, exakte Zielauflösung,
 *      Dauer ±10 %) — siehe Worker-Pipeline `validateOutput`.
 *   4. VIDEO_PROVIDER="external" setzen; der Worker wählt den Provider über
 *      die Factory in providers/videoGeneration/index.ts.
 *
 * Bis dahin wirft jede Nutzung ProviderNotConfiguredError, und der Worker
 * fällt auf den MockVideoProvider zurück.
 */
export class ExternalImageToVideoProvider implements VideoGenerationProvider {
  readonly key = "external";
  readonly displayName = "Externer Image-to-Video-Provider (nicht konfiguriert)";

  isEnabled(): boolean {
    return false;
  }

  renderScene(_spec: SceneRenderSpec): Promise<SceneRenderResult> {
    return Promise.reject(
      new ProviderNotConfiguredError(
        this.key,
        "Kein verifizierter Video-Provider hinterlegt — MockVideoProvider verwenden (VIDEO_PROVIDER=mock)."
      )
    );
  }
}
