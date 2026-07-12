import { generationOptionsSchema } from "@e2r/shared";
import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { checkRateLimit } from "@/server/rateLimit";
import { startGeneration } from "@/server/services/generation";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  options: generationOptionsSchema.default({}),
});

/**
 * Generierung starten (optional mit Opt-in-Optionen: Musik, Text-Overlays,
 * Endkarte, Voiceover). Idempotent über den Header „Idempotency-Key“;
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

  const parsed = bodySchema.safeParse(
    (await request.json().catch(() => null)) ?? {}
  );
  if (!parsed.success) {
    return jsonError("Ungültige Generierungs-Optionen.", 422, parsed.error.flatten());
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  const { job, reused } = await startGeneration(
    user,
    id,
    idempotencyKey,
    parsed.data.options
  );
  return jsonOk({ job, reused }, { status: reused ? 200 : 202 });
});
