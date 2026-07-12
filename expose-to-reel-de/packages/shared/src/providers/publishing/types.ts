/**
 * Veröffentlichung fertiger Videos. Lokaler Download/Export zuerst;
 * Portal-Veröffentlichung (z. B. ImmoScout24-Medien) nur als deaktiviertes
 * Scaffold. Jede Veröffentlichung setzt server-seitig geprüfte Freigabe
 * (ApprovalRecord) voraus.
 */

export interface PublishInput {
  projectId: string;
  videoVersionId: string;
  approvalRecordId: string;
  /** Explizite Nutzeraktion — Veröffentlichung passiert nie automatisch. */
  requestedByUserId: string;
}

export interface PublishResult {
  providerKey: string;
  /** z. B. Download-URLs oder externe Medien-IDs. */
  references: Record<string, string>;
}

export interface PublishingProvider {
  readonly key: string;
  readonly displayName: string;
  isEnabled(): boolean;
  publish(input: PublishInput): Promise<PublishResult>;
}
