/** Client-sichere DTOs (nur serialisierbare Werte, signierte URLs). */

export type ProjectStatusDto =
  | "DRAFT"
  | "NEEDS_REVIEW"
  | "GENERATING"
  | "READY"
  | "APPROVED"
  | "EXPORTED"
  | "FAILED";

export type RoomLabelDto =
  | "AUSSENANSICHT"
  | "EINGANG"
  | "FLUR"
  | "WOHNZIMMER"
  | "KUECHE"
  | "ESSBEREICH"
  | "SCHLAFZIMMER"
  | "ARBEITSZIMMER"
  | "BAD"
  | "BALKON_TERRASSE"
  | "GARTEN"
  | "AUSSICHT"
  | "GRUNDRISS"
  | "SONSTIGES";

export interface ListingDto {
  marketingType: "KAUF" | "MIETE";
  objectType: string;
  titel: string;
  plz: string;
  ort: string;
  strasse: string | null;
  hausnummer: string | null;
  addressVisibility: "FULL" | "STREET_ONLY" | "CITY_ONLY";
  kaufpreis: number | null;
  kaltmiete: number | null;
  nebenkosten: number | null;
  warmmiete: number | null;
  zimmer: number | null;
  wohnflaeche: number | null;
  grundstuecksflaeche: number | null;
  baujahr: number | null;
  provision: string | null;
  energieausweisTyp: string | null;
  energiekennwert: number | null;
  energieklasse: string | null;
  energietraeger: string | null;
  beschreibung: string | null;
}

export interface PhotoDto {
  id: string;
  filename: string;
  caption: string | null;
  roomLabel: RoomLabelDto | null;
  sortIndex: number;
  width: number | null;
  height: number | null;
  isLowResolution: boolean;
  isLikelyFloorplan: boolean;
  duplicateOfId: string | null;
  excluded: boolean;
  url: string;
}

export interface ShotDto {
  id: string;
  mediaAssetId: string;
  roomLabel: RoomLabelDto;
  sortIndex: number;
  selected: boolean;
  preferAiVideo: boolean;
  cameraMoveLabel: string;
  prompt: string;
  narration: string | null;
  durationSec: number;
  status: "PENDING" | "RENDERING" | "DONE" | "FAILED";
  errorMessage: string | null;
  imageUrl: string | null;
}

export interface JobDto {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progress: number;
  currentStep: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface VideoVersionDto {
  id: string;
  version: number;
  durationSec: number;
  createdAt: string;
  masterUrl: string;
  reelUrl: string;
  posterUrl: string | null;
  captionsUrl: string | null;
}

export interface ApprovalDto {
  id: string;
  createdAt: string;
  snapshotSha256: string;
  userName: string;
}

export interface PublishingProviderDto {
  key: string;
  displayName: string;
  enabled: boolean;
}
