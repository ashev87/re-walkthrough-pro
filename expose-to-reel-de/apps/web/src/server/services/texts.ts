import Anthropic from "@anthropic-ai/sdk";
import {
  generateMarketingTexts,
  generateSceneLines,
  getLlmProviderKey,
  isTextGenerationEnabled,
  marketingTextsSchema,
  prisma,
  recordAudit,
  ROOM_LABEL_NAMES,
  type MarketingTexts,
  type MarketingTextsInput,
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
        select: { id: true, sortIndex: true, durationSec: true, roomLabel: true },
      },
    },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  const listing = project.listingData;
  if (!listing) {
    throw new ApiError(422, "Bitte zuerst die Exposé-Daten speichern.");
  }

  let texts: MarketingTexts;
  try {
    texts = await generateMarketingTextsSafe(project, listing);
  } catch (error) {
    throw mapLlmError(error);
  }

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

  // Szenen-Skript: eine Zeile pro Shot — best effort, Texte bleiben auch
  // ohne Zeilen nutzbar (Fallback: durchgehendes Voiceover-Skript).
  if (project.shots.length > 0) {
    try {
      const lines = await generateSceneLines({
        facts: buildFactsInput(listing),
        roomNames: project.shots.map((shot) => ROOM_LABEL_NAMES[shot.roomLabel]),
        shots: project.shots.map((shot) => ({
          sortIndex: shot.sortIndex,
          roomName: ROOM_LABEL_NAMES[shot.roomLabel],
          durationSec: shot.durationSec,
        })),
      });
      const updates = mapSceneLinesToShots(project.shots, lines);
      await prisma.$transaction(
        updates.map((update) =>
          prisma.shot.update({
            where: { id: update.id },
            data: { narration: update.narration },
          })
        )
      );
    } catch (error) {
      console.warn(
        "[texts] Szenen-Skript fehlgeschlagen — Texte ohne Szenenzeilen:",
        error
      );
    }
  }

  return texts;
}

/** sceneLines (per sortIndex) auf Shot-IDs mappen; ohne Zeile → null. */
export function mapSceneLinesToShots(
  shots: Array<{ id: string; sortIndex: number }>,
  lines: Array<{ sortIndex: number; text: string }>
): Array<{ id: string; narration: string | null }> {
  const byIndex = new Map(lines.map((line) => [line.sortIndex, line.text.trim()]));
  return shots.map((shot) => ({
    id: shot.id,
    narration: byIndex.get(shot.sortIndex) || null,
  }));
}

/** LLM-API-Fehler in verständliche, deutschsprachige Antworten übersetzen. */
function mapLlmError(error: unknown): unknown {
  if (error instanceof Anthropic.APIError) {
    const provider = getLlmProviderKey() === "minimax" ? "MiniMax" : "Anthropic";
    if (
      error.status === 402 ||
      /insufficient.balance/i.test(error.message ?? "")
    ) {
      return new ApiError(
        502,
        `Das Guthaben Ihres ${provider}-Kontos ist aufgebraucht — bitte aufladen oder in .env den LLM_PROVIDER wechseln.`
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new ApiError(
        502,
        `${provider}-API-Key wurde abgelehnt — bitte Key in .env prüfen.`
      );
    }
    if (error.status === 429) {
      return new ApiError(
        429,
        `${provider}-Rate-Limit erreicht — bitte kurz warten und erneut versuchen.`
      );
    }
    return new ApiError(
      502,
      `LLM-Anfrage fehlgeschlagen (${provider}, HTTP ${error.status ?? "?"}).`
    );
  }
  return error;
}

type ProjectWithShots = {
  shots: Array<{ id: string; sortIndex: number; durationSec: number; roomLabel: keyof typeof ROOM_LABEL_NAMES }>;
};
type ListingRow = NonNullable<
  Awaited<ReturnType<typeof prisma.listingData.findFirst>>
>;

/** Freigegebene Fakten aus den Exposé-Daten — Basis für alle Text-Prompts. */
function buildFactsInput(listing: ListingRow): MarketingTextsInput["facts"] {
  return {
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
  };
}

async function generateMarketingTextsSafe(
  project: ProjectWithShots,
  listing: ListingRow
): Promise<MarketingTexts> {
  return generateMarketingTexts({
    facts: buildFactsInput(listing),
    roomNames: project.shots.map((shot) => ROOM_LABEL_NAMES[shot.roomLabel]),
  });
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
