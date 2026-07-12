import { MAX_UPLOAD_BYTES } from "@e2r/shared";
import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { reorderPhotos, uploadPhoto } from "@/server/services/photos";

type Context = { params: Promise<{ id: string }> };

/** Foto-Upload (multipart/form-data: file, caption?). */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Erwartet multipart/form-data mit Feld „file“.", 422);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("Feld „file“ fehlt.", 422);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError("Datei zu groß (max. 15 MB).", 413);
  }
  const caption = form.get("caption");
  const buffer = Buffer.from(await file.arrayBuffer());
  const asset = await uploadPhoto(user, id, {
    buffer,
    filename: file.name || "foto.jpg",
    mimeType: file.type,
    caption: typeof caption === "string" ? caption : undefined,
  });
  return jsonOk(asset, { status: 201 });
});

const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

/** Reihenfolge aller Quellfotos setzen. */
export const PUT = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Ungültige Reihenfolge.", 422);
  await reorderPhotos(user, id, parsed.data.orderedIds);
  return jsonOk(null);
});
