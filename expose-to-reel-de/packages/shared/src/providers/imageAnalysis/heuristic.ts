import type { RoomLabel } from "@prisma/client";
import { hammingDistance } from "../../ffmpeg";
import { LOW_RES_HEIGHT, LOW_RES_WIDTH } from "../../uploadValidation";
import type {
  ImageAnalysisInput,
  ImageAnalysisProposal,
  ImageAnalysisProvider,
} from "./types";

/**
 * Deterministische Fallback-Analyse ohne KI-Schlüssel:
 * — Raum-Label aus Dateinamen/Bildunterschriften (deutsche + englische Begriffe)
 * — Duplikate über identische SHA-256 oder aHash-Hamming-Distanz ≤ Schwellwert
 * — Grundrisse über Stichwörter oder sehr hohen Weißanteil
 * — niedrige Auflösung über Mindestabmessungen
 */

// Bild-Titel/Dateinamen → Raum-Label. Deckt neben den Taxonomie-Begriffen
// auch übliche CRM-Benennungen ab (z. B. Propstack-Bildtitel wie
// „Luftaufnahme“, „Treppenhaus“, „Keller“) — ein expliziter Treffer gilt
// als verlässlicher als die Bildstatistik (siehe Grundriss-Heuristik unten).
const KEYWORDS: Array<[RoomLabel, RegExp]> = [
  ["GRUNDRISS", /grundriss|floor.?plan|\bplan\b|lageplan|schnitt/i],
  [
    "AUSSENANSICHT",
    /aussen|außen|fassade|exterior|front|haus.?ansicht|strasse|straße|luftaufnahme|luftbild|drohne|vogelperspektive|carport|garage|r(ü|u)ckansicht|seitenansicht|giebel/i,
  ],
  ["EINGANG", /eingang|entree|entrance|haust(ü|u)r|foyer|windfang/i],
  ["FLUR", /flur|diele|hallway|corridor|gang|treppenhaus|treppe|galerie/i],
  ["WOHNZIMMER", /wohnzimmer|wohnen|living|lounge|wohnbereich|kaminzimmer|wintergarten|salon/i],
  ["KUECHE", /k(ü|ue|u)che|kitchen|kochbereich/i],
  ["ESSBEREICH", /essbereich|esszimmer|dining|essen/i],
  [
    "SCHLAFZIMMER",
    /schlafzimmer|schlafen|bedroom|kinderzimmer|g(ä|ae)stezimmer|elternschlafzimmer|ankleide/i,
  ],
  ["ARBEITSZIMMER", /arbeitszimmer|b(ü|u)ro|office|homeoffice|arbeiten/i],
  [
    "BAD",
    /\bbad\b|badezimmer|bathroom|dusche|wc|g(ä|a)ste.?wc|sanit(ä|a)r|sauna|wellness/i,
  ],
  ["BALKON_TERRASSE", /balkon|terrasse|balcony|terrace|loggia|dachterrasse/i],
  ["GARTEN", /garten|garden|backyard|aussenanlage|außenanlage|pool|\bhof\b|innenhof|hinterhof/i],
  ["AUSSICHT", /aussicht|ausblick|view|panorama|blick/i],
  // Explizite Neben-/Funktionsräume: bewusst SONSTIGES, aber als
  // Keyword-Treffer — verhindert Fehl-Flags durch die Weißanteil-Statistik.
  [
    "SONSTIGES",
    /keller|dachboden|speicher|abstellraum|hauswirtschaftsraum|\bhwr\b|waschk(ü|ue|u)che|heizung|technikraum|vorratsraum/i,
  ],
];

export const DUPLICATE_HAMMING_THRESHOLD = 6;
export const FLOORPLAN_WHITE_RATIO = 0.78;

/** Raum-Label aus Titel/Dateiname; null, wenn kein Stichwort passt. */
export function matchRoomKeyword(
  filename: string,
  caption?: string | null
): RoomLabel | null {
  const haystack = `${caption ?? ""} ${filename}`;
  for (const [label, pattern] of KEYWORDS) {
    if (pattern.test(haystack)) return label;
  }
  return null;
}

export function proposeRoomLabel(
  filename: string,
  caption?: string | null
): RoomLabel {
  return matchRoomKeyword(filename, caption) ?? "SONSTIGES";
}

export class HeuristicImageAnalysisProvider implements ImageAnalysisProvider {
  readonly key = "heuristic";

  analyze(images: ImageAnalysisInput[]): Promise<ImageAnalysisProposal[]> {
    const ordered = [...images].sort((a, b) => a.sortIndex - b.sortIndex);
    const proposals: ImageAnalysisProposal[] = [];
    const seen: ImageAnalysisInput[] = [];

    for (const image of ordered) {
      const keywordLabel = matchRoomKeyword(image.filename, image.caption);
      const roomLabel = keywordLabel ?? "SONSTIGES";
      // Weißanteil-Heuristik nur ohne expliziten Namens-Treffer: ein Titel
      // wie „Luftaufnahme“ oder „Keller“ ist verlässlicher als die Statistik.
      const isLikelyFloorplan =
        roomLabel === "GRUNDRISS" ||
        (keywordLabel === null &&
          image.whiteRatio != null &&
          image.whiteRatio >= FLOORPLAN_WHITE_RATIO);

      let duplicateOfId: string | null = null;
      for (const earlier of seen) {
        if (earlier.sha256 === image.sha256) {
          duplicateOfId = earlier.id;
          break;
        }
        if (
          earlier.perceptualHash &&
          image.perceptualHash &&
          hammingDistance(earlier.perceptualHash, image.perceptualHash) <=
            DUPLICATE_HAMMING_THRESHOLD
        ) {
          duplicateOfId = earlier.id;
          break;
        }
      }

      proposals.push({
        id: image.id,
        roomLabel: isLikelyFloorplan ? "GRUNDRISS" : roomLabel,
        isLowResolution:
          image.width != null &&
          image.height != null &&
          (image.width < LOW_RES_WIDTH || image.height < LOW_RES_HEIGHT),
        isLikelyFloorplan,
        duplicateOfId,
      });
      if (!duplicateOfId) seen.push(image);
    }

    return Promise.resolve(proposals);
  }
}
