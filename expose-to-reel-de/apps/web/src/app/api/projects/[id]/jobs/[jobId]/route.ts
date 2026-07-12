import { jsonOk, requireUser, withApi } from "@/server/api";
import { getGenerationStatus } from "@/server/services/generation";

type Context = { params: Promise<{ id: string; jobId: string }> };

/** Job-Status inkl. Fortschritt pro Szene (Polling). */
export const GET = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id, jobId } = await context.params;
  const status = await getGenerationStatus(user, id, jobId);
  return jsonOk(status);
});
