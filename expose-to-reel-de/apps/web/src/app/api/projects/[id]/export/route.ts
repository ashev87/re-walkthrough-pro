import { jsonOk, requireUser, withApi } from "@/server/api";
import { exportProject } from "@/server/services/approval";

type Context = { params: Promise<{ id: string }> };

/** Export/Download — server-seitig nur nach Freigabe erlaubt. */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const result = await exportProject(user, id);
  return jsonOk(result);
});
