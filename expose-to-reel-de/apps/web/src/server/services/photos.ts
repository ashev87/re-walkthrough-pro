import { randomUUID } from "node:crypto";
import {
  computeImageSignals,
  getImageAnalysisProvider,
  getStorage,
  prisma,
  projectStorageKey,
  recordAudit,
  sha256Hex,
  validateUploadedImage,
  UploadValidationError,
} from "@e2r/shared";
import type { RoomLabel } from "@prisma/client";
import { ApiError } from "../api";
import type { SessionUser } from "../session";
import { maybeAdvanceToReview } from "./projects";

/** Foto-Upload, Kuratierung (Labels/Flags/Reihenfolge) und Löschung. */

const UPLOAD_STATUSES = ["DRAFT", "NEEDS_REVIEW", "FAILED"] as const;

async function requireEditableProject(user: SessionUser, projectId: string) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  if (!(UPLOAD_STATUSES as readonly string[]).includes(project.status)) {
    throw new ApiError(409, "Fotos sind in diesem Status nicht bearbeitbar.");
  }
  return project;
}

export async function uploadPhoto(
  user: SessionUser,
  projectId: string,
  file: { buffer: Buffer; filename: string; mimeType: string; caption?: string }
) {
  await requireEditableProject(user, projectId);

  let validated;
  try {
    validated = validateUploadedImage(file.buffer, file.mimeType);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw new ApiError(422, error.message);
    }
    throw error;
  }

  // Bildsignatur (aHash/Weißanteil) — deterministisch, ohne KI-Schlüssel.
  let signals: { perceptualHash: string | null; whiteRatio: number | null } = {
    perceptualHash: null,
    whiteRatio: null,
  };
  try {
    signals = await computeImageSignals(file.buffer);
  } catch (error) {
    console.warn("[upload] Bildsignatur fehlgeschlagen (ffmpeg?):", error);
  }

  const safeName = file.filename.replace(/[^\w.\-äöüÄÖÜß]+/g, "_").slice(-80);
  const extension = validated.mimeType === "image/png" ? "png" : validated.mimeType === "image/webp" ? "webp" : "jpg";
  const storageKey = projectStorageKey(
    user.organizationId,
    projectId,
    "source",
    `${randomUUID()}-${safeName || `foto.${extension}`}`
  );
  await getStorage().put(storageKey, file.buffer, validated.mimeType);

  const sortIndex = await prisma.mediaAsset.count({
    where: { projectId, kind: "SOURCE_IMAGE" },
  });

  const asset = await prisma.mediaAsset.create({
    data: {
      projectId,
      kind: "SOURCE_IMAGE",
      storageKey,
      filename: file.filename,
      mimeType: validated.mimeType,
      sizeBytes: file.buffer.length,
      width: validated.width,
      height: validated.height,
      sha256: sha256Hex(file.buffer),
      perceptualHash: signals.perceptualHash,
      whiteRatio: signals.whiteRatio,
      caption: file.caption?.trim() || null,
      sortIndex,
    },
  });

  await applyAnalysisProposal(projectId, asset.id);
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "photo.uploaded",
    data: { assetId: asset.id, filename: file.filename },
  });
  await maybeAdvanceToReview(projectId);
  return prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
}

/**
 * Analyse-Vorschläge (Label, Low-Res, Grundriss, Duplikat) für ein frisch
 * hochgeladenes Bild anwenden. Bestehende Bilder werden nicht überschrieben —
 * Nutzerentscheidungen bleiben erhalten.
 */
async function applyAnalysisProposal(
  projectId: string,
  newAssetId: string
): Promise<void> {
  const images = await prisma.mediaAsset.findMany({
    where: { projectId, kind: "SOURCE_IMAGE" },
    orderBy: { sortIndex: "asc" },
  });
  const provider = getImageAnalysisProvider();
  const proposals = await provider.analyze(
    images.map((img) => ({
      id: img.id,
      filename: img.filename,
      caption: img.caption,
      width: img.width,
      height: img.height,
      sha256: img.sha256,
      perceptualHash: img.perceptualHash,
      whiteRatio: img.whiteRatio,
      sortIndex: img.sortIndex,
    }))
  );
  const proposal = proposals.find((p) => p.id === newAssetId);
  if (!proposal) return;
  await prisma.mediaAsset.update({
    where: { id: newAssetId },
    data: {
      roomLabel: proposal.roomLabel,
      isLowResolution: proposal.isLowResolution,
      isLikelyFloorplan: proposal.isLikelyFloorplan,
      duplicateOfId: proposal.duplicateOfId,
    },
  });
}

export interface PhotoUpdateInput {
  caption?: string | null;
  roomLabel?: RoomLabel;
  excluded?: boolean;
  isLikelyFloorplan?: boolean;
  clearDuplicate?: boolean;
}

export async function updatePhoto(
  user: SessionUser,
  projectId: string,
  photoId: string,
  input: PhotoUpdateInput
) {
  await requireEditableProject(user, projectId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: photoId, projectId, kind: "SOURCE_IMAGE" },
  });
  if (!asset) throw new ApiError(404, "Foto nicht gefunden.");
  return prisma.mediaAsset.update({
    where: { id: photoId },
    data: {
      caption: input.caption === undefined ? undefined : input.caption?.trim() || null,
      roomLabel: input.roomLabel,
      excluded: input.excluded,
      isLikelyFloorplan: input.isLikelyFloorplan,
      duplicateOfId: input.clearDuplicate ? null : undefined,
    },
  });
}

export async function reorderPhotos(
  user: SessionUser,
  projectId: string,
  orderedIds: string[]
): Promise<void> {
  await requireEditableProject(user, projectId);
  const assets = await prisma.mediaAsset.findMany({
    where: { projectId, kind: "SOURCE_IMAGE" },
    select: { id: true },
  });
  const known = new Set(assets.map((a) => a.id));
  if (
    orderedIds.length !== known.size ||
    !orderedIds.every((id) => known.has(id))
  ) {
    throw new ApiError(422, "Reihenfolge enthält unbekannte oder fehlende Fotos.");
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.mediaAsset.update({ where: { id }, data: { sortIndex: index } })
    )
  );
}

export async function deletePhoto(
  user: SessionUser,
  projectId: string,
  photoId: string
): Promise<void> {
  await requireEditableProject(user, projectId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: photoId, projectId, kind: "SOURCE_IMAGE" },
  });
  if (!asset) throw new ApiError(404, "Foto nicht gefunden.");
  const usedInShots = await prisma.shot.count({
    where: { mediaAssetId: photoId },
  });
  await getStorage().delete(asset.storageKey);
  await prisma.mediaAsset.delete({ where: { id: photoId } });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "photo.deleted",
    data: { assetId: photoId, filename: asset.filename, usedInShots },
  });
}

export async function attestRights(
  user: SessionUser,
  projectId: string,
  input: { scope: string; sourceDescription: string }
) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  const attestation = await prisma.rightsAttestation.create({
    data: {
      projectId,
      userId: user.id,
      scope: input.scope,
      sourceDescription: input.sourceDescription,
    },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "rights.attested",
  });
  await maybeAdvanceToReview(projectId);
  return attestation;
}
