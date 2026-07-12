import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { attestRights } from "@/server/services/photos";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  scope: z.string().trim().min(3).max(300),
  sourceDescription: z.string().trim().min(3).max(1000),
  confirmed: z.literal(true, {
    errorMap: () => ({
      message: "Die Rechte-Bestätigung muss aktiv bestätigt werden.",
    }),
  }),
});

/** Quellen-/Rechte-Bestätigung für die hochgeladenen Fotos. */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Rechte-Bestätigung unvollständig.", 422, parsed.error.flatten());
  }
  const attestation = await attestRights(user, id, parsed.data);
  return jsonOk(attestation, { status: 201 });
});
