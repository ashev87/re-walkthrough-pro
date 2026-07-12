"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SourceType = "MANUAL_UPLOAD" | "IMMOSCOUT24_API" | "PROPSTACK";

interface Props {
  is24Enabled: boolean;
  propstackEnabled: boolean;
}

export function NewProjectForm({ is24Enabled, propstackEnabled }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [propstackRef, setPropstackRef] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("MANUAL_UPLOAD");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPropstack = sourceType === "PROPSTACK";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(isPropstack ? "Importiere aus Propstack (Objekt, Eigentümer, Fotos)…" : null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isPropstack
            ? { sourceType, propstackRef, title: title.trim() || undefined }
            : { title, sourceType }
        ),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setInfo(null);
        setError(body.error ?? "Projekt konnte nicht angelegt werden.");
        return;
      }
      router.push(`/projekte/${body.data.id}`);
      router.refresh();
    } catch {
      setInfo(null);
      setError("Server nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
        <legend
          className="small"
          style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.4rem" }}
        >
          Datenquelle
        </legend>
        <div className="checkbox-row">
          <input
            type="radio"
            id="src-manual"
            name="sourceType"
            checked={sourceType === "MANUAL_UPLOAD"}
            onChange={() => setSourceType("MANUAL_UPLOAD")}
          />
          <label htmlFor="src-manual">
            <strong>Fotos hochladen</strong>
            <div className="muted small">
              Exposé-Daten manuell erfassen und eigene, autorisierte Fotos
              hochladen.
            </div>
          </label>
        </div>
        <div className="checkbox-row">
          <input
            type="radio"
            id="src-propstack"
            name="sourceType"
            disabled={!propstackEnabled}
            checked={isPropstack}
            onChange={() => setSourceType("PROPSTACK")}
          />
          <label htmlFor="src-propstack" style={{ opacity: propstackEnabled ? 1 : 0.6 }}>
            <strong>Propstack-Import (eigenes CRM)</strong>
            <div className="muted small">
              {propstackEnabled
                ? "Objektdaten, Eigentümer-Kontakt und Fotos aus dem eigenen Propstack-CRM übernehmen."
                : "Nicht konfiguriert — propstack_api_key in .env setzen (siehe README)."}
            </div>
          </label>
        </div>
        <div className="checkbox-row">
          <input
            type="radio"
            id="src-api"
            name="sourceType"
            disabled={!is24Enabled}
            checked={sourceType === "IMMOSCOUT24_API"}
            onChange={() => setSourceType("IMMOSCOUT24_API")}
          />
          <label htmlFor="src-api" style={{ opacity: is24Enabled ? 1 : 0.6 }}>
            <strong>Autorisierte API-Verbindung (ImmoScout24)</strong>
            <div className="muted small">
              {is24Enabled
                ? "Exposé über die konfigurierte ImmoScout24-Verbindung importieren."
                : "Nicht konfiguriert — erfordert autorisierte Zugangsdaten (siehe README). Öffentliches Scraping wird nicht unterstützt."}
            </div>
          </label>
        </div>
      </fieldset>

      {isPropstack ? (
        <>
          <div className="field" style={{ marginBottom: "1rem" }}>
            <label htmlFor="propstackRef">Propstack-Objekt-ID oder -URL *</label>
            <input
              id="propstackRef"
              required
              placeholder="z. B. 5472912 oder https://crm.propstack.de/app/units/5472912"
              value={propstackRef}
              onChange={(e) => setPropstackRef(e.target.value)}
            />
            <span className="hint">
              Kontakt-Links (…/contacts/clients/…) enthalten keine Objekt-ID.
            </span>
          </div>
          <div className="field" style={{ marginBottom: "1rem" }}>
            <label htmlFor="title">Projekttitel (optional)</label>
            <input
              id="title"
              maxLength={160}
              placeholder="wird sonst aus Propstack übernommen"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="field" style={{ marginBottom: "1rem" }}>
          <label htmlFor="title">Projekttitel *</label>
          <input
            id="title"
            required
            minLength={3}
            maxLength={160}
            placeholder="z. B. 3-Zimmer-Wohnung in Leipzig-Gohlis"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}

      {info && <div className="alert info">{info}</div>}
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy
          ? isPropstack
            ? "Importiere…"
            : "Anlegen…"
          : isPropstack
            ? "Aus Propstack importieren"
            : "Projekt anlegen"}
      </button>
    </form>
  );
}
