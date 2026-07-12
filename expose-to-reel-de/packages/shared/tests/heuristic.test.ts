import { describe, expect, test } from "vitest";
import {
  HeuristicImageAnalysisProvider,
  proposeRoomLabel,
} from "../src/providers/imageAnalysis/heuristic";
import type { ImageAnalysisInput } from "../src/providers/imageAnalysis/types";

let counter = 0;
function input(overrides: Partial<ImageAnalysisInput> = {}): ImageAnalysisInput {
  counter++;
  return {
    id: `img-${counter}`,
    filename: `foto-${counter}.jpg`,
    caption: null,
    width: 1920,
    height: 1280,
    sha256: `hash-${counter}`,
    perceptualHash: null,
    whiteRatio: 0.1,
    sortIndex: counter,
    ...overrides,
  };
}

describe("Heuristische Bildanalyse", () => {
  test("Raum-Label aus deutschen und englischen Dateinamen", () => {
    expect(proposeRoomLabel("wohnzimmer-01.jpg")).toBe("WOHNZIMMER");
    expect(proposeRoomLabel("Küche_neu.png")).toBe("KUECHE");
    expect(proposeRoomLabel("kitchen.webp")).toBe("KUECHE");
    expect(proposeRoomLabel("badezimmer.jpg")).toBe("BAD");
    expect(proposeRoomLabel("grundriss-eg.png")).toBe("GRUNDRISS");
    expect(proposeRoomLabel("IMG_1234.jpg")).toBe("SONSTIGES");
    expect(proposeRoomLabel("IMG_1234.jpg", "Blick vom Balkon")).toBe(
      "BALKON_TERRASSE"
    );
  });

  test("identische SHA-256 ⇒ Duplikat", async () => {
    const provider = new HeuristicImageAnalysisProvider();
    const first = input({ sha256: "same" });
    const second = input({ sha256: "same" });
    const proposals = await provider.analyze([first, second]);
    expect(proposals.find((p) => p.id === second.id)?.duplicateOfId).toBe(first.id);
    expect(proposals.find((p) => p.id === first.id)?.duplicateOfId).toBeNull();
  });

  test("nahe aHashes ⇒ Duplikat, ferne nicht", async () => {
    const provider = new HeuristicImageAnalysisProvider();
    const first = input({ perceptualHash: "ffffffff00000000" });
    const near = input({ perceptualHash: "ffffffff00000003" }); // Distanz 2
    const far = input({ perceptualHash: "0f0f0f0f0f0f0f0f" });
    const proposals = await provider.analyze([first, near, far]);
    expect(proposals.find((p) => p.id === near.id)?.duplicateOfId).toBe(first.id);
    expect(proposals.find((p) => p.id === far.id)?.duplicateOfId).toBeNull();
  });

  test("hoher Weißanteil ⇒ Grundriss-Vorschlag", async () => {
    const provider = new HeuristicImageAnalysisProvider();
    const plan = input({ whiteRatio: 0.92 });
    const proposals = await provider.analyze([plan]);
    expect(proposals[0]?.isLikelyFloorplan).toBe(true);
    expect(proposals[0]?.roomLabel).toBe("GRUNDRISS");
  });

  test("kleine Bilder ⇒ niedrige Auflösung", async () => {
    const provider = new HeuristicImageAnalysisProvider();
    const small = input({ width: 480, height: 360 });
    const proposals = await provider.analyze([small]);
    expect(proposals[0]?.isLowResolution).toBe(true);
  });
});
