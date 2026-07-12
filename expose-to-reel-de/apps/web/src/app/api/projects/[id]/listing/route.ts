import { listingDataSchema } from "@e2r/shared";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { upsertListing } from "@/server/services/projects";

type Context = { params: Promise<{ id: string }> };

export const PUT = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = listingDataSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return jsonError("Ungültige Exposé-Daten.", 422, parsed.error.flatten());
  }
  const listing = await upsertListing(user, id, parsed.data);
  return jsonOk(listing);
});
