import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { deletePhoto, updatePhoto } from "@/server/services/photos";

type Context = { params: Promise<{ id: string; photoId: string }> };

const ROOM_LABELS = [
  "AUSSENANSICHT",
  "EINGANG",
  "FLUR",
  "WOHNZIMMER",
  "KUECHE",
  "ESSBEREICH",
  "SCHLAFZIMMER",
  "ARBEITSZIMMER",
  "BAD",
  "BALKON_TERRASSE",
  "GARTEN",
  "AUSSICHT",
  "GRUNDRISS",
  "SONSTIGES",
] as const;

const updateSchema = z.object({
  caption: z.string().max(300).nullable().optional(),
  roomLabel: z.enum(ROOM_LABELS).optional(),
  excluded: z.boolean().optional(),
  isLikelyFloorplan: z.boolean().optional(),
  clearDuplicate: z.boolean().optional(),
});

export const PATCH = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id, photoId } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Ungültige Foto-Änderung.", 422, parsed.error.flatten());
  }
  const asset = await updatePhoto(user, id, photoId, parsed.data);
  return jsonOk(asset);
});

export const DELETE = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id, photoId } = await context.params;
  await deletePhoto(user, id, photoId);
  return jsonOk(null);
});
