import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_GENERATION_OPTIONS,
  generationOptionsSchema,
  parseGenerationOptions,
} from "../src/domain/generationOptions";
import { isAnthropicConfigured } from "../src/anthropicClient";
import {
  buildFactsBlock,
  buildMarketingPrompt,
  isTextGenerationEnabled,
} from "../src/providers/texts/index";
import { OpenAiTtsProvider } from "../src/providers/tts/index";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
const saved = new Map<string, string | undefined>();
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Generierungs-Optionen", () => {
  test("Standard: alle Optionen aus", () => {
    expect(parseGenerationOptions(undefined)).toEqual(DEFAULT_GENERATION_OPTIONS);
    expect(parseGenerationOptions(null)).toEqual(DEFAULT_GENERATION_OPTIONS);
    expect(parseGenerationOptions("kaputt")).toEqual(DEFAULT_GENERATION_OPTIONS);
  });

  test("teilweise Angaben werden aufgefüllt", () => {
    const parsed = generationOptionsSchema.parse({ withMusic: true });
    expect(parsed).toEqual({
      withMusic: true,
      withTextOverlays: false,
      withEndCard: false,
      withVoiceover: false,
    });
  });
});

describe("KI-Opt-in-Schalter", () => {
  test("ohne Keys sind KI-Funktionen deaktiviert", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(isAnthropicConfigured()).toBe(false);
    expect(isTextGenerationEnabled()).toBe(false);
    expect(new OpenAiTtsProvider().isEnabled()).toBe(false);
  });

  test("mit Keys aktiviert", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isAnthropicConfigured()).toBe(true);
    expect(new OpenAiTtsProvider().isEnabled()).toBe(true);
  });
});

describe("Marketing-Prompt (Fakten-Treue)", () => {
  const input = {
    facts: {
      marketingType: "MIETE" as const,
      objectType: "Wohnung",
      titel: "Helle 3-Zimmer-Wohnung",
      plz: "04155",
      ort: "Leipzig",
      strasse: "Georg-Schumann-Straße",
      hausnummer: "12",
      addressVisibility: "CITY_ONLY" as const,
      kaltmiete: 890,
      zimmer: 3,
      wohnflaeche: 84.5,
      baujahr: 1908,
      provision: "provisionsfrei",
      beschreibung: null,
    },
    roomNames: ["Aussenansicht", "Wohnzimmer", "Küche"],
  };

  test("enthält nur gelieferte Fakten und die Leitplanken", () => {
    const prompt = buildMarketingPrompt(input);
    expect(prompt).toContain("AUSSCHLIESSLICH");
    expect(prompt).toContain("Erfinde");
    expect(prompt).toContain("84,5 m²");
    expect(prompt).toContain("Baujahr: 1908");
    expect(prompt).toContain("Aussenansicht, Wohnzimmer, Küche");
  });

  test("respektiert die Adress-Sichtbarkeit (keine Straße bei CITY_ONLY)", () => {
    const block = buildFactsBlock(input);
    expect(block).toContain("04155 Leipzig");
    expect(block).not.toContain("Georg-Schumann-Straße");
  });

  test("lässt fehlende Felder weg statt Platzhalter zu erzeugen", () => {
    const block = buildFactsBlock({
      facts: { ...input.facts, baujahr: null, provision: null },
      roomNames: [],
    });
    expect(block).not.toContain("Baujahr");
    expect(block).not.toContain("Provision");
    expect(block).not.toContain("null");
  });
});
