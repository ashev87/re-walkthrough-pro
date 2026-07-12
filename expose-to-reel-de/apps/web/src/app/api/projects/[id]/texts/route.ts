import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { checkRateLimit } from "@/server/rateLimit";
import { generateTextsForProject, saveTexts } from "@/server/services/texts";

type Context = { params: Promise<{ id: string }> };

/** KI-Marketing-Texte erzeugen (Opt-in; nur freigegebene Fakten). */
export const POST = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const limit = checkRateLimit(`texts:${user.organizationId}`, 5, 60_000);
  if (!limit.allowed) {
    return jsonError(
      `Zu viele Text-Generierungen — bitte in ${limit.retryAfterSeconds}s erneut versuchen.`,
      429
    );
  }
  const texts = await generateTextsForProject(user, id);
  return jsonOk(texts, { status: 201 });
});

/** Vom Nutzer geprüfte/bearbeitete Texte speichern. */
export const PUT = withApi(async (request: Request, context: Context) => {
  const user = await requireUser(request);
  const { id } = await context.params;
  const texts = await saveTexts(user, id, await request.json().catch(() => null));
  return jsonOk(texts);
});
