import { z } from "zod";
import {
  extractJsonObject,
  getLlmClient,
  llmTextModel,
  supportsJsonSchemaOutput,
} from "../../llmClient";
import { buildFactsBlock, type MarketingTextsInput } from "./index";

/**
 * Szenen-Skript: eine kurze Sprecherzeile pro Shot, streng faktenbasiert.
 * Die Zeilen sind die gemeinsame Quelle für Voiceover-Segmente, On-Screen-
 * Text und SRT — deshalb hart längenbegrenzt (Sprechzeit ≈ Szenendauer).
 */

export const SCENE_LINE_MAX_CHARS = 110;
const WORDS_PER_SECOND = 2.5;

export function narrationWordBudget(durationSec: number): number {
  return Math.max(4, Math.round(durationSec * WORDS_PER_SECOND));
}

/** Kappt an der letzten Wortgrenze vor SCENE_LINE_MAX_CHARS. */
export function truncateLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SCENE_LINE_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, SCENE_LINE_MAX_CHARS + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (
    lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, SCENE_LINE_MAX_CHARS)
  ).trim();
}

export const sceneLinesSchema = z.object({
  sceneLines: z.array(
    z.object({
      sortIndex: z.number().int().min(0),
      text: z.string().transform((value) => truncateLine(value)),
    })
  ),
});

export type SceneLines = z.infer<typeof sceneLinesSchema>["sceneLines"];

const SCENE_LINES_JSON_SCHEMA = {
  type: "object",
  properties: {
    sceneLines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sortIndex: {
            type: "integer",
            description: "Index des Shots (aus der Eingabe übernehmen)",
          },
          text: {
            type: "string",
            description: "Eine kurze deutsche Sprecherzeile für genau diese Szene",
          },
        },
        required: ["sortIndex", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["sceneLines"],
  additionalProperties: false,
} as const;

export interface SceneLineShot {
  sortIndex: number;
  roomName: string;
  durationSec: number;
}

export function buildSceneLinesPrompt(
  factsBlock: string,
  shots: SceneLineShot[],
  withJsonInstruction: boolean
): string {
  const shotList = shots
    .map(
      (shot) =>
        `- sortIndex ${shot.sortIndex}: ${shot.roomName} (${shot.durationSec.toFixed(
          1
        )} s Szene → max. ${narrationWordBudget(shot.durationSec)} Wörter)`
    )
    .join("\n");
  return (
    "Du schreibst das Voiceover für ein Immobilien-Walkthrough-Video, " +
    "aufgeteilt in EINE kurze Sprecherzeile pro Szene. Verwende " +
    "AUSSCHLIESSLICH die folgenden freigegebenen Fakten und das, was der " +
    "Raum-Name besagt. Erfinde keine Eigenschaften, Marken, Maße oder " +
    "Lagevorteile. Sprache: Deutsch, ruhiger Makler-Ton, keine Superlative " +
    "ohne Faktenbasis. Die Zeilen sollen nahtlos aufeinander folgen " +
    "(Szene 1 darf begrüßen, die letzte Zeile schließt neutral ab).\n\n" +
    "--- FREIGEGEBENE FAKTEN ---\n" +
    factsBlock +
    "\n--- ENDE FAKTEN ---\n\n" +
    "Szenen in Reihenfolge (Wortbudget strikt einhalten):\n" +
    shotList +
    (withJsonInstruction
      ? '\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt in exakt diesem Format, ohne Markdown:\n' +
        '{"sceneLines": [{"sortIndex": 0, "text": "..."}]}'
      : "")
  );
}

export async function generateSceneLines(
  input: MarketingTextsInput & { shots: SceneLineShot[] }
): Promise<SceneLines> {
  if (input.shots.length === 0) return [];
  const client = getLlmClient();
  // Anthropic garantiert das JSON-Format über output_config; Provider ohne
  // Structured Outputs (MiniMax) erhalten die JSON-Anweisung im Prompt.
  const useJsonSchema = supportsJsonSchemaOutput();
  const factsBlock = buildFactsBlock(input);
  const response = await client.messages.create({
    model: llmTextModel(),
    max_tokens: 4096,
    ...(useJsonSchema
      ? {
          output_config: {
            format: {
              type: "json_schema" as const,
              schema: SCENE_LINES_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        }
      : {}),
    messages: [
      {
        role: "user",
        content: buildSceneLinesPrompt(factsBlock, input.shots, !useJsonSchema),
      },
    ],
  });
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Szenen-Skript: Antwort ohne Textblock.");
  return sceneLinesSchema.parse(
    useJsonSchema ? JSON.parse(text) : extractJsonObject(text)
  ).sceneLines;
}
