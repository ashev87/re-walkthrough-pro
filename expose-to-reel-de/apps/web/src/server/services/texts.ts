import {
  generateMarketingTexts,
  isTextGenerationEnabled,
  marketingTextsSchema,
  prisma,
  recordAudit,
  ROOM_LABEL_NAMES,
  type MarketingTexts,
} from "@e2r/shared";
import { ApiError } from "../api";
import type { SessionUser } from "../session";

/**
 * Marketing-Texte (Caption, Beschreibung, Voiceover-Skript). KI-Erzeugung
 * ist Opt-in und strikt faktenbasiert; gespeichert wird immer der vom
 * Nutzer geprüfte/bearbeitete Stand.
 */

const asNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

export async function generateTextsForProject(
  user: SessionUser,
  projectId: string
): Promise<MarketingTexts> {
  if (!isTextGenerationEnabled()) {
    throw new ApiError(
      501,
      "KI-Texte sind nicht konfiguriert (ANTHROPIC_API_KEY setzen — oder LLM_PROVIDER=minimax mit MINIMAX_API_KEY; siehe README)."
    );
  }
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
    include: {
      listingData: true,
      shots: {
        where: { selected: true },
        orderBy: { sortIndex: "asc" },
        select: { roomLabel: true },
      },
    },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  const listing = project.listingData;
  if (!listing) {
    throw new ApiError(422, "Bitte zuerst die Exposé-Daten speichern.");
  }

  const texts = await generateMarketingTexts({
    facts: {
      marketingType: listing.marketingType,
      objectType: listing.objectType,
      titel: listing.titel,
      plz: listing.plz,
      ort: listing.ort,
      strasse: listing.strasse,
      hausnummer: listing.hausnummer,
      addressVisibility: listing.addressVisibility,
      kaufpreis: asNumber(listing.kaufpreis),
      kaltmiete: asNumber(listing.kaltmiete),
      zimmer: asNumber(listing.zimmer),
      wohnflaeche: asNumber(listing.wohnflaeche),
      baujahr: listing.baujahr,
      provision: listing.provision,
      beschreibung: listing.beschreibung,
      energieklasse: listing.energieklasse,
    },
    roomNames: project.shots.map((shot) => ROOM_LABEL_NAMES[shot.roomLabel]),
  });

  await prisma.propertyProject.update({
    where: { id: projectId },
    data: { marketingTexts: texts },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "texts.generated",
  });
  return texts;
}

export async function saveTexts(
  user: SessionUser,
  projectId: string,
  input: unknown
): Promise<MarketingTexts> {
  const parsed = marketingTextsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(422, "Ungültige Texte.", parsed.error.flatten());
  }
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");

  await prisma.propertyProject.update({
    where: { id: projectId },
    data: { marketingTexts: parsed.data },
  });
  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "texts.saved",
  });
  return parsed.data;
}
