# Propstack-Service (Python-Bridge)

Direkter Propstack-REST-Zugriff, **1:1 übernommen aus `MWA_webapp`**
(`core/propstack/` — Client, Eigentümer-Auflösung, Dropdown-Normalizer).
Die Logik wird nicht in TypeScript reimplementiert; die Web-App startet
`python fetch_property.py <objekt_id>` und konsumiert den JSON-Kontrakt.

## Setup

```bash
pip install -r requirements.txt          # requests (+ pytest für Tests)
```

`.env` am Monorepo-Root: `propstack_api_key=<rotierter Key>` — wird von
`PropstackClient.from_env()` gelesen und als `api_key`-Query-Param injiziert.
Optional `DEMO_MODE=1` (Client schreibgeschützt, blockiert `upload_document`).

## Kontrakt der Bridge

```bash
python fetch_property.py 5472912
# stdout: {"ok": true, "data": {id, raw, expanded, custom_fields, contact,
#          normalized, broker, address, images}}
# Fehler: {"ok": false, "code": invalid_id|missing_api_key|not_found|timeout|http_error|network, "error": "…"}
# exit:   0 ok · 2 invalid input · 3 missing key · 4 http/not found · 5 timeout
```

`PROPSTACK_FIXTURES=1` (oder `--fixtures`) serviert die eingecheckten
`samples/`-Fixtures für Objekt **5472912** — offline, ohne Key (Tests/Demo).

## Feste Geschäftsregeln (nicht ändern)

1. **Eigentümer-Kontakt ist die einzige Quelle** — aus
   `relationships[internal_name=="owner"].client_id` des expand=1-Units →
   `GET /v1/contacts/{id}`. Die aufs Objekt getippten `mwa_*`-Kontaktfelder
   werden ignoriert (Fixture-Beleg: `ch.le@gmx.de` ≠ `slenkeit@gmail.com`).
2. **Dropdowns**: Roh-Unit speichert Options-IDs; Auflösung über
   `custom_field_groups`, muss Propstacks `pretty_value` entsprechen;
   unbekannte IDs → `""`.
3. **Briefanrede**: mr→Herr/geehrter, ms|mrs→Frau/geehrte, Firma→
   „Sehr geehrte Damen und Herren“ (`company`), unbekannt→neutral +
   `salutation_status="unmapped"`. Nie leer.

## Rate-Budget

Pro Objekt mindestens 3 Calls (unit raw + unit expand + custom_field_groups)
+ 1 Kontakt-Call bei vorhandenem Eigentümer. `custom_field_groups` ist
weitgehend statisch → Kandidat fürs Caching bei Batch-Läufen.

## Tests

```bash
python -m pytest tests -q     # offline, gegen samples/
```
