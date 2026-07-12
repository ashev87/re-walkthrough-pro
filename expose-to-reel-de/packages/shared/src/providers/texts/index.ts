import { z } from "zod";
import {
  anthropicTextModel,
  getAnthropicClient,
  isAnthropicConfigured,
} from "../../anthropicClient";
import {
  buildFactLine,
  buildLocationLine,
  type ApprovedListingFacts,
} from "../../domain/format";

/**
 * KI-Marketing-Texte (Opt-in: ANTHROPIC_API_KEY). Erzeugt Caption,
 * Objektbeschreibung und Voiceover-Skript — ausschließlich aus den
 * freigegebenen Exposé-Fakten. Die Texte sind Entwürfe: sie werden in der UI
 * angezeigt, vom Nutzer geprüft/bearbeitet und erst danach verwendet
 * (Voiceover nutzt nur das gespeicherte, geprüfte Skript).
 */

export const marketingTextsSchema = z.object({
  caption: z
    .string()
    .max(2200)
    .describe("Instagram/Reel-Caption auf Deutsch, inkl. 3–6 passender Hashtags"),
  beschreibung: z
    .string()
    .max(4000)
    .describe("Polierte Objektbeschreibung für das Exposé, Deutsch"),
  voiceoverScript: z
    .string()
    .max(1200)
    .describe(
      "Sprechertext für ein 20–35-Sekunden-Voiceover (ca. 50–90 Wörter), Deutsch"
    ),
});

export type MarketingTexts = z.infer<typeof marketingTextsSchema>;

/** JSON-Schema für output_config.format (Längenlimits prüft zod client-seitig). */
const TEXTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    caption: {
      type: "string",
      description:
        "Instagram/Reel-Caption auf Deutsch, 2–4 kurze Zeilen, am Ende 3–6 Hashtags",
    },
    beschreibung: {
      type: "string",
      description: "Polierte Objektbeschreibung für das Exposé, Deutsch, 2–3 Absätze",
    },
    voiceoverScript: {
      type: "string",
      description:
        "Sprechertext für ein 20–35-Sekunden-Voiceover (ca. 50–90 Wörter), Deutsch",
    },
  },
  required: ["caption", "beschreibung", "voiceoverScript"],
  additionalProperties: false,
} as const;

export interface MarketingTextsInput {
  facts: ApprovedListingFacts & {
    strasse?: string | null;
    hausnummer?: string | null;
    addressVisibility: "FULL" | "STREET_ONLY" | "CITY_ONLY";
    baujahr?: number | null;
    provision?: string | null;
    beschreibung?: string | null;
  };
  /** Deutsche Raum-Namen der ausgewählten Szenen, in Reihenfolge. */
  roomNames: string[];
}

export function isTextGenerationEnabled(): boolean {
  return isAnthropicConfigured();
}

/**
 * Fakten-Block für den Prompt: nur gelieferte Werte, formatiert, ohne
 * genaue Adresse, sofern die Sichtbarkeit das nicht erlaubt.
 */
export function buildFactsBlock(input: MarketingTextsInput): string {
  const { facts } = input;
  const lines: string[] = [
    `Titel: ${facts.titel}`,
    `Objektart: ${facts.objectType}`,
    `Vermarktungsart: ${facts.marketingType === "KAUF" ? "Kauf" : "Miete"}`,
    `Lage: ${buildLocationLine(
      {
        plz: facts.plz,
        ort: facts.ort,
        strasse: facts.strasse,
        hausnummer: facts.hausnummer,
      },
      facts.addressVisibility
    )}`,
  ];
  const factLine = buildFactLine(facts);
  if (factLine) lines.push(`Eckdaten: ${factLine}`);
  if (facts.baujahr != null) lines.push(`Baujahr: ${facts.baujahr}`);
  if (facts.provision) lines.push(`Provision: ${facts.provision}`);
  if (facts.beschreibung) {
    lines.push(`Vorhandene Beschreibung:\n${facts.beschreibung}`);
  }
  if (input.roomNames.length > 0) {
    lines.push(`Gezeigte Räume im Video: ${input.roomNames.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildMarketingPrompt(input: MarketingTextsInput): string {
  return (
    "Du schreibst Marketing-Texte für ein Immobilien-Walkthrough-Video. " +
    "Verwende AUSSCHLIESSLICH die folgenden freigegebenen Fakten. Erfinde " +
    "keine Eigenschaften, Renovierungen, Ausblicke, Lagevorteile, Preise " +
    "oder Energieangaben, die dort nicht stehen. Nenne keine genauere " +
    "Adresse als in „Lage“ angegeben. Sprache: Deutsch, Zahlenformat " +
    "deutsch (z. B. 84,5 m²).\n\n" +
    "--- FREIGEGEBENE FAKTEN ---\n" +
    buildFactsBlock(input) +
    "\n--- ENDE FAKTEN ---\n\n" +
    "Erzeuge:\n" +
    "1. caption — Instagram/Reel-Caption: 2–4 kurze Zeilen, ansprechend " +
    "aber sachlich korrekt, am Ende 3–6 Hashtags.\n" +
    "2. beschreibung — Objektbeschreibung für das Exposé: 2–3 Absätze, " +
    "professioneller Makler-Ton, keine Superlative ohne Faktenbasis.\n" +
    "3. voiceoverScript — Sprechertext für ein 20–35-Sekunden-Voiceover " +
    "(ca. 50–90 Wörter): einladend, ruhig, folgt grob der Raumreihenfolge, " +
    "endet mit einem neutralen Hinweis auf Besichtigung/Kontakt (ohne " +
    "konkrete Kontaktdaten)."
  );
}

export async function generateMarketingTexts(
  input: MarketingTextsInput
): Promise<MarketingTexts> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: anthropicTextModel(),
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: TEXTS_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: "user", content: buildMarketingPrompt(input) }],
  });
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Marketing-Texte: Antwort ohne Textblock.");
  return marketingTextsSchema.parse(JSON.parse(text));
}
