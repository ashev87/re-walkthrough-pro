import { ImmoScout24ListingProvider, parsePropstackId } from "@e2r/shared";
import { z } from "zod";
import { jsonError, jsonOk, requireUser, withApi } from "@/server/api";
import { checkRateLimit } from "@/server/rateLimit";
import { createProject } from "@/server/services/projects";
import {
  importPropstackProject,
  isPropstackConfigured,
} from "@/server/services/propstackImport";

const createSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    sourceType: z
      .enum(["MANUAL_UPLOAD", "IMMOSCOUT24_API", "PROPSTACK"])
      .default("MANUAL_UPLOAD"),
    /** Numerische Objekt-ID oder Propstack-CRM-URL. */
    propstackRef: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceType !== "PROPSTACK" && !data.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: "Projekttitel ist erforderlich.",
      });
    }
    if (data.sourceType === "PROPSTACK" && !data.propstackRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["propstackRef"],
        message: "Propstack-Objekt-ID oder -URL ist erforderlich.",
      });
    }
  });

export const POST = withApi(async (request: Request) => {
  const user = await requireUser(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Ungültige Eingaben.", 422, parsed.error.flatten());
  }

  const { sourceType } = parsed.data;
  if (sourceType === "PROPSTACK") {
    const limit = checkRateLimit(
      `propstack-import:${user.organizationId}`,
      5,
      60_000
    );
    if (!limit.allowed) {
      return jsonError(
        `Zu viele Importe — bitte in ${limit.retryAfterSeconds}s erneut versuchen.`,
        429
      );
    }
    if (!isPropstackConfigured()) {
      return jsonError(
        "Propstack-Key nicht konfiguriert (propstack_api_key in .env setzen, siehe README).",
        501
      );
    }
    const propertyId = parsePropstackId(parsed.data.propstackRef);
    if (!propertyId) {
      return jsonError(
        "Keine Propstack-Objekt-ID erkennbar. Erwartet: numerische ID oder Link mit units/… bzw. properties/… (Kontakt-Links enthalten keine Objekt-ID).",
        422
      );
    }
    const result = await importPropstackProject(user, propertyId);
    return jsonOk({ id: result.projectId, ...result }, { status: 201 });
  }

  if (sourceType === "IMMOSCOUT24_API") {
    const provider = new ImmoScout24ListingProvider();
    if (!provider.isEnabled()) {
      return jsonError(
        "Die autorisierte API-Verbindung ist nicht konfiguriert (siehe README). Bitte „Fotos hochladen“ wählen.",
        501
      );
    }
  }
  const project = await createProject(user, {
    title: parsed.data.title!,
    sourceType,
  });
  return jsonOk(project, { status: 201 });
});
