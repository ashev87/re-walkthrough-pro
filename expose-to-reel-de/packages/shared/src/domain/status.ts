import type { ProjectStatus } from "@prisma/client";

/**
 * Server-seitig erzwungene Zustandsmaschine für Projekte.
 * Insbesondere: Export/Veröffentlichung nur nach Freigabe (APPROVED).
 */
const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ["NEEDS_REVIEW"],
  NEEDS_REVIEW: ["GENERATING", "DRAFT"],
  GENERATING: ["READY", "FAILED", "NEEDS_REVIEW"], // NEEDS_REVIEW = Abbruch durch Nutzer
  READY: ["APPROVED", "NEEDS_REVIEW", "GENERATING"],
  APPROVED: ["EXPORTED", "NEEDS_REVIEW"], // NEEDS_REVIEW = Freigabe zurückziehen
  EXPORTED: ["NEEDS_REVIEW"],
  FAILED: ["GENERATING", "NEEDS_REVIEW"],
};

export function canTransition(
  from: ProjectStatus,
  to: ProjectStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ProjectStatus,
    public readonly to: ProjectStatus
  ) {
    super(`Ungültiger Statuswechsel: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Statusanzeige (Deutsch) für die UI. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Entwurf",
  NEEDS_REVIEW: "Prüfung nötig",
  GENERATING: "Wird generiert",
  READY: "Bereit",
  APPROVED: "Freigegeben",
  EXPORTED: "Exportiert",
  FAILED: "Fehlgeschlagen",
};

/** Nur in diesen Status dürfen Export-/Veröffentlichungsaktionen erfolgen. */
export function isExportAllowed(status: ProjectStatus): boolean {
  return status === "APPROVED" || status === "EXPORTED";
}
