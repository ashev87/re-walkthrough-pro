import {
  ImmoScout24PublishingAdapter,
  LocalDownloadPublisher,
  prisma,
  recordAudit,
  sha256Hex,
} from "@e2r/shared";
import { z } from "zod";
import { ApiError } from "../api";
import type { SessionUser } from "../session";
import { transitionOrConflict } from "./projects";

/**
 * Freigabe & Export. Freigabe erfordert die vollständige Checkliste und
 * erzeugt einen unveränderlichen Snapshot inkl. Content-Hashes. Export ist
 * server-seitig nur nach Freigabe möglich.
 */

export const approvalChecklistSchema = z.object({
  factsVerified: z.literal(true, {
    errorMap: () => ({ message: "Alle Fakten müssen geprüft sein." }),
  }),
  noMisleadingContent: z.literal(true, {
    errorMap: () => ({ message: "Irreführende Inhalte müssen ausgeschlossen sein." }),
  }),
  imageRightsConfirmed: z.literal(true, {
    errorMap: () => ({ message: "Bildrechte müssen bestätigt sein." }),
  }),
  privacyReviewed: z.literal(true, {
    errorMap: () => ({ message: "Datenschutz-Prüfung muss abgeschlossen sein." }),
  }),
  addressVisibilityConfirmed: z.literal(true, {
    errorMap: () => ({ message: "Adress-Sichtbarkeit muss bestätigt sein." }),
  }),
});

export type ApprovalChecklist = z.infer<typeof approvalChecklistSchema>;

export async function approveProject(
  user: SessionUser,
  projectId: string,
  checklist: ApprovalChecklist
) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
    include: {
      listingData: true,
      rightsAttestations: { take: 1 },
      shots: { orderBy: { sortIndex: "asc" } },
    },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  transitionOrConflict(project.status, "APPROVED");
  if (!project.listingData) {
    throw new ApiError(422, "Exposé-Daten fehlen.");
  }
  if (project.rightsAttestations.length === 0) {
    throw new ApiError(422, "Rechte-Bestätigung fehlt.");
  }

  const videoVersion = await prisma.videoVersion.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
  });
  if (!videoVersion) throw new ApiError(422, "Kein generiertes Video vorhanden.");

  const assetIds = [
    videoVersion.master16x9AssetId,
    videoVersion.reel9x16AssetId,
    videoVersion.posterAssetId,
    videoVersion.captionsAssetId,
  ].filter((id): id is string => Boolean(id));
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, kind: true, filename: true, sha256: true, sizeBytes: true },
  });

  // Unveränderlicher Freigabe-Snapshot: Fakten + Shotliste + Content-Hashes.
  const { listingData } = project;
  const snapshot = {
    approvedAt: new Date().toISOString(),
    approvedBy: { id: user.id, email: user.email, name: user.name },
    checklist,
    videoVersion: {
      id: videoVersion.id,
      version: videoVersion.version,
      durationSec: videoVersion.durationSec,
    },
    assets,
    listing: JSON.parse(JSON.stringify(listingData)),
    shots: project.shots.map((shot) => ({
      id: shot.id,
      roomLabel: shot.roomLabel,
      sortIndex: shot.sortIndex,
      selected: shot.selected,
      cameraMove: shot.cameraMove,
      prompt: shot.prompt,
      durationSec: shot.durationSec,
      mediaAssetId: shot.mediaAssetId,
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);

  const [record] = await prisma.$transaction([
    prisma.approvalRecord.create({
      data: {
        projectId,
        userId: user.id,
        videoVersionId: videoVersion.id,
        checklist,
        snapshot,
        snapshotSha256: sha256Hex(snapshotJson),
      },
    }),
    prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "APPROVED" },
    }),
  ]);
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "project.approved",
    data: { approvalRecordId: record.id, videoVersionId: videoVersion.id },
  });
  return record;
}

export async function revokeApproval(user: SessionUser, projectId: string) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  transitionOrConflict(project.status, "NEEDS_REVIEW");
  await prisma.propertyProject.update({
    where: { id: projectId },
    data: { status: "NEEDS_REVIEW" },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "project.approvalRevoked",
  });
}

/** Export (Download-URLs) — nur nach Freigabe; markiert Projekt als EXPORTED. */
export async function exportProject(user: SessionUser, projectId: string) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  if (project.status !== "APPROVED" && project.status !== "EXPORTED") {
    throw new ApiError(
      403,
      "Export erst nach Freigabe möglich (Checkliste abschließen)."
    );
  }
  const approval = await prisma.approvalRecord.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!approval) throw new ApiError(422, "Keine Freigabe vorhanden.");

  const publisher = new LocalDownloadPublisher();
  const result = await publisher.publish({
    projectId,
    videoVersionId: approval.videoVersionId,
    approvalRecordId: approval.id,
    requestedByUserId: user.id,
  });

  if (project.status === "APPROVED") {
    await prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "EXPORTED" },
    });
  }
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "project.exported",
    data: { approvalRecordId: approval.id },
  });
  return result;
}

/** Status des (deaktivierten) Portal-Publishing-Scaffolds für die UI. */
export function getPublishingProvidersStatus() {
  const is24 = new ImmoScout24PublishingAdapter();
  return [
    {
      key: is24.key,
      displayName: is24.displayName,
      enabled: is24.isEnabled(),
    },
  ];
}
