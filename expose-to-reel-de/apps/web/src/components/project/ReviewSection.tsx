"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ApprovalDto,
  ProjectStatusDto,
  PublishingProviderDto,
  VideoVersionDto,
} from "@/lib/dto";
import { apiRequest, jsonInit } from "@/lib/clientApi";

interface Props {
  projectId: string;
  status: ProjectStatusDto;
  latestVersion: VideoVersionDto | null;
  approvals: ApprovalDto[];
  publishingProviders: PublishingProviderDto[];
  hasAttestation: boolean;
}

const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "factsVerified", label: "Alle Fakten im Video/Untertitel sind geprüft und korrekt." },
  { key: "noMisleadingContent", label: "Es gibt keine irreführenden generierten Inhalte." },
  { key: "imageRightsConfirmed", label: "Die Bildrechte sind bestätigt." },
  { key: "privacyReviewed", label: "Die Datenschutz-Prüfung ist abgeschlossen (keine Personen, Kennzeichen, sensiblen Details)." },
  { key: "addressVisibilityConfirmed", label: "Die Einstellung zur Adress-Sichtbarkeit ist korrekt." },
];

export function ReviewSection({
  projectId,
  status,
  latestVersion,
  approvals,
  publishingProviders,
  hasAttestation,
}: Props) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, string> | null>(null);

  const allChecked = CHECKLIST_ITEMS.every((item) => checks[item.key]);
  const isApproved = status === "APPROVED" || status === "EXPORTED";

  async function approve() {
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(
      CHECKLIST_ITEMS.map((item) => [item.key, checks[item.key] === true])
    );
    const result = await apiRequest(
      `/api/projects/${projectId}/approve`,
      jsonInit("POST", payload)
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Freigabe fehlgeschlagen.");
      return;
    }
    setInfo("Projekt freigegeben — unveränderlicher Freigabe-Snapshot gespeichert.");
    router.refresh();
  }

  async function revoke() {
    if (!window.confirm("Freigabe wirklich zurückziehen?")) return;
    const result = await apiRequest(`/api/projects/${projectId}/approve`, {
      method: "DELETE",
    });
    if (!result.ok) setError(result.error ?? "Zurückziehen fehlgeschlagen.");
    setDownloads(null);
    router.refresh();
  }

  async function requestExport() {
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ references: Record<string, string> }>(
      `/api/projects/${projectId}/export`,
      { method: "POST" }
    );
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Export fehlgeschlagen.");
      return;
    }
    setDownloads(result.data.references);
    setInfo("Export bereit — Links sind 60 Minuten gültig.");
    router.refresh();
  }

  async function deleteProject() {
    if (
      !window.confirm(
        "Projekt und ALLE zugehörigen Medien unwiderruflich löschen?"
      )
    ) {
      return;
    }
    const result = await apiRequest(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      setError(result.error ?? "Löschen fehlgeschlagen.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <section className="card" id="freigabe">
      <h2>6 · Prüfung, Freigabe & Export</h2>

      {latestVersion ? (
        <div className="video-row">
          <div>
            <h3>Master 16:9 (Version {latestVersion.version})</h3>
            <video controls preload="metadata" poster={latestVersion.posterUrl ?? undefined} src={latestVersion.masterUrl} />
          </div>
          <div>
            <h3>Reel 9:16</h3>
            <video controls preload="metadata" src={latestVersion.reelUrl} style={{ maxHeight: 360 }} />
            <p className="muted small">
              Dauer: {latestVersion.durationSec.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s ·{" "}
              erstellt {new Date(latestVersion.createdAt).toLocaleString("de-DE")}
            </p>
            {latestVersion.captionsUrl && (
              <a className="btn sm" href={latestVersion.captionsUrl}>
                Untertitel (.srt) ansehen
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          Noch kein Video generiert. Die Vorschau erscheint hier nach der
          Generierung.
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}

      {status === "READY" && latestVersion && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Freigabe-Checkliste</h3>
          {!hasAttestation && (
            <div className="alert error">
              Die Rechte-Bestätigung fehlt (Abschnitt 2) — Freigabe nicht möglich.
            </div>
          )}
          {CHECKLIST_ITEMS.map((item) => (
            <div className="checkbox-row" key={item.key}>
              <input
                id={`check-${item.key}`}
                type="checkbox"
                checked={checks[item.key] ?? false}
                onChange={(e) =>
                  setChecks((prev) => ({ ...prev, [item.key]: e.target.checked }))
                }
              />
              <label htmlFor={`check-${item.key}`} className="small">
                {item.label}
              </label>
            </div>
          ))}
          <button
            type="button"
            className="btn primary"
            disabled={!allChecked || busy || !hasAttestation}
            onClick={approve}
          >
            {busy ? "Freigeben…" : "Projekt freigeben"}
          </button>
          <p className="muted small">
            Die Freigabe erzeugt einen unveränderlichen Snapshot (Fakten,
            Shotliste, Datei-Hashes). Export ist erst danach möglich.
          </p>
        </div>
      )}

      {isApproved && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Export & Veröffentlichung</h3>
          <div className="actions-row">
            <button type="button" className="btn primary" onClick={requestExport} disabled={busy}>
              {busy ? "Bereite Export vor…" : "Download-Links erzeugen"}
            </button>
            <button type="button" className="btn" onClick={revoke}>
              Freigabe zurückziehen
            </button>
          </div>
          {downloads && (
            <ul>
              {Object.entries(downloads).map(([name, url]) => (
                <li key={name}>
                  <a href={url} download>
                    {name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: "0.75rem" }}>
            {publishingProviders.map((provider) => (
              <div key={provider.key} className="checkbox-row">
                <button type="button" className="btn sm" disabled={!provider.enabled} title={provider.enabled ? "" : "Erfordert autorisierte API-Zugangsdaten (siehe README)."}>
                  {provider.displayName}
                </button>
                {!provider.enabled && (
                  <span className="muted small">
                    Deaktiviert — Veröffentlichung nur mit dokumentierter,
                    autorisierter API-Verbindung und expliziter Nutzeraktion.
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Freigabe-Historie</h3>
          <ul className="small">
            {approvals.map((approval) => (
              <li key={approval.id}>
                {new Date(approval.createdAt).toLocaleString("de-DE")} durch{" "}
                {approval.userName} · Snapshot-Hash:{" "}
                <code>{approval.snapshotSha256.slice(0, 16)}…</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          marginTop: "1.5rem",
          borderTop: "1px solid var(--border)",
          paddingTop: "1rem",
        }}
      >
        <h3 style={{ color: "var(--danger)" }}>Projekt löschen</h3>
        <p className="muted small">
          Entfernt das Projekt, alle Fotos, Szenen und Videos unwiderruflich
          aus Datenbank und Objektspeicher (Datenschutz-Löschworkflow).
        </p>
        <button type="button" className="btn danger" onClick={deleteProject} disabled={status === "GENERATING"}>
          Projekt unwiderruflich löschen
        </button>
      </div>
    </section>
  );
}
