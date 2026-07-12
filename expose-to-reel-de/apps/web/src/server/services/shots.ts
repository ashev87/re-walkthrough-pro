import {
  buildShotPrompt,
  cameraMoveForRoom,
  prisma,
  recordAudit,
  ROOM_LABEL_NAMES,
  selectHeroShots,
} from "@e2r/shared";
import type { RoomLabel } from "@prisma/client";
import { ApiError } from "../api";
import type { SessionUser } from "../session";

/** Shotlisten-Verwaltung: automatischer Vorschlag + Nutzer-Overrides. */

export const DEFAULT_SCENE_DURATION_SEC = 4;

const EDITABLE_STATUSES = ["DRAFT", "NEEDS_REVIEW", "READY", "FAILED"] as const;

async function requireEditableProject(user: SessionUser, projectId: string) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  if (!(EDITABLE_STATUSES as readonly string[]).includes(project.status)) {
    throw new ApiError(
      409,
      "Die Shotliste ist in diesem Status nicht bearbeitbar."
    );
  }
  return project;
}

function shotFieldsForRoom(roomLabel: RoomLabel) {
  const move = cameraMoveForRoom(roomLabel);
  return {
    cameraMove: move.key,
    prompt: buildShotPrompt({
      roomLabel,
      roomName: ROOM_LABEL_NAMES[roomLabel],
      moveInstruction: move.instruction,
    }),
  };
}

/** Ersetzt die Shotliste durch den automatischen 6–10-Hero-Vorschlag. */
export async function proposeShots(user: SessionUser, projectId: string) {
  await requireEditableProject(user, projectId);
  const images = await prisma.mediaAsset.findMany({
    where: { projectId, kind: "SOURCE_IMAGE" },
    orderBy: { sortIndex: "asc" },
  });
  if (images.length === 0) {
    throw new ApiError(422, "Keine Fotos vorhanden — bitte zuerst hochladen.");
  }
  const { selectedIds } = selectHeroShots(
    images.map((img) => ({
      id: img.id,
      roomLabel: img.roomLabel ?? "SONSTIGES",
      sortIndex: img.sortIndex,
      isLowResolution: img.isLowResolution,
      isLikelyFloorplan: img.isLikelyFloorplan,
      duplicateOfId: img.duplicateOfId,
      excluded: img.excluded,
      width: img.width,
      height: img.height,
    }))
  );
  if (selectedIds.length === 0) {
    throw new ApiError(
      422,
      "Kein geeignetes Foto für die Shotliste (alle ausgeschlossen/Duplikate/Grundrisse?)."
    );
  }
  const imageById = new Map(images.map((img) => [img.id, img]));

  await prisma.$transaction(async (tx) => {
    await tx.shot.deleteMany({ where: { projectId } });
    for (const [index, id] of selectedIds.entries()) {
      const image = imageById.get(id)!;
      const roomLabel = image.roomLabel ?? "SONSTIGES";
      await tx.shot.create({
        data: {
          projectId,
          mediaAssetId: id,
          roomLabel,
          sortIndex: index,
          selected: true,
          durationSec: DEFAULT_SCENE_DURATION_SEC,
          ...shotFieldsForRoom(roomLabel),
        },
      });
    }
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "shots.proposed",
    data: { count: selectedIds.length },
  });
  return prisma.shot.findMany({
    where: { projectId },
    orderBy: { sortIndex: "asc" },
  });
}

export interface ShotUpdate {
  id: string;
  selected?: boolean;
  roomLabel?: RoomLabel;
  /** Hybrid-Modus: Szene über den externen KI-Video-Provider rendern. */
  preferAiVideo?: boolean;
  /** Szenentext (null/leer = entfernen). */
  narration?: string | null;
}

/** Einzel-Updates (Auswahl, Raum-Label → Prompt/Kamera neu). */
export async function updateShots(
  user: SessionUser,
  projectId: string,
  updates: ShotUpdate[]
) {
  await requireEditableProject(user, projectId);
  const shots = await prisma.shot.findMany({ where: { projectId } });
  const known = new Set(shots.map((s) => s.id));
  for (const update of updates) {
    if (!known.has(update.id)) {
      throw new ApiError(404, "Shot nicht gefunden.");
    }
  }
  await prisma.$transaction(
    updates.map((update) =>
      prisma.shot.update({
        where: { id: update.id },
        data: {
          selected: update.selected,
          preferAiVideo: update.preferAiVideo,
          narration:
            update.narration === undefined
              ? undefined
              : update.narration?.trim() || null,
          ...(update.roomLabel
            ? { roomLabel: update.roomLabel, ...shotFieldsForRoom(update.roomLabel) }
            : {}),
        },
      })
    )
  );
  return prisma.shot.findMany({
    where: { projectId },
    orderBy: { sortIndex: "asc" },
  });
}

/** Komplette Neuordnung der Shot-Reihenfolge. */
export async function reorderShots(
  user: SessionUser,
  projectId: string,
  orderedIds: string[]
) {
  await requireEditableProject(user, projectId);
  const shots = await prisma.shot.findMany({
    where: { projectId },
    select: { id: true },
  });
  const known = new Set(shots.map((s) => s.id));
  if (
    orderedIds.length !== known.size ||
    !orderedIds.every((id) => known.has(id))
  ) {
    throw new ApiError(422, "Reihenfolge enthält unbekannte oder fehlende Shots.");
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.shot.update({ where: { id }, data: { sortIndex: index } })
    )
  );
  return prisma.shot.findMany({
    where: { projectId },
    orderBy: { sortIndex: "asc" },
  });
}
