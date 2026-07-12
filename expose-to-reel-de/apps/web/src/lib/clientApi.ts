"use client";

/** Kleine Fetch-Hilfe: einheitliche Fehlerbehandlung der JSON-API. */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function apiRequest<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const body = (await response.json().catch(() => null)) as ApiResult<T> | null;
    if (!body) {
      return { ok: false, error: `Unerwartete Antwort (${response.status}).` };
    }
    return body;
  } catch {
    return { ok: false, error: "Server nicht erreichbar." };
  }
}

export function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export const ROOM_LABEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "AUSSENANSICHT", label: "Aussenansicht" },
  { value: "EINGANG", label: "Eingang" },
  { value: "FLUR", label: "Flur" },
  { value: "WOHNZIMMER", label: "Wohnzimmer" },
  { value: "KUECHE", label: "Küche" },
  { value: "ESSBEREICH", label: "Essbereich" },
  { value: "SCHLAFZIMMER", label: "Schlafzimmer" },
  { value: "ARBEITSZIMMER", label: "Arbeitszimmer" },
  { value: "BAD", label: "Bad" },
  { value: "BALKON_TERRASSE", label: "Balkon/Terrasse" },
  { value: "GARTEN", label: "Garten" },
  { value: "AUSSICHT", label: "Aussicht" },
  { value: "GRUNDRISS", label: "Grundriss" },
  { value: "SONSTIGES", label: "Sonstiges" },
];

export function roomLabelName(value: string | null): string {
  return (
    ROOM_LABEL_OPTIONS.find((option) => option.value === value)?.label ??
    "Ohne Label"
  );
}
