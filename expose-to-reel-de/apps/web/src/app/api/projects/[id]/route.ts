import { jsonOk, requireUser, withApi } from "@/server/api";
import { deleteProject } from "@/server/services/projects";

type Context = { params: Promise<{ id: string }> };

/** Löschworkflow: Projekt + alle Medien (DB-Kaskaden + Objektspeicher). */
export const DELETE = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  await deleteProject(user, id);
  return jsonOk(null);
});
