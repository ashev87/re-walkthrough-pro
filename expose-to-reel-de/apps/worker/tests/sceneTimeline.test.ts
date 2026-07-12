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
