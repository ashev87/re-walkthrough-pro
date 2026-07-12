import { prisma } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { POST as generateRoute } from "@/app/api/projects/[id]/generate/route";
import {
  POST as generateTextsRoute,
  PUT as saveTextsRoute,
} from "@/app/api/projects/[id]/texts/route";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  params,
  type TestContext,
} from "../helpers";

/**
 * Opt-in-Verhalten der KI-/Audio-Optionen: ohne Konfiguration klare Fehler
 * bzw. deaktivierte Optionen; manuelles Speichern der Texte funktioniert
 * immer.
 */

let ctx: TestContext;
let projectId: string;

// Alle Provider-Variablen leeren — die lokale .env (via Prisma geladen) darf
// die „nicht konfiguriert“-Assertions nicht kippen. Danach wiederherstellen.
const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "MINIMAX_API_KEY",
  "LLM_PROVIDER",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "TTS_PROVIDER",
  "MUSIC_TRACK_PATH",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeAll(async () => {
  for (const key of PROVIDER_ENV) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  ctx = await createTestContext();
  const response = await createProjectRoute(
    jsonRequest("/api/projects", "POST", ctx, { title: "KI-Optionen-Test" })
  );
  projectId = (await response.json()).data.id;
});

afterAll(async () => {
  for (const key of PROVIDER_ENV) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await cleanupTestContext(ctx);
});

describe("KI-Texte", () => {
  test("Generieren ohne ANTHROPIC_API_KEY → 501", async () => {
    const response = await generateTextsRoute(
      jsonRequest(`/api/projects/${projectId}/texts`, "POST", ctx),
      params({ id: projectId })
    );
    expect(response.status).toBe(501);
  });

  test("manuelles Speichern funktioniert ohne KI", async () => {
    const response = await saveTextsRoute(
      jsonRequest(`/api/projects/${projectId}/texts`, "PUT", ctx, {
        caption: "Schöne Wohnung in Leipzig #immobilien",
        beschreibung: "Manuell geschriebene Beschreibung.",
        voiceoverScript: "Willkommen in dieser hellen Wohnung.",
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);
    const project = await prisma.propertyProject.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect((project.marketingTexts as { caption: string }).caption).toContain(
      "Leipzig"
    );
  });

  test("ungültige Texte → 422", async () => {
    const response = await saveTextsRoute(
      jsonRequest(`/api/projects/${projectId}/texts`, "PUT", ctx, {
        caption: 42,
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });
});

describe("Generierungs-Optionen", () => {
  test("Musik-Option ohne MUSIC_TRACK_PATH → 422", async () => {
    const response = await generateRoute(
      jsonRequest(`/api/projects/${projectId}/generate`, "POST", ctx, {
        options: { withMusic: true },
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });

  test("Voiceover-Option ohne TTS-Konfiguration → 422", async () => {
    const response = await generateRoute(
      jsonRequest(`/api/projects/${projectId}/generate`, "POST", ctx, {
        options: { withVoiceover: true },
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });
});
