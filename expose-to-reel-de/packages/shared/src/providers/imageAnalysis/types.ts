import type { RoomLabel } from "@prisma/client";

/**
 * Bildanalyse: schlägt Raum-Labels, Qualitätsflags, Duplikate und
 * Grundriss-Kandidaten vor. Vorschläge sind niemals bindend — die UI erlaubt
 * das Überstimmen jeder Entscheidung.
 */

export interface ImageAnalysisInput {
  id: string;
  filename: string;
  caption?: string | null;
  width: number | null;
  height: number | null;
  sha256: string;
  perceptualHash: string | null;
  whiteRatio: number | null;
  sortIndex: number;
  /**
   * Bildinhalt für Vision-Provider (nur für frisch hochgeladene Bilder
   * gesetzt). Provider ohne Vision ignorieren diese Felder.
   */
  bytes?: Buffer;
  mimeType?: string;
}

export interface ImageAnalysisProposal {
  id: string;
  roomLabel: RoomLabel;
  isLowResolution: boolean;
  isLikelyFloorplan: boolean;
  /** ID des „Originals“, falls dieses Bild als Duplikat eingestuft wird. */
  duplicateOfId: string | null;
}

export interface ImageAnalysisProvider {
  readonly key: string;
  analyze(images: ImageAnalysisInput[]): Promise<ImageAnalysisProposal[]>;
}
