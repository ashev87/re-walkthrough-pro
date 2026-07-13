import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ffprobe, runFfmpeg } from "../src/ffmpeg";
import { buildSceneFilters } from "../src/providers/videoGeneration/fotoMotion";
import {
  FotoMotionVideoProvider,
  getVideoProvider,
  MOCK_WATERMARK_LABEL,
} from "../src/providers/videoGeneration/index";

const ORIGINAL = process.env.VIDEO_PROVIDER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VIDEO_PROVIDER;
  else process.env.VIDEO_PROVIDER = ORIGINAL;
});

describe("Video-Provider-Factory", () => {
  test("Standard ist Foto-Motion ohne Wasserzeichen", () => {
    delete process.env.VIDEO_PROVIDER;
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.key).toBe("foto_motion");
    expect(provider.watermarkLabel).toBeUndefined();
  });

  test("VIDEO_PROVIDER=mock nutzt denselben Renderer mit MOCK-Label", () => {
    process.env.VIDEO_PROVIDER = "mock";
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.watermarkLabel).toBe(MOCK_WATERMARK_LABEL);
    expect(provider.watermarkLabel).toContain("MOCK");
  });

  test("VIDEO_PROVIDER=external fällt unkonfiguriert auf Foto-Motion zurück", () => {
    process.env.VIDEO_PROVIDER = "external";
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.watermarkLabel).toBeUndefined();
  });
});

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
      { ...baseSpec, width: 1080, height: 1920, sourceAspect: 1.5, isFloorplan: true },
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

  test("durationSec=0 im Sweep erzeugt keine Division durch null", () => {
    const graph = buildSceneFilters(
      { ...baseSpec, durationSec: 0, width: 1080, height: 1920, sourceAspect: 1.5, sweepDirection: 1 },
      { font: null }
    ).join(",");
    // Klammer auf 1/fps: (t/0.04) statt (t/0) → kein NaN im crop-x.
    expect(graph).not.toContain("/0)");
    expect(graph).toContain("(t/0.04)");
  });

  test("sourceAspect=1.2 (exakte Schwelle) auf Portrait-Ziel → Sweep", () => {
    const graph = buildSceneFilters(
      { ...baseSpec, width: 1080, height: 1920, sourceAspect: 1.2 },
      { font: null }
    ).join(",");
    expect(graph).toContain("crop=w='min(iw,ih*1080/1920)'");
    expect(graph).not.toContain("gblur");
  });

  test("Portrait-Ziel ohne sourceAspect → Blur-Pad", () => {
    const graph = buildSceneFilters(
      { ...baseSpec, width: 1080, height: 1920 },
      { font: null }
    ).join(",");
    expect(graph).toContain("gblur");
  });

  test("narrationText mit Apostroph und Doppelpunkt wird escaped gezeichnet", () => {
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1920,
        height: 1080,
        sceneLabel: "Wohnzimmer",
        narrationText: "Highlight: Kamin im 'Herzstück'",
      },
      { font: "C:/Windows/Fonts/arial.ttf" }
    ).join(",");
    // Korrekte ffmpeg-Quote-Form: Quote schließen, escapen, wieder öffnen.
    expect(graph).toContain("Highlight\\: Kamin im '\\''Herzstück'\\''");
  });

  test("narrationStyle=gross: kurzer Text nutzt die größte Schriftstufe", () => {
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1080,
        height: 1920,
        sceneLabel: "Küche",
        narrationText: "Offene Wohnküche mit Kochinsel",
        narrationStyle: "gross",
      },
      { font: "C:/Windows/Fonts/arial.ttf" }
    ).join(",");
    // Kurzer Text passt in die größte Stufe (0,045 × Höhe).
    expect(graph).toContain(`fontsize=${Math.round(1920 * 0.045)}`);
    expect(graph).toContain("x=(w-text_w)/2");
    expect(graph).toContain("boxcolor=black@0.45");
    expect(graph).toContain("Kochinsel");
    expect(graph).not.toContain("…");
  });

  test("narrationStyle=gross zeichnet den Szenentext groß, zentriert, VOLLSTÄNDIG", () => {
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1080,
        height: 1920,
        sceneLabel: "Wohnzimmer",
        narrationText:
          "Großzügiger Wohnbereich mit offener Küche, Kamin und direktem Zugang zur Terrasse",
        narrationStyle: "gross",
      },
      { font: "C:/Windows/Fonts/arial.ttf" }
    ).join(",");
    // 82 Zeichen: adaptive Stufe 2 (0,038 × Höhe, bis 4 Zeilen) statt Ellipse.
    expect(graph).toContain(`fontsize=${Math.round(1920 * 0.038)}`);
    expect(graph).toContain("x=(w-text_w)/2");
    expect(graph).toContain("boxcolor=black@0.45");
    // Der komplette Text inkl. letztem Wort — keine „…“-Kappung.
    expect(graph).toContain("Terrasse");
    expect(graph).not.toContain("…");
    // … zusätzlich zum kleinen Raum-Label-Chip: exakt 2 drawtext.
    const drawtextCount = (graph.match(/drawtext=/g) ?? []).length;
    expect(drawtextCount).toBe(2);
    // Die kleine Szenentext-Zeile entfällt im Gross-Modus.
    const smallNarrSize = Math.round(1920 * 0.026);
    expect(graph).not.toContain(`fontsize=${smallNarrSize}`);
  });

  test("narrationStyle=gross: ~105 Zeichen passen komplett (kleinste Stufe, 4 Zeilen)", () => {
    const narration =
      "Großzügiger Wohnbereich mit offener Küche, hochwertigem Parkett, Kamin und direktem Zugang zur Terrasse";
    const graph = buildSceneFilters(
      {
        ...baseSpec,
        width: 1080,
        height: 1920,
        sceneLabel: "Wohnzimmer",
        narrationText: narration,
        narrationStyle: "gross",
      },
      { font: "C:/Windows/Fonts/arial.ttf" }
    ).join(",");
    const smallStepSize = Math.round(1920 * 0.032);
    expect(graph).toContain(`fontsize=${smallStepSize}`);
    // Volles letztes Wort statt „von poliertem …“-Kappung.
    expect(graph).toContain("Terrasse");
    expect(graph).not.toContain("…");
    // Unteres Drittel, 4 Zeilen: Block zentriert um 0,70 × Höhe —
    // bleibt auf dem Bild und über dem Raum-Label-Chip (y ≈ 1185).
    const y = Math.round(1920 * 0.7 - (4 * smallStepSize * 1.3) / 2);
    expect(graph).toContain(`:y=${y}`);
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

describe("FotoMotion 9:16-Rendering (ffmpeg)", () => {
  /** Graues Querformat-Testbild (1600×900) als JPEG erzeugen. */
  async function makeLandscapeTestImage(): Promise<Buffer> {
    const { stdout } = await runFfmpeg(
      ["-f", "lavfi", "-i", "color=c=gray:s=1600x900:d=1", "-frames:v", "1",
       "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
      { timeoutMs: 30_000 }
    );
    return stdout;
  }

  /** Rendert Bytes in eine Temp-Datei und prüft Auflösung + Dauer per ffprobe. */
  async function expectPortraitClip(videoBytes: Buffer): Promise<void> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "e2r-probe-"));
    try {
      const clipPath = path.join(tempDir, "clip.mp4");
      await writeFile(clipPath, videoBytes);
      const probe = await ffprobe(clipPath);
      const video = probe.streams.find((s) => s.codec_type === "video");
      expect(video?.width).toBe(1080);
      expect(video?.height).toBe(1920);
      // Dauer ≈ 1 s (Toleranz ±0,2 s).
      expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThanOrEqual(0.2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  test("Apostroph im narrationText rendert real (Quote-Escaping)", async () => {
    const provider = new FotoMotionVideoProvider();
    const img = await makeLandscapeTestImage();
    const result = await provider.renderScene({
      imageBytes: img, prompt: "", cameraMoveKey: "still",
      durationSec: 1, width: 640, height: 360, fps: 25,
      sceneLabel: "Test",
      narrationText: "Hier lässt sich's leben",
    });
    expect(result.videoBytes.length).toBeGreaterThan(1000);
  }, 60_000);

  test("Gross-Overlay (Szenentext) rendert real in 1080x1920", async () => {
    const provider = new FotoMotionVideoProvider();
    const img = await makeLandscapeTestImage();
    const result = await provider.renderScene({
      imageBytes: img, prompt: "", cameraMoveKey: "still",
      durationSec: 1, width: 1080, height: 1920, fps: 25,
      sourceAspect: 1600 / 900, sweepDirection: 1,
      sceneLabel: "Wohnzimmer",
      narrationText:
        "Großzügiger Wohnbereich mit offener Küche, Kamin und direktem Zugang zur Terrasse",
      narrationStyle: "gross",
    });
    expect(result.videoBytes.length).toBeGreaterThan(1000);
    await expectPortraitClip(result.videoBytes);
  }, 60_000);

  test("Sweep-Szene rendert real in 1080x1920", async () => {
    const provider = new FotoMotionVideoProvider();
    const img = await makeLandscapeTestImage();
    const result = await provider.renderScene({
      imageBytes: img, prompt: "", cameraMoveKey: "orbit",
      durationSec: 1, width: 1080, height: 1920, fps: 25,
      sourceAspect: 1600 / 900, sweepDirection: 1,
    });
    expect(result.videoBytes.length).toBeGreaterThan(1000);
    await expectPortraitClip(result.videoBytes);
  }, 60_000);

  test("Blur-Pad-Szene (Grundriss) rendert real in 1080x1920", async () => {
    const provider = new FotoMotionVideoProvider();
    const img = await makeLandscapeTestImage();
    const result = await provider.renderScene({
      imageBytes: img, prompt: "", cameraMoveKey: "orbit",
      durationSec: 1, width: 1080, height: 1920, fps: 25,
      sourceAspect: 1600 / 900, isFloorplan: true,
    });
    expect(result.videoBytes.length).toBeGreaterThan(1000);
    await expectPortraitClip(result.videoBytes);
  }, 60_000);
});
