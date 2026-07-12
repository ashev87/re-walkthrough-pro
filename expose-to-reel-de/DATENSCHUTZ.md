# Datenschutz & Datenaufbewahrung — Exposé-to-Reel DE (MVP)

Dieses Dokument beschreibt knapp, welche Daten die Anwendung verarbeitet, wie
lange sie aufbewahrt werden und wie die Löschung funktioniert.

## Grundsätze

- **Nur autorisierte Inhalte.** Die Anwendung richtet sich an Makler und
  Bauträger, die eigene bzw. zur Vermarktung autorisierte Objekte bewerben.
  Öffentliches Scraping fremder Inserate wird nicht unterstützt.
- **Keine erfundenen Fakten.** Videos und Untertitel verwenden ausschließlich
  vom Nutzer gelieferte, freigegebene Angaben.
- **Keine öffentliche Medienauslieferung.** Quellbilder, Szenen und Videos
  sind nur über signierte, ablaufende URLs erreichbar (Standard-TTL 15–60
  Minuten) und zusätzlich an eine angemeldete Session derselben Organisation
  gebunden (lokaler Storage-Treiber).

## Verarbeitete Datenkategorien

| Kategorie | Inhalt | Speicherort |
|---|---|---|
| Nutzerkonten | Name, E-Mail, Passwort-Hash (scrypt) | PostgreSQL |
| Exposé-Daten | Objektangaben inkl. optionaler Adresse | PostgreSQL |
| Medien | Quellfotos, normalisierte Bilder, Szenen, Videos, Poster, Untertitel | Objektspeicher (lokal/S3) |
| Rechte-Bestätigungen | Herkunft der Bilder, Bestätigender, Zeitpunkt | PostgreSQL |
| Freigaben | Unveränderlicher Snapshot (Fakten, Shotliste, Datei-Hashes) | PostgreSQL |
| Audit-Ereignisse | Wer hat wann was ausgelöst (ohne Secrets) | PostgreSQL |
| Provider-Zugangsdaten | Nur verschlüsselt (AES-256-GCM) oder als Umgebungsvariablen | PostgreSQL / Env |
| Propstack-Import | Objektdaten + Fotos aus dem eigenen CRM des Maklers; der Eigentümer-Kontakt wird zur Anzeige abgerufen, aber nicht als Datensatz gespeichert (Audit enthält nur Status-Metadaten, keine Kontaktdaten) | PostgreSQL / Objektspeicher |
| KI-Optionen (Opt-in) | Bei aktivierter KI-Bildanalyse werden hochgeladene Fotos an den konfigurierten LLM-Provider übermittelt (Anthropic oder MiniMax, je nach `LLM_PROVIDER`); bei KI-Texten die freigegebenen Exposé-Fakten; bei Voiceover das geprüfte Skript an den konfigurierten TTS-Anbieter (OpenAI oder ElevenLabs). Ohne die jeweiligen API-Keys findet keine Übermittlung statt. | Anthropic / MiniMax / OpenAI / ElevenLabs (transient) |

**Adress-Sichtbarkeit:** Die genaue Adresse (Straße/Hausnummer) wird nur
angezeigt bzw. in Untertitel übernommen, wenn der Nutzer die Sichtbarkeit
explizit auf „Straße“ oder „Vollständig“ stellt. Standard ist „nur PLZ/Ort“.

**Sensible Daten in Logs:** Secrets, Tokens und Roh-Zugangsdaten werden nicht
geloggt. Audit-Ereignisse enthalten IDs und Metadaten, keine Medieninhalte.

## Aufbewahrung

- Projektdaten und Medien bleiben gespeichert, **solange das Projekt
  existiert** — der Nutzer steuert die Lebensdauer selbst.
- Freigabe-Snapshots und Audit-Ereignisse dokumentieren die Verantwortlichkeit
  für veröffentlichte Inhalte und bleiben bis zur Projektlöschung erhalten.
- Für den produktiven Betrieb empfohlen (nicht Teil des MVP): automatische
  Löschfristen (z. B. 24 Monate nach Vermarktungsende) und Objektspeicher-
  Lifecycle-Regeln.

## Löschworkflow

**In der App:** Projektseite → Abschnitt „Prüfung, Freigabe & Export“ →
„Projekt unwiderruflich löschen“.

Ablauf (`DELETE /api/projects/:id`):

1. Prüfung: angemeldeter Nutzer, Projekt gehört zur eigenen Organisation,
   kein laufender Generierungsjob.
2. Löschung **aller Objekte im Objektspeicher** unter dem Projekt-Präfix
   (`org/<orgId>/project/<projektId>/…`): Quellfotos, normalisierte Bilder,
   Szenen, Videos, Poster, Untertitel.
3. Löschung der Datenbankzeilen per Kaskade: Exposé-Daten, Medien-Metadaten,
   Shots, Jobs, Videoversionen, Rechte-Bestätigungen, Freigaben.
4. Ein organisationsbezogenes Audit-Ereignis (`project.deleted`) dokumentiert
   die Löschung (nur Projekt-ID/Titel, keine Inhalte).

Nutzerkonten und Organisationen werden im MVP administrativ (direkt in der
Datenbank) entfernt; ein Self-Service-Workflow ist für die Produktion
vorzusehen.

## Sicherungskopien

Das MVP legt keine eigenen Backups an. Werden in Produktion Backups
eingerichtet, müssen gelöschte Projekte auch aus Backups nach der definierten
Frist verschwinden (Backup-Rotation dokumentieren).
