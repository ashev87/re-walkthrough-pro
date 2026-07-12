import type { RoomLabel } from "@prisma/client";
import { z } from "zod";
import {
  extractJsonObject,
  getLlmClient,
  isLlmConfigured,
  llmVisionModel,
  supportsJsonSchemaOutput,
} from "../../llmClient";
import { ALL_ROOM_LABELS, ROOM_LABEL_NAMES } from "../../domain/rooms";
import { HeuristicImageAnalysisProvider } from "./heuristic";
import type {
  ImageAnalysisInput,
  ImageAnalysisProposal,
  ImageAnalysisProvider,
} from "./types";

/**
 * KI-Bildanalyse (Opt-in: IMAGE_ANALYSIS_PROVIDER="ai" + Key des gewählten
 * LLM-Providers — Anthropic/Claude oder MiniMax M3 über deren
 * Anthropic-kompatiblen Endpunkt, siehe llmClient.ts).
 *
 * Das Vision-Modell klassifiziert den Bildinhalt gegen die deutsche
 * Raum-Taxonomie und erkennt Grundrisse zuverlässiger als die
 * Dateinamen-Heuristik. Duplikat-Erkennung und Auflösungs-Flags kommen
 * weiterhin deterministisch aus der Heuristik; bei jedem Fehler (Netz, Key,
 * Rate-Limit) fällt die Analyse still auf den Heuristik-Vorschlag zurück —
 * ein Upload schlägt dadurch nie fehl.
 */

const visionResultSchema = z.object({
  roomLabel: z.enum(
    ALL_ROOM_LABELS as unknown as [RoomLabel, ...RoomLabel[]]
  ),
  isFloorplan: z.boolean(),
});

/** JSON-Schema für output_config.format (strukturierte Antwort). */
const VISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    roomLabel: { type: "string", enum: [...ALL_ROOM_LABELS] },
    isFloorplan: {
      type: "boolean",
      description: "true, wenn das Bild ein Grundriss/Lageplan ist (kein Foto)",
    },
  },
  required: ["roomLabel", "isFloorplan"],
  additionalProperties: false,
} as const;

const SUPPORTED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export function buildVisionPrompt(withJsonInstruction: boolean): string {
  const taxonomy = ALL_ROOM_LABELS.map(
    (label) => `- ${label}: ${ROOM_LABEL_NAMES[label]}`
  ).join("\n");
  return (
    "Klassifiziere dieses Immobilienfoto. Wähle genau ein roomLabel aus der " +
    "folgenden Taxonomie (verwende SONSTIGES, wenn nichts eindeutig passt):\n" +
    `${taxonomy}\n\n` +
    "Setze isFloorplan=true nur für Grundrisse, Lagepläne oder Karten — " +
    "nicht für Fotos von Räumen." +
    (withJsonInstruction
      ? '\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt in exakt diesem ' +
        'Format, ohne Markdown und ohne weitere Erklärungen:\n' +
        '{"roomLabel": "<LABEL>", "isFloorplan": <true|false>}'
      : "")
  );
}

export class AnthropicImageAnalysisProvider implements ImageAnalysisProvider {
  readonly key = "anthropic_vision";
  private readonly heuristic = new HeuristicImageAnalysisProvider();

  static isEnabled(): boolean {
    return isLlmConfigured();
  }

  async analyze(images: ImageAnalysisInput[]): Promise<ImageAnalysisProposal[]> {
    // Basis: deterministische Heuristik (Duplikate, Auflösung, Fallback-Label).
    const proposals = await this.heuristic.analyze(images);
    const byId = new Map(proposals.map((p) => [p.id, p]));

    for (const image of images) {
      if (!image.bytes || !image.mimeType) continue;
      if (!SUPPORTED_MEDIA.has(image.mimeType)) continue;
      const base = byId.get(image.id);
      if (!base) continue;
      try {
        const vision = await this.classify(image.bytes, image.mimeType);
        byId.set(image.id, {
          ...base,
          roomLabel: vision.isFloorplan ? "GRUNDRISS" : vision.roomLabel,
          isLikelyFloorplan: vision.isFloorplan,
        });
      } catch (error) {
        console.warn(
          `[analysis] Vision-Analyse für ${image.filename} fehlgeschlagen — nutze Heuristik:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    return images.map((image) => byId.get(image.id)!);
  }

  private async classify(bytes: Buffer, mimeType: string) {
    const client = getLlmClient();
    // Anthropic garantiert das JSON-Format über output_config; Provider ohne
    // Structured Outputs (MiniMax) bekommen die JSON-Anweisung in den Prompt
    // und werden tolerant geparst.
    const useJsonSchema = supportsJsonSchemaOutput();
    const response = await client.messages.create({
      model: llmVisionModel(),
      max_tokens: 2048,
      ...(useJsonSchema
        ? {
            output_config: {
              format: {
                type: "json_schema" as const,
                schema: VISION_JSON_SCHEMA as unknown as Record<string, unknown>,
              },
            },
          }
        : {}),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: bytes.toString("base64"),
              },
            },
            { type: "text", text: buildVisionPrompt(!useJsonSchema) },
          ],
        },
      ],
    });
    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Vision-Antwort ohne Textblock.");
    return visionResultSchema.parse(
      useJsonSchema ? JSON.parse(text) : extractJsonObject(text)
    );
  }
}
