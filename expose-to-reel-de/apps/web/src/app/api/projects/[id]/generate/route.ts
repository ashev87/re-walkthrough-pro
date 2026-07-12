import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { checkRateLimit } from "@/server/rateLimit";
import { startGeneration } from "@/server/services/generation";

type Context = { params: Promise<{ id: string }> };

/**
 * Generierung starten. Idempotent über den Header „Idempotency-Key“;
 * Rate-Limit pro Organisation.
 */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;

  const limit = checkRateLimit(`generate:${user.organizationId}`, 5, 60_000);
  if (!limit.allowed) {
    return jsonError(
      `Zu viele Generierungen — bitte in ${limit.retryAfterSeconds}s erneut versuchen.`,
      429
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  const { job, reused } = await startGeneration(user, id, idempotencyKey);
  return jsonOk({ job, reused }, { status: reused ? 200 : 202 });
});
