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
