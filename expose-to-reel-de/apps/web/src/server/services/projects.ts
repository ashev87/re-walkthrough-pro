import {
  assertTransition,
  getStorage,
  InvalidTransitionError,
  normalizeListingInput,
  prisma,
  projectStoragePrefix,
  recordAudit,
  type ListingDataInput,
} from "@e2r/shared";
import { ApiError } from "../api";
import type { SessionUser } from "../session";

/** Projekt-Lebenszyklus: Anlage, Exposé-Daten, Statuswechsel, Löschung. */

export async function createProject(
  user: SessionUser,
  input: { title: string; sourceType: "MANUAL_UPLOAD" | "IMMOSCOUT24_API" }
) {
  if (input.sourceType === "IMMOSCOUT24_API") {
    // Feature-Flag-Prüfung passiert im Route-Handler; hier hart absichern.
    throw new ApiError(
      501,
      "Die autorisierte API-Verbindung ist nicht konfiguriert. Bitte manuellen Upload verwenden."
    );
  }
  const project = await prisma.propertyProject.create({
    data: {
      organizationId: user.organizationId,
      title: input.title,
      sourceType: input.sourceType,
      status: "DRAFT",
    },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId: project.id,
    userId: user.id,
    type: "project.created",
    data: { title: input.title, sourceType: input.sourceType },
  });
  return project;
}

export function transitionOrConflict(
  from: Parameters<typeof assertTransition>[0],
  to: Parameters<typeof assertTransition>[1]
): void {
  try {
    assertTransition(from, to);
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      throw new ApiError(409, error.message);
    }
    throw error;
  }
}

const EDITABLE_STATUSES = ["DRAFT", "NEEDS_REVIEW", "FAILED", "READY"] as const;

export async function upsertListing(
  user: SessionUser,
  projectId: string,
  input: ListingDataInput
) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  if (!(EDITABLE_STATUSES as readonly string[]).includes(project.status)) {
    throw new ApiError(
      409,
      "Exposé-Daten können in diesem Status nicht bearbeitet werden."
    );
  }
  const data = normalizeListingInput(input);
  const listing = await prisma.listingData.upsert({
    where: { projectId },
    update: data,
    create: { ...data, projectId },
  });
  await prisma.propertyProject.update({
    where: { id: projectId },
    data: { title: input.titel },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "listing.updated",
  });
  await maybeAdvanceToReview(projectId);
  return listing;
}

/**
 * DRAFT → NEEDS_REVIEW, sobald Exposé-Daten, mindestens ein Foto und die
 * Rechte-Bestätigung vorliegen.
 */
export async function maybeAdvanceToReview(projectId: string): Promise<void> {
  const project = await prisma.propertyProject.findUnique({
    where: { id: projectId },
    include: {
      listingData: { select: { id: true } },
      rightsAttestations: { select: { id: true }, take: 1 },
      _count: { select: { mediaAssets: { where: { kind: "SOURCE_IMAGE" } } } },
    },
  });
  if (!project || project.status !== "DRAFT") return;
  if (
    project.listingData &&
    project.rightsAttestations.length > 0 &&
    project._count.mediaAssets > 0
  ) {
    await prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "NEEDS_REVIEW" },
    });
  }
}

/** Löschworkflow: erst Objektspeicher, dann Datenbank (Kaskaden). */
export async function deleteProject(
  user: SessionUser,
  projectId: string
): Promise<void> {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  if (project.status === "GENERATING") {
    throw new ApiError(
      409,
      "Projekt wird gerade generiert — bitte zuerst den Job abbrechen."
    );
  }
  await getStorage().deletePrefix(
    projectStoragePrefix(user.organizationId, projectId)
  );
  await prisma.propertyProject.delete({ where: { id: projectId } });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    userId: user.id,
    type: "project.deleted",
    data: { projectId, title: project.title },
  });
}
