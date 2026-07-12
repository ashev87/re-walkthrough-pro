"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, jsonInit } from "@/lib/clientApi";

export interface MarketingTextsDto {
  caption: string;
  beschreibung: string;
  voiceoverScript: string;
}

interface Props {
  projectId: string;
  texts: MarketingTextsDto | null;
  aiEnabled: boolean;
  hasListing: boolean;
}

const EMPTY: MarketingTextsDto = {
  caption: "",
  beschreibung: "",
  voiceoverScript: "",
};

/**
 * Optionale Marketing-Texte: per KI vorschlagen lassen (nur freigegebene
 * Fakten), vom Nutzer prüfen/bearbeiten, speichern. Das gespeicherte
 * Voiceover-Skript ist Voraussetzung für die Voiceover-Option der Generierung.
 */
export function TextsSection({ projectId, texts, aiEnabled, hasListing }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<MarketingTextsDto>(texts ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    (key: keyof MarketingTextsDto) =>
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
      setInfo(null);
    };

  async function generate() {
    setBusy(true);
    setError(null);
    setInfo("Erzeuge Texte aus den freigegebenen Fakten…");
    const result = await apiRequest<MarketingTextsDto>(
      `/api/projects/${projectId}/texts`,
      { method: "POST" }
    );
    setBusy(false);
    if (!result.ok || !result.data) {
      setInfo(null);
      setError(result.error ?? "Text-Generierung fehlgeschlagen.");
      return;
    }
    setForm(result.data);
    setInfo("Entwürfe erstellt — bitte prüfen, anpassen und speichern.");
    router.refresh();
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result = await apiRequest<MarketingTextsDto>(
      `/api/projects/${projectId}/texts`,
      jsonInit("PUT", form)
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Speichern fehlgeschlagen.");
      return;
    }
    setInfo("Texte gespeichert.");
    router.refresh();
  }

  return (
    <section className="card" id="texte">
      <h2>4 · Texte (optional)</h2>
      <p className="muted small">
        Caption, Objektbeschreibung und Voiceover-Skript — auf Wunsch per KI
        vorgeschlagen, ausschließlich aus den freigegebenen Exposé-Fakten.
        Vor Verwendung immer prüfen; das Voiceover nutzt nur das hier
        gespeicherte Skript.
      </p>

      <div className="actions-row" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="btn"
          onClick={generate}
          disabled={!aiEnabled || !hasListing || busy}
          title={
            aiEnabled
              ? undefined
              : "Nicht konfiguriert — ANTHROPIC_API_KEY oder LLM_PROVIDER=minimax + MINIMAX_API_KEY setzen (siehe README)."
          }
        >
          {busy ? "Erzeuge…" : "Mit KI vorschlagen"}
        </button>
        {!aiEnabled && (
          <span className="muted small">
            KI-Texte deaktiviert (kein LLM-Key: ANTHROPIC_API_KEY oder
            MINIMAX_API_KEY) — manuelle Eingabe funktioniert weiterhin.
          </span>
        )}
        {aiEnabled && !hasListing && (
          <span className="muted small">Bitte zuerst Exposé-Daten speichern.</span>
        )}
      </div>

      <div className="form-grid">
        <div className="field wide">
          <label>Caption (Instagram/Reel)</label>
          <textarea rows={3} maxLength={2200} value={form.caption} onChange={set("caption")} />
        </div>
        <div className="field wide">
          <label>Objektbeschreibung</label>
          <textarea rows={5} maxLength={4000} value={form.beschreibung} onChange={set("beschreibung")} />
        </div>
        <div className="field wide">
          <label>Voiceover-Skript (20–35 s, ca. 50–90 Wörter)</label>
          <textarea rows={4} maxLength={1200} value={form.voiceoverScript} onChange={set("voiceoverScript")} />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}
      <div className="actions-row">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          Texte speichern
        </button>
      </div>
    </section>
  );
}
