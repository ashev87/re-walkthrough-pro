# Scene-Synced Narration & Native 9:16 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-shot narration lines drive voiceover segments, on-screen text and SRT in sync with each scene; the 9:16 reel renders landscape photos as a horizontal sweep (blur-pad for floorplans/portrait) instead of a center crop.

**Architecture:** New nullable `Shot.narration` column is the single source of truth. A new shared `sceneLines` LLM call fills it; the worker gets a pure `sceneTimeline` module (duration auto-extend, start times, SRT cues) and a segmented voiceover assembler; the Foto-Motion provider gets a pure `buildSceneFilters` function with two new portrait modes. Spec: `docs/superpowers/specs/2026-07-12-scene-synced-narration-and-9x16-design.md`.

**Tech Stack:** TypeScript monorepo (npm workspaces), Prisma/PostgreSQL, ffmpeg via `runFfmpeg`, vitest (`packages/shared` = "unit", `apps/worker` = "integration-worker", `apps/web` = "integration-web"), zod, Anthropic-SDK-compatible LLM client (`packages/shared/src/llmClient.ts`).

**Conventions:** All paths below are relative to `expose-to-reel-de/`. German comments/UI strings (match codebase). Run tests from the package directory (each has its own `vitest.config.ts`). Windows shell: prefer `npx vitest run <file>`.

---

### Task 1: Migration — `Shot.narration`

**Files:**
- Modify: `packages/shared/prisma/schema.prisma` (model Shot, ~line 211)

- [ ] **Step 1: Add the column**

In `model Shot`, after `prompt String`:

```prisma
  prompt       String
  /** Szenentext (eine kurze Zeile) — Quelle für Voiceover-Segment, Overlay und SRT. */
  narration    String?
  durationSec  Float      @default(4)
```

- [ ] **Step 2: Create the migration**

Run from `expose-to-reel-de/`:
```bash
npm run db:migrate:dev -- --name add_shot_narration
```
Expected: new folder `packages/shared/prisma/migrations/<ts>_add_shot_narration/` with `ALTER TABLE "Shot" ADD COLUMN "narration" TEXT;`, Prisma Client regenerated.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit && cd ../..
git add packages/shared/prisma
git commit -m "feat: add Shot.narration column for scene-synced narration"
```

---

### Task 2: Shared — `wrapText` helper

**Files:**
- Create: `packages/shared/src/domain/textWrap.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Test: `packages/shared/tests/textWrap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "vitest";
import { wrapText } from "../src/domain/textWrap";

describe("wrapText", () => {
  test("kurzer Text bleibt eine Zeile", () => {
    expect(wrapText("Helles Wohnzimmer", 34)).toBe("Helles Wohnzimmer");
  });

  test("bricht an Wortgrenzen in max. 2 Zeilen um", () => {
    const result = wrapText(
      "Großzügiger Wohnbereich mit Kamin und Süd-Terrasse",
      30
    );
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
    expect(result.replace("\n", " ")).toBe(
      "Großzügiger Wohnbereich mit Kamin und Süd-Terrasse"
    );
  });

  test("kappt Überlänge mit Ellipse", () => {
    const long =
      "Dieser wirklich sehr lange Szenentext passt niemals in zwei kurze Zeilen und muss deshalb am Ende gekappt werden";
    const result = wrapText(long, 20);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(22);
  });

  test("einzelnes überlanges Wort wird nicht zerschnitten, aber einzeilig gelassen", () => {
    expect(wrapText("Donaudampfschifffahrtsgesellschaft", 10)).toBe(
      "Donaudampfschifffahrtsgesellschaft"
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/shared && npx vitest run tests/textWrap.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/domain/textWrap.ts`:

```typescript
/**
 * Zeilenumbruch für drawtext-Overlays: greedy an Wortgrenzen, maximal
 * `maxLines` Zeilen; was nicht passt, wird mit „…“ gekappt. Einzelne
 * überlange Wörter werden nie zerschnitten.
 */
export function wrapText(
  text: string,
  maxCharsPerLine: number,
  maxLines = 2
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || current === "") {
      current = candidate;
      index++;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (index < words.length || current && lines.length >= maxLines) {
    let last = lines[lines.length - 1]!;
    while (last.length + 2 > maxCharsPerLine && last.includes(" ")) {
      last = last.slice(0, last.lastIndexOf(" "));
    }
    lines[lines.length - 1] = `${last} …`;
  }
  return lines.join("\n");
}
```

Add to `packages/shared/src/index.ts` (next to the other domain exports):
```typescript
export { wrapText } from "./domain/textWrap";
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd packages/shared && npx vitest run tests/textWrap.test.ts
```
Expected: 4 passed. (If the ellipsis test fails on an off-by-one, adjust the loop — the contract in the test is authoritative.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/domain/textWrap.ts packages/shared/src/index.ts packages/shared/tests/textWrap.test.ts
git commit -m "feat: wrapText helper for two-line scene overlays"
```

---

### Task 3: Shared — Foto-Motion: pure filter builder + portrait modes + narration overlay

**Files:**
- Modify: `packages/shared/src/providers/videoGeneration/types.ts`
- Modify: `packages/shared/src/providers/videoGeneration/fotoMotion.ts`
- Test: `packages/shared/tests/videoProvider.test.ts` (extend)

- [ ] **Step 1: Extend `SceneRenderSpec`** in `types.ts` (after `sceneLabel`):

```typescript
  /** Szenentext (Option „Text-Overlays“) — wird über dem Raum-Label gezeichnet. */
  narrationText?: string;
  /** Breite/Höhe des Quellbilds (für die 9:16-Moduswahl). */
  sourceAspect?: number;
  /** Grundriss → Blur-Pad statt Sweep im Portrait-Format. */
  isFloorplan?: boolean;
  /** Schwenkrichtung im 9:16-Sweep: 1 = links→rechts, −1 = rechts→links. */
  sweepDirection?: 1 | -1;
```

- [ ] **Step 2: Write failing tests** (append to `packages/shared/tests/videoProvider.test.ts`):

```typescript
import { buildSceneFilters } from "../src/providers/videoGeneration/fotoMotion";

const baseSpec = {
  imageBytes: Buffer.alloc(0),
  prompt: "",
  cameraMoveKey: "orbit",
  durationSec: 4,
  fps: 25,
} as const;

describe("buildSceneFilters", () => {
  test("16:9 bleibt beim bisherigen Scale+Crop+Zoompan-Pfad", () => {
    const filters = buildSceneFilters(
      { ...baseSpec, width: 1920, height: 1080, sourceAspect: 1.5 },
      { font: null }
    );
    expect(filters[0]).toContain("force_original_aspect_ratio=increase");
    expect(filters.join(",")).toContain("zoompan=");
    expect(filters.join(",")).not.toContain("gblur");
  });

  test("9:16 + Querformat-Quelle → horizontaler Sweep (animiertes crop, kein zoompan)", () => {
    const filters = buildSceneFilters(
      { ...baseSpec, width: 1080, height: 1920, sourceAspect: 1.5, sweepDirection: 1 },
      { font: null }
    );
    const graph = filters.join(",");
    expect(graph).toContain("crop=w='min(iw,ih*1080/1920)'");
    expect(graph).toContain("(iw-ow)*");
    expect(graph).not.toContain("zoompan=");
  });

  test("9:16-Sweep respektiert sweepDirection=-1 (invertiertes Easing)", () => {
    const graph = buildSceneFilters(
      { ...baseSpec, width: 1080, height: 1920, sourceAspect: 1.78, sweepDirection: -1 },
      { font: null }
    ).join(",");
    expect(graph).toContain("(iw-ow)*(1-");
  });

  test("9:16 + Grundriss → Blur-Pad-Komposit mit zoompan", () => {
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1080,
        height: 1920,
        sourceAspect: 1.5,
        isFloorplan: true,
      },
      { font: null }
    ).join(",");
    expect(graph).toContain("split[");
    expect(graph).toContain("gblur");
    expect(graph).toContain("overlay=");
    expect(graph).toContain("zoompan=");
  });

  test("9:16 + Hochformat-Quelle → Blur-Pad", () => {
    const graph = buildSceneFilters(
      { ...baseSpec, width: 1080, height: 1920, sourceAspect: 0.75 },
      { font: null }
    ).join(",");
    expect(graph).toContain("gblur");
  });

  test("narrationText wird als zusätzliche drawtext-Zeile gezeichnet", () => {
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1920,
        height: 1080,
        sceneLabel: "Wohnzimmer",
        narrationText: "Großzügiger Wohnbereich mit Kamin",
      },
      { font: "C:/Windows/Fonts/arial.ttf" }
    ).join(",");
    const drawtextCount = (graph.match(/drawtext=/g) ?? []).length;
    expect(drawtextCount).toBe(2);
    expect(graph).toContain("Großzügiger Wohnbereich");
  });
});
```

Note: if the existing file has no `describe`/`test` imports covering this, extend the existing import from `vitest`.

- [ ] **Step 3: Run to verify failure**

```bash
cd packages/shared && npx vitest run tests/videoProvider.test.ts
```
Expected: FAIL — `buildSceneFilters` is not exported.

- [ ] **Step 4: Implement in `fotoMotion.ts`**

Refactor: extract everything between move resolution and `filters.push("format=yuv420p")` into an exported pure function; `renderScene` calls it. Replace the current filter construction in `renderScene` with:

```typescript
    const filters = buildSceneFilters(spec, {
      font: resolveFontPath(),
      watermarkLabel: this.watermarkLabel,
    });
```

New exported function (place above the class; keep `easedProgress`, `panExpression`, `GRADE_FILTERS`, `escapeFilterValue` as-is):

```typescript
/** Schwelle, ab der eine Quelle als Querformat gilt (Sweep statt Blur-Pad). */
const SWEEP_MIN_SOURCE_ASPECT = 1.2;

/** Smoothstep-Fortschritt 0→1 über die Szenendauer, in Sekunden (crop-Filter, t-basiert). */
function easedProgressT(durationSec: number): string {
  const p = `(t/${durationSec})`;
  return `(${p}*${p}*(3-2*${p}))`;
}

export interface SceneFilterOptions {
  font: string | null;
  watermarkLabel?: string;
}

/**
 * Baut den kompletten -vf-Filtergraphen einer Szene (pur, testbar).
 * Drei Bildpfade:
 *  - Standard (16:9 bzw. Quer-Ziel): Scale-to-fill + Crop + Ken-Burns-zoompan.
 *  - 9:16-Sweep (Querformat-Quelle): animiertes crop schwenkt über die volle Breite.
 *  - 9:16-Blur-Pad (Grundriss/Hochformat): unscharfer Füll-Hintergrund + zoompan.
 */
export function buildSceneFilters(
  spec: SceneRenderSpec,
  options: SceneFilterOptions
): string[] {
  const move = CAMERA_MOVES[spec.cameraMoveKey] ?? CAMERA_MOVES.still!;
  const frames = Math.max(2, Math.round(spec.durationSec * spec.fps));
  const { zoomFrom, zoomTo, panX, panY } = move.kenBurns;

  const isPortraitTarget = spec.height > spec.width;
  const useSweep =
    isPortraitTarget &&
    !spec.isFloorplan &&
    (spec.sourceAspect ?? 0) >= SWEEP_MIN_SOURCE_ASPECT;

  const filters: string[] = [];
  if (useSweep) {
    // Volle Bildhöhe zeigen, Fenster schwenkt horizontal (Smoothstep in t).
    const eased = easedProgressT(spec.durationSec);
    const x =
      (spec.sweepDirection ?? 1) > 0
        ? `(iw-ow)*${eased}`
        : `(iw-ow)*(1-${eased})`;
    filters.push(
      `scale=-2:${spec.height * 2}:flags=lanczos`,
      `fps=${spec.fps}`,
      `crop=w='min(iw,ih*${spec.width}/${spec.height})':h=ih:x='${x}':y=0`,
      `scale=${spec.width}:${spec.height}:flags=lanczos`
    );
  } else {
    const eased = easedProgress(frames);
    const zoomExpr = `${zoomFrom}+(${zoomTo}-${zoomFrom})*${eased}`;
    const xExpr = panExpression(panX, "x", eased);
    const yExpr = panExpression(panY, "y", eased);
    const w2 = spec.width * 2;
    const h2 = spec.height * 2;
    if (isPortraitTarget) {
      // Blur-Pad: Bild eingepasst auf unscharfem, abgedunkeltem Füllbild.
      filters.push(
        `split[e2rbg][e2rfg];` +
          `[e2rbg]scale=${w2}:${h2}:force_original_aspect_ratio=increase:flags=lanczos,` +
          `crop=${w2}:${h2},gblur=sigma=40,eq=brightness=-0.08[e2rbgo];` +
          `[e2rfg]scale=${w2}:${h2}:force_original_aspect_ratio=decrease:flags=lanczos[e2rfgo];` +
          `[e2rbgo][e2rfgo]overlay=x=(W-w)/2:y=(H-h)/2`
      );
    } else {
      filters.push(
        `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase:flags=lanczos`,
        `crop=${spec.width}:${spec.height}`,
        `scale=${w2}:${h2}:flags=lanczos`
      );
    }
    filters.push(
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${spec.width}x${spec.height}:fps=${spec.fps}`
    );
  }
  filters.push(...GRADE_FILTERS);

  const font = options.font;
  if (spec.sceneLabel && font) {
    const size = Math.round(spec.height * 0.032);
    const margin = Math.round(spec.height * 0.045);
    filters.push(
      `drawtext=fontfile='${escapeFilterValue(font)}'` +
        `:text='${escapeFilterValue(spec.sceneLabel)}'` +
        `:fontcolor=white:fontsize=${size}` +
        `:box=1:boxcolor=black@0.35:boxborderw=${Math.round(size * 0.45)}` +
        `:x=${margin}:y=h-${margin + size}`
    );
    if (spec.narrationText) {
      // Szenentext oberhalb des Raum-Labels, kleiner, gleiche Box-Optik.
      const narrSize = Math.round(spec.height * 0.026);
      const maxChars = isPortraitTarget ? 34 : 60;
      const wrapped = wrapText(spec.narrationText, maxChars);
      const lineCount = wrapped.split("\n").length;
      const blockHeight = Math.round(narrSize * 1.35 * lineCount);
      const y = spec.height - margin - size - Math.round(narrSize) - blockHeight;
      filters.push(
        `drawtext=fontfile='${escapeFilterValue(font)}'` +
          `:text='${escapeFilterValue(wrapped)}'` +
          `:fontcolor=white:fontsize=${narrSize}` +
          `:box=1:boxcolor=black@0.35:boxborderw=${Math.round(narrSize * 0.45)}` +
          `:x=${margin}:y=${y}`
      );
    }
  }

  const overlayLabel = spec.overlayLabel ?? options.watermarkLabel;
  if (overlayLabel) {
    const bandHeight = Math.round(spec.height * 0.055);
    filters.push(
      `drawbox=x=0:y=ih-${bandHeight * 2}:w=iw:h=${bandHeight}:color=black@0.55:t=fill`
    );
    if (font) {
      filters.push(
        `drawtext=fontfile='${escapeFilterValue(font)}'` +
          `:text='${escapeFilterValue(overlayLabel)}'` +
          `:fontcolor=white:fontsize=${Math.round(bandHeight * 0.6)}` +
          `:x=(w-text_w)/2:y=h-${Math.round(bandHeight * 1.7)}`
      );
    }
  }
  filters.push("format=yuv420p");
  return filters;
}
```

Imports to add at top of `fotoMotion.ts`: `import { wrapText } from "../../domain/textWrap";`

Notes for the implementer:
- `escapeFilterValue` must keep working for multi-line text — a literal `\n` in the drawtext text argument produces a line break; do NOT escape it away.
- The old inline filter code in `renderScene` is deleted; `renderScene` keeps the temp-dir/ffmpeg invocation exactly as-is (`-loop 1 … -frames:v frames`). The sweep path derives frame count from `-frames:v` too — unchanged.
- The old `sceneLabel`/watermark blocks move into `buildSceneFilters` verbatim (only `resolveFontPath()` becomes the `font` parameter — resolve it once).

- [ ] **Step 5: Run tests**

```bash
cd packages/shared && npx vitest run tests/videoProvider.test.ts
```
Expected: all pass (old + 6 new).

- [ ] **Step 6: Real-render smoke test (manual, ffmpeg required)**

If ffmpeg is on PATH, add this test to the same file (skip-guard like the existing provider tests use — mirror their pattern):

```typescript
test("Sweep-Szene rendert real in 1080x1920", async () => {
  const provider = new FotoMotionVideoProvider();
  // 1 graues Testbild 1600x900 per ffmpeg erzeugen (siehe bestehende Tests für runFfmpeg-Nutzung)
  const { stdout: img } = await runFfmpeg(
    ["-f", "lavfi", "-i", "color=c=gray:s=1600x900:d=1", "-frames:v", "1",
     "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
    { timeoutMs: 30_000 }
  );
  const result = await provider.renderScene({
    imageBytes: img, prompt: "", cameraMoveKey: "orbit",
    durationSec: 1, width: 1080, height: 1920, fps: 25,
    sourceAspect: 1600 / 900, sweepDirection: 1,
  });
  expect(result.videoBytes.length).toBeGreaterThan(1000);
}, 60_000);
```

Run: `cd packages/shared && npx vitest run tests/videoProvider.test.ts` — expected: pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/providers/videoGeneration packages/shared/tests/videoProvider.test.ts
git commit -m "feat: native 9:16 rendering (sweep + blur-pad) and narration overlay in Foto-Motion"
```

---

### Task 4: Shared — scene-lines generation (`sceneLines.ts`)

**Files:**
- Create: `packages/shared/src/providers/texts/sceneLines.ts`
- Modify: `packages/shared/src/index.ts` (export), check how `generateMarketingTexts` is exported there and mirror it
- Test: `packages/shared/tests/sceneLines.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import {
  buildSceneLinesPrompt,
  narrationWordBudget,
  sceneLinesSchema,
  truncateLine,
  SCENE_LINE_MAX_CHARS,
} from "../src/providers/texts/sceneLines";

describe("sceneLines", () => {
  test("Wortbudget ≈ 2,5 Wörter/s, min. 4", () => {
    expect(narrationWordBudget(4)).toBe(10);
    expect(narrationWordBudget(1)).toBe(4);
  });

  test("truncateLine kappt an Wortgrenze auf max. Länge", () => {
    const long = "wort ".repeat(40).trim();
    const cut = truncateLine(long);
    expect(cut.length).toBeLessThanOrEqual(SCENE_LINE_MAX_CHARS);
    expect(cut.endsWith("wort")).toBe(true);
  });

  test("Schema akzeptiert Zeilen und kappt Überlänge", () => {
    const parsed = sceneLinesSchema.parse({
      sceneLines: [
        { sortIndex: 0, text: "Kurz." },
        { sortIndex: 1, text: "x".repeat(300) },
      ],
    });
    expect(parsed.sceneLines[1]!.text.length).toBeLessThanOrEqual(
      SCENE_LINE_MAX_CHARS
    );
  });

  test("Prompt enthält Raum, Dauer und Wortbudget je Shot", () => {
    const prompt = buildSceneLinesPrompt(
      "Titel: Testvilla",
      [
        { sortIndex: 0, roomName: "Außenansicht", durationSec: 4 },
        { sortIndex: 1, roomName: "Küche", durationSec: 6 },
      ],
      false
    );
    expect(prompt).toContain("Außenansicht");
    expect(prompt).toContain("max. 10 Wörter");
    expect(prompt).toContain("max. 15 Wörter");
    expect(prompt).toContain("FREIGEGEBENE FAKTEN");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/shared && npx vitest run tests/sceneLines.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `sceneLines.ts`**

```typescript
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
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, SCENE_LINE_MAX_CHARS)).trim();
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
          sortIndex: { type: "integer", description: "Index des Shots (aus der Eingabe übernehmen)" },
          text: { type: "string", description: "Eine kurze deutsche Sprecherzeile für genau diese Szene" },
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
        `- sortIndex ${shot.sortIndex}: ${shot.roomName} (${shot.durationSec.toFixed(1)} s Szene → max. ${narrationWordBudget(shot.durationSec)} Wörter)`
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
```

Check `packages/shared/src/index.ts` for how `./providers/texts` is exported (likely `export * from "./providers/texts"` or named). Add:
```typescript
export {
  generateSceneLines,
  sceneLinesSchema,
  SCENE_LINE_MAX_CHARS,
  type SceneLines,
  type SceneLineShot,
} from "./providers/texts/sceneLines";
```

Verify `buildFactsBlock` accepts `MarketingTextsInput` (it does — `{ facts, roomNames }`); pass `roomNames: input.shots.map(s => s.roomName)` when constructing input in the caller (Task 5) so the type is satisfied.

- [ ] **Step 4: Run tests** — `cd packages/shared && npx vitest run tests/sceneLines.test.ts` → 4 passed. Also `npx tsc --noEmit -p .` if the package has a tsconfig check; otherwise rely on web typecheck later.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/providers/texts/sceneLines.ts packages/shared/src/index.ts packages/shared/tests/sceneLines.test.ts
git commit -m "feat: per-scene narration line generation (sceneLines provider)"
```

---

### Task 5: Web — store narration on shots during text generation

**Files:**
- Modify: `apps/web/src/server/services/texts.ts`
- Test: `apps/web/tests/integration/sceneNarration.test.ts` (new)

- [ ] **Step 1: Write failing test** (pure mapping — no LLM/DB):

```typescript
import { describe, expect, test } from "vitest";
import { mapSceneLinesToShots } from "@/server/services/texts";

describe("mapSceneLinesToShots", () => {
  const shots = [
    { id: "a", sortIndex: 0 },
    { id: "b", sortIndex: 2 },
  ];

  test("ordnet Zeilen per sortIndex zu; fehlende → null", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 2, text: "Zeile für b" },
    ]);
    expect(result).toEqual([
      { id: "a", narration: null },
      { id: "b", narration: "Zeile für b" },
    ]);
  });

  test("leere/Whitespace-Zeilen werden zu null", () => {
    const result = mapSceneLinesToShots(shots, [
      { sortIndex: 0, text: "   " },
    ]);
    expect(result[0]).toEqual({ id: "a", narration: null });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd apps/web && npx vitest run tests/integration/sceneNarration.test.ts` → FAIL.

- [ ] **Step 3: Implement in `texts.ts`**

Add export:

```typescript
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
```

In `generateTextsForProject`:
1. Extend the shots select: `select: { id: true, sortIndex: true, durationSec: true, roomLabel: true }`.
2. After `texts` is generated and saved, add (import `generateSceneLines` and `ROOM_LABEL_NAMES` from `@e2r/shared`):

```typescript
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
      console.warn("[texts] Szenen-Skript fehlgeschlagen — Texte ohne Szenenzeilen:", error);
    }
  }
```

3. DRY: extract the existing facts object from `generateMarketingTextsSafe` into `function buildFactsInput(listing: ListingRow)` returning the `facts` object, used by both calls.

- [ ] **Step 4: Run tests + typecheck**

```bash
cd apps/web && npx vitest run tests/integration/sceneNarration.test.ts && npx vitest run tests/integration/aiOptions.test.ts && npx tsc --noEmit
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/services/texts.ts apps/web/tests/integration/sceneNarration.test.ts
git commit -m "feat: generate and store per-shot narration lines with marketing texts"
```

---

### Task 6: Web — narration editing in Shotliste, DTO, voiceover gating

**Files:**
- Modify: `apps/web/src/app/api/projects/[id]/shots/route.ts` (patchSchema)
- Modify: `apps/web/src/server/services/shots.ts` (`ShotUpdate`, `updateShots`)
- Modify: `apps/web/src/lib/dto.ts` (`ShotDto`)
- Modify: `apps/web/src/app/projekte/[id]/page.tsx` (DTO mapping + GenerationSection prop)
- Modify: `apps/web/src/components/project/ShotsSection.tsx` (input column)
- Modify: `apps/web/src/components/project/GenerationSection.tsx` (voiceover gating)

No new automated test (UI wiring); covered by typecheck + manual verify in Task 9.

- [ ] **Step 1: API + service**

`route.ts` patchSchema — add:
```typescript
        narration: z.string().max(160).nullable().optional(),
```

`shots.ts`:
```typescript
export interface ShotUpdate {
  id: string;
  selected?: boolean;
  roomLabel?: RoomLabel;
  /** Hybrid-Modus: Szene über den externen KI-Video-Provider rendern. */
  preferAiVideo?: boolean;
  /** Szenentext (null/leer = entfernen). */
  narration?: string | null;
}
```
In the `prisma.shot.update` data object add:
```typescript
          narration:
            update.narration === undefined
              ? undefined
              : update.narration?.trim() || null,
```

- [ ] **Step 2: DTO + page**

`dto.ts` — in `ShotDto` after `prompt`:
```typescript
  narration: string | null;
```
`page.tsx` — find the shot DTO mapping (around line 90, `durationSec: shot.durationSec`) and add `narration: shot.narration,`. Then find where `GenerationSection` receives `hasVoiceoverScript` and additionally pass:
```tsx
hasNarration={shots.some((shot) => shot.selected && Boolean(shot.narration))}
```
(match the actual variable holding the shot rows in that file).

- [ ] **Step 3: ShotsSection input**

Add a column header `<th>Szenentext</th>` after `Kamerabewegung`, and in the row after the camera cell:

```tsx
<td>
  {editable ? (
    <input
      defaultValue={shot.narration ?? ""}
      placeholder="z. B. Die offene Küche mit Kochinsel."
      maxLength={160}
      style={{ minWidth: 220 }}
      onBlur={(e) => {
        if ((shot.narration ?? "") !== e.target.value) {
          patch([{ id: shot.id, narration: e.target.value || null }]);
        }
      }}
    />
  ) : (
    <span className="muted small">{shot.narration ?? "—"}</span>
  )}
</td>
```
Extend the `patch` parameter type with `narration?: string | null`.

- [ ] **Step 4: GenerationSection gating**

Add `hasNarration: boolean` to its `Props` interface. Find the voiceover checkbox logic (`hasVoiceoverScript`, ~line 230): the checkbox `disabled` condition and helper text must treat `hasVoiceoverScript || hasNarration` as "script available". Adjust the helper text chain:

```tsx
{!capabilities.tts
  ? "— nicht konfiguriert (OPENAI_API_KEY oder ELEVENLABS_API_KEY für TTS setzen)."
  : !hasVoiceoverScript && !hasNarration
    ? "— zuerst Szenentexte generieren (Abschnitt 3/4) oder ein Voiceover-Skript speichern."
    : hasNarration
      ? "— Szenentexte werden synchron zur jeweiligen Szene eingesprochen."
      : "— gespeichertes Skript wird eingesprochen und eingemischt."}
```
Search the component for every other use of `hasVoiceoverScript` (e.g. the `disabled` flag on the checkbox) and OR it with `hasNarration`.

- [ ] **Step 5: Typecheck + full web tests + commit**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run
git add apps/web/src
git commit -m "feat: editable scene narration in shot list; voiceover unlocked by narration lines"
```

---

### Task 7: Worker — `sceneTimeline` module

**Files:**
- Create: `apps/worker/src/pipeline/sceneTimeline.ts`
- Test: `apps/worker/tests/sceneTimeline.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import {
  NARRATION_LEAD_SEC,
  NARRATION_MAX_EXTEND_SEC,
  resolveSceneDuration,
  sceneStartTimes,
} from "../src/pipeline/sceneTimeline";

describe("resolveSceneDuration", () => {
  test("ohne Narration bleibt die Dauer unverändert", () => {
    expect(resolveSceneDuration(4, null)).toEqual({
      durationSec: 4,
      fadeOutNarration: false,
    });
  });

  test("Narration passt → keine Verlängerung", () => {
    expect(resolveSceneDuration(4, 3.0)).toEqual({
      durationSec: 4,
      fadeOutNarration: false,
    });
  });

  test("knapp zu lang → auto-extend auf Sprechlänge + Puffer", () => {
    const result = resolveSceneDuration(4, 4.5);
    expect(result.durationSec).toBeCloseTo(NARRATION_LEAD_SEC + 4.5 + 0.4, 5);
    expect(result.durationSec).toBeLessThanOrEqual(4 + NARRATION_MAX_EXTEND_SEC);
    expect(result.fadeOutNarration).toBe(false);
  });

  test("weit zu lang → Deckel bei +2 s und Fade-out", () => {
    const result = resolveSceneDuration(4, 9);
    expect(result.durationSec).toBe(6);
    expect(result.fadeOutNarration).toBe(true);
  });
});

describe("sceneStartTimes", () => {
  test("Starts berücksichtigen Crossfade-Überlappung", () => {
    expect(sceneStartTimes([4, 3, 5], 0.35)).toEqual([0, 3.65, 6.3]);
  });
  test("einzelne Szene startet bei 0", () => {
    expect(sceneStartTimes([4], 0.35)).toEqual([0]);
  });
});
```

- [ ] **Step 2: Verify failure** — `cd apps/worker && npx vitest run tests/sceneTimeline.test.ts` → FAIL.

- [ ] **Step 3: Implement `sceneTimeline.ts`**

```typescript
/**
 * Gemeinsame Szenen-Timeline für Voiceover-Segmente, SRT und Clip-Dauern.
 * Spec: docs/superpowers/specs/2026-07-12-scene-synced-narration-and-9x16-design.md
 */

/** Vorlauf: Segment startet erst kurz nach dem Szenenwechsel. */
export const NARRATION_LEAD_SEC = 0.3;
/** Puffer nach dem Segment, bevor die Szene enden darf. */
export const NARRATION_TAIL_SEC = 0.4;
/** Maximale automatische Verlängerung einer Szene. */
export const NARRATION_MAX_EXTEND_SEC = 2;
/** Fade-out-Länge, wenn ein Segment trotz Verlängerung nicht passt. */
export const NARRATION_FADE_SEC = 0.3;

export interface ResolvedSceneDuration {
  durationSec: number;
  /** true → Segment länger als Szene: am Szenenende ausblenden. */
  fadeOutNarration: boolean;
}

export function resolveSceneDuration(
  shotDurationSec: number,
  narrationSec: number | null | undefined
): ResolvedSceneDuration {
  if (!narrationSec || narrationSec <= 0) {
    return { durationSec: shotDurationSec, fadeOutNarration: false };
  }
  const needed = NARRATION_LEAD_SEC + narrationSec + NARRATION_TAIL_SEC;
  if (needed <= shotDurationSec) {
    return { durationSec: shotDurationSec, fadeOutNarration: false };
  }
  const durationSec = Math.min(needed, shotDurationSec + NARRATION_MAX_EXTEND_SEC);
  return { durationSec, fadeOutNarration: needed > durationSec };
}

/** Szenen-Startzeiten im Gesamtvideo (Crossfades überlappen die Szenen). */
export function sceneStartTimes(
  durations: readonly number[],
  crossfadeSec: number
): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const duration of durations) {
    starts.push(cursor);
    cursor += duration - crossfadeSec;
  }
  return starts;
}
```

- [ ] **Step 4: Run tests** — `cd apps/worker && npx vitest run tests/sceneTimeline.test.ts` → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipeline/sceneTimeline.ts apps/worker/tests/sceneTimeline.test.ts
git commit -m "feat: scene timeline math (auto-extend, start times) for synced narration"
```

---

### Task 8: Worker — audio helpers: `audioDurationSec` + `buildSegmentedVoiceover`

**Files:**
- Modify: `apps/worker/src/pipeline/ffmpegSteps.ts`
- Modify: `apps/worker/src/pipeline/ffmpegSteps.ts` — `mixAudio` gets `voiceoverDelayMs` option
- Test: `apps/worker/tests/ffmpegSteps.test.ts` (extend; uses real ffmpeg like the existing tests)

- [ ] **Step 1: Write failing test** (append; reuse the file's existing temp-dir/ffmpeg patterns and imports):

```typescript
import { audioDurationSec, buildSegmentedVoiceover } from "../src/pipeline/ffmpegSteps";
import { runFfmpeg } from "@e2r/shared/ffmpeg";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("buildSegmentedVoiceover", () => {
  test("setzt Segmente an ihre Startzeiten und füllt auf Gesamtlänge auf", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "e2r-vo-"));
    try {
      const seg = path.join(dir, "seg.wav");
      await runFfmpeg([
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:a", "pcm_s16le", seg,
      ]);
      expect(await audioDurationSec(seg)).toBeCloseTo(1, 1);

      const out = path.join(dir, "voiceover.m4a");
      await buildSegmentedVoiceover(
        [
          { path: seg, startSec: 0.3 },
          { path: seg, startSec: 4.0, maxDurationSec: 0.5 },
        ],
        8,
        out
      );
      expect(await audioDurationSec(out)).toBeCloseTo(8, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify failure** — `cd apps/worker && npx vitest run tests/ffmpegSteps.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement in `ffmpegSteps.ts`**

```typescript
/** Audiodauer (Sekunden) per ffprobe. */
export async function audioDurationSec(audioPath: string): Promise<number> {
  const probe = await ffprobe(audioPath);
  const duration = Number(
    probe.format.duration ??
      probe.streams.find((s) => s.codec_type === "audio")?.duration ??
      0
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Keine Audiodauer ermittelbar: ${audioPath}`);
  }
  return duration;
}

export interface VoiceoverSegment {
  path: string;
  /** Startzeit im Gesamtvideo (Sekunden). */
  startSec: number;
  /** Hartes Limit — Segment wird darauf gekürzt und ausgeblendet (0,3 s). */
  maxDurationSec?: number;
}

/**
 * Szenen-Voiceover: TTS-Segmente an ihren Szenenstart legen (adelay), zu
 * kürzende Segmente mit Fade-out kappen, alles mischen und exakt auf die
 * Videolänge bringen (apad + atrim). Ausgabe AAC (m4a).
 */
export async function buildSegmentedVoiceover(
  segments: readonly VoiceoverSegment[],
  totalDurationSec: number,
  outputPath: string
): Promise<void> {
  if (segments.length === 0) {
    throw new Error("buildSegmentedVoiceover ohne Segmente aufgerufen.");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });

  const args: string[] = [];
  const filters: string[] = [];
  segments.forEach((segment, index) => {
    args.push("-i", segment.path);
    const steps: string[] = [];
    if (segment.maxDurationSec != null) {
      const fadeStart = Math.max(0, segment.maxDurationSec - 0.3);
      steps.push(
        `atrim=0:${segment.maxDurationSec.toFixed(3)}`,
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.3`
      );
    }
    const delayMs = Math.max(0, Math.round(segment.startSec * 1000));
    steps.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${index}:a]${steps.join(",")}[s${index}]`);
  });
  const inputLabels = segments.map((_, index) => `[s${index}]`).join("");
  const mix =
    segments.length === 1
      ? `${inputLabels}anull[mixed]`
      : `${inputLabels}amix=inputs=${segments.length}:duration=longest:normalize=0[mixed]`;
  filters.push(
    mix,
    `[mixed]apad,atrim=0:${totalDurationSec.toFixed(3)}[aout]`
  );

  await runFfmpeg([
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    outputPath,
  ]);
}
```

- [ ] **Step 4: `mixAudio` delay option**

Change the `AudioMixInput` interface and the voiceover branch:

```typescript
export interface AudioMixInput {
  musicPath?: string | null;
  voiceoverPath?: string | null;
  videoDurationSec: number;
  /** Verzögerung der Voiceover-Spur; 0 für bereits fertig getimte Spuren. */
  voiceoverDelayMs?: number;
}
```
In the voiceover branch replace the fixed `adelay=600|600` with:

```typescript
  if (voiceoverPath) {
    args.push("-i", voiceoverPath);
    const delayMs = input.voiceoverDelayMs ?? 600;
    filters.push(
      delayMs > 0
        ? `[${audioIndex}:a]adelay=${delayMs}|${delayMs}[voice]`
        : `[${audioIndex}:a]anull[voice]`
    );
    voiceLabel = "[voice]";
  }
```
(destructure `voiceoverPath` etc. as before).

- [ ] **Step 5: Run tests**

```bash
cd apps/worker && npx vitest run tests/ffmpegSteps.test.ts
```
Expected: all pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/pipeline/ffmpegSteps.ts apps/worker/tests/ffmpegSteps.test.ts
git commit -m "feat: segmented voiceover assembly and configurable mix delay"
```

---

### Task 9: Worker — wire everything in `processJob.ts`

**Files:**
- Modify: `apps/worker/src/pipeline/processJob.ts`
- Test: `apps/worker/tests/jobLifecycle.test.ts` (extend)

- [ ] **Step 1: Remove the reel cap**

Delete `REEL_MAX_SCENE_SEC` and `sceneDurationFor` (and the `AspectTarget` type if now unused). Search the repo for `REEL_MAX_SCENE_SEC` / `sceneDurationFor` usages first (`grep -rn "REEL_MAX_SCENE_SEC\|sceneDurationFor" apps/`) and update any test that references them (a jobLifecycle assertion may rely on the 3-s cap — adjust its expected duration to the full shot duration).

- [ ] **Step 2: Synthesize narration segments BEFORE the render loop**

After `const options: GenerationOptions = parseGenerationOptions(job.options);` and the empty-shots guard, insert:

```typescript
  // --- Szenen-Skript: Segmente zuerst, denn Sprechlängen können Szenen verlängern ---
  interface NarrationSegment {
    shotId: string;
    path: string;
    durationSec: number;
  }
  const narrationSegments = new Map<string, NarrationSegment>();
  const tts = getTtsProvider();
  const useSegmentedVoiceover =
    options.withVoiceover &&
    tts.isEnabled() &&
    shots.some((shot) => shot.narration?.trim());
```

Inside the `try` after `tempDir` exists, before the render loop:

```typescript
    if (useSegmentedVoiceover) {
      for (const shot of shots) {
        const line = shot.narration?.trim();
        if (!line) continue;
        try {
          const audio = await tts.synthesize(line);
          const segmentPath = path.join(tempDir, `narration-${shot.id}.mp3`);
          await writeFile(segmentPath, audio);
          narrationSegments.set(shot.id, {
            shotId: shot.id,
            path: segmentPath,
            durationSec: await audioDurationSec(segmentPath),
          });
        } catch (error) {
          console.warn(
            `[worker] Narration-Segment für Shot ${shot.id} fehlgeschlagen — Szene ohne Sprecher:`,
            error
          );
        }
      }
      await updateProgress(generationJobId, 4, "Szenen-Voiceover erzeugt", hooks);
    }

    // Finale Szenendauern (Auto-Extend, gilt für 16:9 UND 9:16).
    const resolvedDurations = new Map(
      shots.map((shot) => [
        shot.id,
        resolveSceneDuration(
          shot.durationSec,
          narrationSegments.get(shot.id)?.durationSec ?? null
        ),
      ])
    );
```

Imports to add: `audioDurationSec`, `buildSegmentedVoiceover` from `./ffmpegSteps`; `resolveSceneDuration`, `sceneStartTimes`, `NARRATION_LEAD_SEC`, `NARRATION_FADE_SEC` from `./sceneTimeline`. Note `getTtsProvider` is already imported.

- [ ] **Step 3: Use resolved durations + new spec fields in the render loop**

Replace `const durationSec = sceneDurationFor(shot.durationSec, target);` with:

```typescript
          const durationSec = resolvedDurations.get(shot.id)!.durationSec;
```
Extend the `renderSceneWithRetry` spec object:

```typescript
            narrationText:
              options.withTextOverlays && shot.narration?.trim()
                ? shot.narration.trim()
                : undefined,
            sourceAspect:
              shot.mediaAsset.width && shot.mediaAsset.height
                ? shot.mediaAsset.width / shot.mediaAsset.height
                : undefined,
            isFloorplan:
              shot.roomLabel === "GRUNDRISS" || shot.mediaAsset.isLikelyFloorplan,
            sweepDirection:
              (CAMERA_MOVES[shot.cameraMove]?.kenBurns.panX ?? 0) !== 0
                ? (CAMERA_MOVES[shot.cameraMove]!.kenBurns.panX as 1 | -1)
                : shot.sortIndex % 2 === 0
                  ? 1
                  : -1,
```
Import `CAMERA_MOVES` from `@e2r/shared` (verify it is re-exported from the shared index — `cameraMoves.ts` exports it; if the index doesn't re-export, add it there).

Note: `clips[target.suffix].push({ path, durationSec })` now records identical durations for both formats — intended.

- [ ] **Step 4: Segmented voiceover assembly**

Replace the existing voiceover block (`if (options.withVoiceover) { … }`) with:

```typescript
    let voiceoverPath: string | null = null;
    let voiceoverDelayMs = 600;
    if (useSegmentedVoiceover && narrationSegments.size > 0) {
      const orderedShots = shots; // bereits nach sortIndex sortiert
      const durations = orderedShots.map(
        (shot) => resolvedDurations.get(shot.id)!.durationSec
      );
      const starts = sceneStartTimes(durations, CROSSFADE_SEC);
      const segments = orderedShots.flatMap((shot, index) => {
        const segment = narrationSegments.get(shot.id);
        if (!segment) return [];
        const resolved = resolvedDurations.get(shot.id)!;
        return [
          {
            path: segment.path,
            startSec: starts[index]! + NARRATION_LEAD_SEC,
            maxDurationSec: resolved.fadeOutNarration
              ? resolved.durationSec - NARRATION_LEAD_SEC
              : undefined,
          },
        ];
      });
      const totalSec = totalDurationWithCrossfade(
        clips[MASTER.suffix]!.map((clip) => clip.durationSec),
        CROSSFADE_SEC
      );
      voiceoverPath = path.join(tempDir, "voiceover.m4a");
      await buildSegmentedVoiceover(segments, totalSec, voiceoverPath);
      voiceoverDelayMs = 0;
      await upsertAsset({
        projectId: project.id,
        kind: "VOICEOVER",
        storageKey: projectStorageKey(
          project.organizationId,
          project.id,
          "final",
          `voiceover-v${version}.m4a`
        ),
        filename: `voiceover-v${version}.m4a`,
        mimeType: "audio/mp4",
        data: await (await import("node:fs/promises")).readFile(voiceoverPath),
      });
      await updateProgress(generationJobId, 76, "Voiceover synchronisiert", hooks);
    } else if (options.withVoiceover) {
      // Fallback: durchgehendes Skript wie bisher (unverändert übernehmen).
      /* … existing single-script block verbatim, writing voiceover.mp3 … */
    }
```
Important: the assembly needs `version`, so move the `const version = …` aggregate query ABOVE this block (it currently sits above the end-card block — end card, voiceover and music order can stay otherwise). Pass the delay through: in the `mixAudio` call add `voiceoverDelayMs`.

⚠ The 9:16 reel now shares durations with the master, so ONE voiceover track fits both. The `mixAudio` call site loops over targets and uses `expectedDuration` per target — with equal durations both totals match; keep passing `videoDurationSec: expectedDuration` as today.

- [ ] **Step 5: SRT cues from narration**

Replace the cue construction:

```typescript
      const cues: CaptionCue[] = shots.map((shot: Shot, index: number) => ({
        text:
          index === 0
            ? `${introParts.join("\n")}`
            : shot.narration?.trim() || ROOM_LABEL_NAMES[shot.roomLabel],
        durationSec: resolvedDurations.get(shot.id)!.durationSec,
      }));
```

- [ ] **Step 6: Extend `jobLifecycle.test.ts`**

Read the existing test first and mirror its setup (DB fixtures, real ffmpeg, provider). Add one test: two shots, `narration` set on both (e.g. "Erste Szene." / "Zweite Szene."), `options.withVoiceover = true`, and mock the TTS provider. Mock pattern (top of file, adjust to the file's existing mock style if it has one):

```typescript
import * as shared from "@e2r/shared";
import { runFfmpeg } from "@e2r/shared/ffmpeg";

vi.spyOn(shared, "getTtsProvider").mockReturnValue({
  key: "fake",
  displayName: "Fake TTS",
  isEnabled: () => true,
  async synthesize() {
    const { stdout } = await runFfmpeg(
      ["-f", "lavfi", "-i", "sine=frequency=300:duration=1",
       "-c:a", "libmp3lame", "-f", "mp3", "pipe:1"],
      { timeoutMs: 30_000 }
    );
    return stdout;
  },
});
```
(If `getTtsProvider` is not spy-able because processJob imports it directly from `@e2r/shared`, use `vi.mock("@e2r/shared", async (importOriginal) => ({ ...(await importOriginal()), getTtsProvider: () => fakeTts }))` instead — check how `aiOptions.test.ts`/existing worker tests mock shared functions and follow that pattern.)

Assertions:
1. Job completes; `VideoVersion` row exists.
2. The final master's `durationSec` (from the version row) is ≥ the sum of the configured shot durations minus crossfades (no reel-cap shrink) — and the reel asset exists with 1080×1920.
3. The stored SRT (`untertitel-v1.srt`) contains "Zweite Szene." (narration text, not just the room name).

Run: `cd apps/worker && npx vitest run tests/jobLifecycle.test.ts` — expected: pass (this test renders real video; allow the file's existing generous timeouts).

- [ ] **Step 7: Full worker + shared suites, typecheck, commit**

```bash
cd apps/worker && npx vitest run && cd ../../packages/shared && npx vitest run
cd ../../apps/web && npx tsc --noEmit
git add apps/worker
git commit -m "feat: scene-synced voiceover/SRT and shared 16:9+9:16 timeline in generation job"
```

---

### Task 10: End-to-end verification & docs touch-up

- [ ] **Step 1: Full test suite from repo root**

```bash
cd expose-to-reel-de && npx vitest run
```
Expected: all projects green (unit, integration-web, integration-worker).

- [ ] **Step 2: Manual e2e (real services configured in .env: MiniMax LLM, ElevenLabs TTS)**

1. Restart `npm run dev:web` and `npm run dev:worker` (new Prisma client + code).
2. On the villa project (`/projekte/…`, 20 photos): section 4 → „Mit KI vorschlagen“ → verify each selected shot in section 3 now shows a Szenentext; edit one line, reload, verify persisted.
3. Section 5: enable Text-Overlays + Voiceover → „Video generieren“.
4. Verify in the result: (a) 9:16 reel shows full-width sweeps, floorplan scenes have blurred pads; (b) narration audio lines up with each scene; (c) SRT contains the scene lines; (d) overlays show line + room label.

- [ ] **Step 3: README**

If `README.md` documents the voiceover option ("gespeichertes Skript"), add one sentence: scene lines (Szenentexte) take precedence and are spoken per scene. Grep: `grep -n "Voiceover" README.md`.

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: note scene-synced voiceover behavior"
```

---

## Self-Review Notes (already applied)

- Spec coverage: Task 1 (migration), 4+5 (line generation/storage), 6 (UI editing + gating), 7 (auto-extend/timeline), 8+9 (segmented voiceover, SRT, overlay, spec fields, reel cap removal), 3 (sweep/blur-pad/overlay rendering). Auto-extend cap +2 s and 0.3 s lead per spec; SRT cue 1 keeps intro block.
- Type consistency: `SceneRenderSpec` fields (`narrationText`, `sourceAspect`, `isFloorplan`, `sweepDirection`) defined in Task 3 and consumed in Task 9; `resolveSceneDuration` returns `{durationSec, fadeOutNarration}` used in Tasks 7/9; `VoiceoverSegment.maxDurationSec` defined in Task 8, used in Task 9.
- Known judgment calls for the executor: exact insertion points use surrounding-code anchors (search strings given); existing worker/web tests may need small assertion updates after the reel-cap removal — update assertions, not the feature.
