"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ListingDto, ProjectStatusDto } from "@/lib/dto";
import { apiRequest, jsonInit } from "@/lib/clientApi";

const EDITABLE: ProjectStatusDto[] = ["DRAFT", "NEEDS_REVIEW", "FAILED", "READY"];

interface Props {
  projectId: string;
  status: ProjectStatusDto;
  listing: ListingDto | null;
}

type FormState = Record<string, string>;

function toFormState(listing: ListingDto | null): FormState {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    marketingType: listing?.marketingType ?? "KAUF",
    objectType: s(listing?.objectType),
    titel: s(listing?.titel),
    plz: s(listing?.plz),
    ort: s(listing?.ort),
    strasse: s(listing?.strasse),
    hausnummer: s(listing?.hausnummer),
    addressVisibility: listing?.addressVisibility ?? "CITY_ONLY",
    kaufpreis: s(listing?.kaufpreis),
    kaltmiete: s(listing?.kaltmiete),
    nebenkosten: s(listing?.nebenkosten),
    warmmiete: s(listing?.warmmiete),
    zimmer: s(listing?.zimmer),
    wohnflaeche: s(listing?.wohnflaeche),
    grundstuecksflaeche: s(listing?.grundstuecksflaeche),
    baujahr: s(listing?.baujahr),
    provision: s(listing?.provision),
    energieausweisTyp: s(listing?.energieausweisTyp),
    energiekennwert: s(listing?.energiekennwert),
    energieklasse: s(listing?.energieklasse),
    energietraeger: s(listing?.energietraeger),
    beschreibung: s(listing?.beschreibung),
  };
}

export function ListingSection({ projectId, status, listing }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(listing));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = EDITABLE.includes(status);
  const isKauf = form.marketingType === "KAUF";

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setSaved(false);
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const optional = (key: string) => (form[key]?.trim() ? form[key].trim() : undefined);
    const payload: Record<string, unknown> = {
      marketingType: form.marketingType,
      objectType: form.objectType,
      titel: form.titel,
      plz: form.plz,
      ort: form.ort,
      strasse: optional("strasse"),
      hausnummer: optional("hausnummer"),
      addressVisibility: form.addressVisibility,
      kaufpreis: isKauf ? optional("kaufpreis") : undefined,
      kaltmiete: !isKauf ? optional("kaltmiete") : undefined,
      nebenkosten: !isKauf ? optional("nebenkosten") : undefined,
      warmmiete: !isKauf ? optional("warmmiete") : undefined,
      zimmer: optional("zimmer"),
      wohnflaeche: optional("wohnflaeche"),
      grundstuecksflaeche: optional("grundstuecksflaeche"),
      baujahr: optional("baujahr"),
      provision: optional("provision"),
      energieausweisTyp: optional("energieausweisTyp"),
      energiekennwert: optional("energiekennwert"),
      energieklasse: optional("energieklasse"),
      energietraeger: optional("energietraeger"),
      beschreibung: optional("beschreibung"),
    };

    const result = await apiRequest(`/api/projects/${projectId}/listing`, jsonInit("PUT", payload));
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Speichern fehlgeschlagen.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="card" id="expose">
      <h2>1 · Exposé-Daten</h2>
      <p className="muted small">
        Nur diese freigegebenen Angaben dürfen im Video und in Untertiteln
        erscheinen. Es werden keine Objektmerkmale erfunden.
      </p>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label>Vermarktungsart *</label>
            <select value={form.marketingType} onChange={set("marketingType")} disabled={!editable}>
              <option value="KAUF">Kauf</option>
              <option value="MIETE">Miete</option>
            </select>
          </div>
          <div className="field">
            <label>Objektart *</label>
            <input value={form.objectType} onChange={set("objectType")} disabled={!editable} required placeholder="z. B. Wohnung" />
          </div>
          <div className="field wide">
            <label>Titel *</label>
            <input value={form.titel} onChange={set("titel")} disabled={!editable} required minLength={3} />
          </div>
          <div className="field">
            <label>PLZ *</label>
            <input value={form.plz} onChange={set("plz")} disabled={!editable} required pattern="\d{5}" />
          </div>
          <div className="field">
            <label>Ort *</label>
            <input value={form.ort} onChange={set("ort")} disabled={!editable} required />
          </div>
          <div className="field">
            <label>Straße</label>
            <input value={form.strasse} onChange={set("strasse")} disabled={!editable} />
          </div>
          <div className="field">
            <label>Hausnummer</label>
            <input value={form.hausnummer} onChange={set("hausnummer")} disabled={!editable} />
          </div>
          <div className="field wide">
            <label>Adress-Sichtbarkeit *</label>
            <select value={form.addressVisibility} onChange={set("addressVisibility")} disabled={!editable}>
              <option value="CITY_ONLY">Nur PLZ/Ort anzeigen (Standard)</option>
              <option value="STREET_ONLY">Straße ohne Hausnummer</option>
              <option value="FULL">Vollständige Adresse</option>
            </select>
            <span className="hint">
              Die genaue Adresse erscheint nur mit Ihrer ausdrücklichen Zustimmung.
            </span>
          </div>
          {isKauf ? (
            <div className="field">
              <label>Kaufpreis (€) *</label>
              <input type="number" min="0" step="1" value={form.kaufpreis} onChange={set("kaufpreis")} disabled={!editable} />
            </div>
          ) : (
            <>
              <div className="field">
                <label>Kaltmiete (€/Monat) *</label>
                <input type="number" min="0" step="0.01" value={form.kaltmiete} onChange={set("kaltmiete")} disabled={!editable} />
              </div>
              <div className="field">
                <label>Nebenkosten (€/Monat)</label>
                <input type="number" min="0" step="0.01" value={form.nebenkosten} onChange={set("nebenkosten")} disabled={!editable} />
              </div>
              <div className="field">
                <label>Warmmiete (€/Monat)</label>
                <input type="number" min="0" step="0.01" value={form.warmmiete} onChange={set("warmmiete")} disabled={!editable} />
              </div>
            </>
          )}
          <div className="field">
            <label>Zimmer</label>
            <input type="number" min="0.5" step="0.5" value={form.zimmer} onChange={set("zimmer")} disabled={!editable} />
          </div>
          <div className="field">
            <label>Wohnfläche (m²)</label>
            <input type="number" min="1" step="0.01" value={form.wohnflaeche} onChange={set("wohnflaeche")} disabled={!editable} />
          </div>
          <div className="field">
            <label>Grundstücksfläche (m²)</label>
            <input type="number" min="1" step="0.01" value={form.grundstuecksflaeche} onChange={set("grundstuecksflaeche")} disabled={!editable} />
          </div>
          <div className="field">
            <label>Baujahr</label>
            <input type="number" min="1200" max="2100" value={form.baujahr} onChange={set("baujahr")} disabled={!editable} />
          </div>
          <div className="field wide">
            <label>Provision</label>
            <input value={form.provision} onChange={set("provision")} disabled={!editable} placeholder="z. B. 3,57 % inkl. MwSt. käuferseitig" />
          </div>
          <div className="field">
            <label>Energieausweis-Typ</label>
            <select value={form.energieausweisTyp} onChange={set("energieausweisTyp")} disabled={!editable}>
              <option value="">— nur wenn vorhanden —</option>
              <option value="Bedarfsausweis">Bedarfsausweis</option>
              <option value="Verbrauchsausweis">Verbrauchsausweis</option>
            </select>
          </div>
          <div className="field">
            <label>Energiekennwert (kWh/m²·a)</label>
            <input type="number" min="0" step="0.1" value={form.energiekennwert} onChange={set("energiekennwert")} disabled={!editable || !form.energieausweisTyp} />
          </div>
          <div className="field">
            <label>Energieklasse</label>
            <select value={form.energieklasse} onChange={set("energieklasse")} disabled={!editable || !form.energieausweisTyp}>
              <option value="">—</option>
              {["A+", "A", "B", "C", "D", "E", "F", "G", "H"].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Energieträger</label>
            <input value={form.energietraeger} onChange={set("energietraeger")} disabled={!editable || !form.energieausweisTyp} placeholder="z. B. Fernwärme" />
          </div>
          <div className="field wide">
            <label>Freigegebene Objektbeschreibung</label>
            <textarea rows={4} value={form.beschreibung} onChange={set("beschreibung")} disabled={!editable} />
          </div>
        </div>
        {error && <div className="alert error">{error}</div>}
        {saved && <div className="alert success">Exposé-Daten gespeichert.</div>}
        {editable ? (
          <div className="actions-row">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Speichern…" : "Exposé-Daten speichern"}
            </button>
          </div>
        ) : (
          <p className="muted small">In diesem Status nicht bearbeitbar.</p>
        )}
      </form>
    </section>
  );
}
