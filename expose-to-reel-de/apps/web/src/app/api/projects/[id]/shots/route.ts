import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { proposeShots, reorderShots, updateShots } from "@/server/services/shots";

type Context = { params: Promise<{ id: string }> };

/** Automatischen Shotlisten-Vorschlag (neu) erzeugen. */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const shots = await proposeShots(user, id);
  return jsonOk(shots, { status: 201 });
});

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

const patchSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string(),
        selected: z.boolean().optional(),
        roomLabel: z.enum(ROOM_LABELS).optional(),
        preferAiVideo: z.boolean().optional(),
        narration: z.string().max(160).nullable().optional(),
      })
    )
    .min(1),
});

/** Auswahl/Labels einzelner Shots ändern. */
export const PATCH = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Ungültige Shot-Änderungen.", 422);
  const shots = await updateShots(user, id, parsed.data.updates);
  return jsonOk(shots);
});

const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

/** Shot-Reihenfolge setzen. */
export const PUT = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Ungültige Reihenfolge.", 422);
  const shots = await reorderShots(user, id, parsed.data.orderedIds);
  return jsonOk(shots);
});
