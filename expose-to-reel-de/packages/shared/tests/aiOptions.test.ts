import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_GENERATION_OPTIONS,
  generationOptionsSchema,
  parseGenerationOptions,
} from "../src/domain/generationOptions";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MINIMAX_MODEL,
  extractJsonObject,
  getLlmProviderKey,
  isLlmConfigured,
  llmTextModel,
  supportsJsonSchemaOutput,
} from "../src/llmClient";
import {
  buildFactsBlock,
  buildMarketingPrompt,
  isTextGenerationEnabled,
} from "../src/providers/texts/index";
import {
  ElevenLabsTtsProvider,
  getTtsProvider,
  OpenAiTtsProvider,
} from "../src/providers/tts/index";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "MINIMAX_API_KEY",
  "LLM_PROVIDER",
  "LLM_TEXT_MODEL",
  "ANTHROPIC_TEXT_MODEL",
  "TTS_PROVIDER",
  "ELEVENLABS_API_KEY",
] as const;
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
      overlayStyle: "klein",
      withEndCard: false,
      withVoiceover: false,
    });
  });

  test("overlayStyle: „gross“ wird übernommen, Junk fällt tolerant auf „klein“", () => {
    expect(
      parseGenerationOptions({ withTextOverlays: true, overlayStyle: "gross" })
        .overlayStyle
    ).toBe("gross");
    // Unbekannter Wert kippt nicht die restlichen Optionen (catch → klein).
    const junk = parseGenerationOptions({
      withTextOverlays: true,
      overlayStyle: "riesig",
    });
    expect(junk.overlayStyle).toBe("klein");
    expect(junk.withTextOverlays).toBe(true);
    // Alt-Daten ohne overlayStyle → Standard „klein“.
    expect(parseGenerationOptions({}).overlayStyle).toBe("klein");
  });
});

describe("KI-Opt-in-Schalter", () => {
  test("ohne Keys sind KI-Funktionen deaktiviert", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    expect(isLlmConfigured()).toBe(false);
    expect(isTextGenerationEnabled()).toBe(false);
    expect(new OpenAiTtsProvider().isEnabled()).toBe(false);
  });

  test("mit Keys aktiviert", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isLlmConfigured()).toBe(true);
    expect(new OpenAiTtsProvider().isEnabled()).toBe(true);
  });
});

describe("TTS-Provider-Auswahl (OpenAI / ElevenLabs)", () => {
  test("explizite Wahl über TTS_PROVIDER", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    expect(getTtsProvider()).toBeInstanceOf(ElevenLabsTtsProvider);
    process.env.TTS_PROVIDER = "openai";
    expect(getTtsProvider()).toBeInstanceOf(OpenAiTtsProvider);
  });

  test("Auto-Auswahl über den vorhandenen Key", () => {
    delete process.env.TTS_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    process.env.ELEVENLABS_API_KEY = "el-test";
    const provider = getTtsProvider();
    expect(provider).toBeInstanceOf(ElevenLabsTtsProvider);
    expect(provider.isEnabled()).toBe(true);
  });

  test("ElevenLabs nur mit ELEVENLABS_API_KEY aktiv", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    delete process.env.ELEVENLABS_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test"; // falscher Key zählt nicht
    expect(getTtsProvider().isEnabled()).toBe(false);
  });

  test("ohne jeden Key bleibt TTS deaktiviert", () => {
    delete process.env.TTS_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(getTtsProvider().isEnabled()).toBe(false);
  });
});

describe("LLM-Provider-Auswahl (Anthropic / MiniMax)", () => {
  test("Standard ist Anthropic mit claude-opus-4-8 und Structured Outputs", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_TEXT_MODEL;
    delete process.env.ANTHROPIC_TEXT_MODEL;
    expect(getLlmProviderKey()).toBe("anthropic");
    expect(llmTextModel()).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(supportsJsonSchemaOutput()).toBe(true);
  });

  test("LLM_PROVIDER=minimax nutzt MiniMax-M3 und Prompt-JSON", () => {
    process.env.LLM_PROVIDER = "minimax";
    delete process.env.LLM_TEXT_MODEL;
    delete process.env.ANTHROPIC_TEXT_MODEL;
    expect(getLlmProviderKey()).toBe("minimax");
    expect(llmTextModel()).toBe(DEFAULT_MINIMAX_MODEL);
    expect(supportsJsonSchemaOutput()).toBe(false);
  });

  test("MiniMax gilt nur mit MINIMAX_API_KEY als konfiguriert", () => {
    process.env.LLM_PROVIDER = "minimax";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic"; // falscher Key zählt nicht
    delete process.env.MINIMAX_API_KEY;
    expect(isLlmConfigured()).toBe(false);
    process.env.MINIMAX_API_KEY = "mm-test";
    expect(isLlmConfigured()).toBe(true);
  });

  test("Modell-Override gilt providerübergreifend", () => {
    process.env.LLM_PROVIDER = "minimax";
    process.env.LLM_TEXT_MODEL = "MiniMax-M2.7";
    expect(llmTextModel()).toBe("MiniMax-M2.7");
  });

  test("unbekannter Provider fällt auf Anthropic zurück", () => {
    process.env.LLM_PROVIDER = "quatsch";
    expect(getLlmProviderKey()).toBe("anthropic");
  });
});

describe("extractJsonObject (Provider ohne Structured Outputs)", () => {
  test("parst reines JSON", () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  test("entfernt Markdown-Zäune", () => {
    expect(extractJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  test("schneidet umgebenden Text ab", () => {
    expect(
      extractJsonObject('Hier ist das Ergebnis:\n{"caption": "Hallo"}\nViel Erfolg!')
    ).toEqual({ caption: "Hallo" });
  });

  test("wirft bei Antworten ohne JSON", () => {
    expect(() => extractJsonObject("kein json hier")).toThrow();
  });
});

describe("Prompt-JSON-Anweisung", () => {
  test("JSON-Anweisung nur wenn angefordert (MiniMax-Pfad)", () => {
    const input = {
      facts: {
        marketingType: "KAUF" as const,
        objectType: "Haus",
        titel: "Testhaus",
        plz: "14482",
        ort: "Potsdam",
        addressVisibility: "CITY_ONLY" as const,
        kaufpreis: 500000,
      },
      roomNames: [],
    };
    expect(buildMarketingPrompt(input, false)).not.toContain("AUSSCHLIESSLICH mit einem JSON-Objekt");
    expect(buildMarketingPrompt(input, true)).toContain("AUSSCHLIESSLICH mit einem JSON-Objekt");
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
