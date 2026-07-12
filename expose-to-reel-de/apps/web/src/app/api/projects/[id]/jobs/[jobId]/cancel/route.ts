import { jsonOk, requireUser, withApi } from "@/server/api";
import { cancelGeneration } from "@/server/services/generation";

type Context = { params: Promise<{ id: string; jobId: string }> };

export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id, jobId } = await context.params;
  const job = await cancelGeneration(user, id, jobId);
  return jsonOk(job);
});
