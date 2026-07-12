import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import {
  approvalChecklistSchema,
  approveProject,
  revokeApproval,
} from "@/server/services/approval";

type Context = { params: Promise<{ id: string }> };

/** Freigabe mit vollständiger Checkliste; erzeugt unveränderlichen Snapshot. */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const parsed = approvalChecklistSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return jsonError(
      "Alle Punkte der Checkliste müssen bestätigt werden.",
      422,
      parsed.error.flatten()
    );
  }
  const record = await approveProject(user, id, parsed.data);
  return jsonOk(record, { status: 201 });
});

/** Freigabe zurückziehen (Projekt zurück in „Prüfung nötig“). */
export const DELETE = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  await revokeApproval(user, id);
  return jsonOk(null);
});
