"""Linked Eigentümer (owner) contact sourcing.

The canonical recipient is the contact linked to the property as `owner`, found
via the unit's `relationships` (present in the expand=1 view). Its name/salutation/
email are authoritative — the retyped `mwa_anrede/vorname/nachname/email` fields on
the property are NOT used (they drift, e.g. slenkeit@gmail.com vs ch.le@gmx.de).
"""

from __future__ import annotations

from typing import Optional

OWNER_RELATIONSHIP = "owner"

# Propstack salutation codes -> German Anrede + matching "geehrte/geehrter" ending.
# NOTE: the exact set of codes the DK CRM emits (e.g. for "Divers") is an open
# question for Dorian. Anything not listed here is handled by the safe fallback
# below — it never produces a silent blank greeting.
_SALUTATION = {
    "mr": ("Herr", "geehrter"),
    "ms": ("Frau", "geehrte"),
    "mrs": ("Frau", "geehrte"),
}

# Gender-neutral business greeting: "Sehr geehrte Damen und Herren".
_NEUTRAL = ("Damen und Herren", "geehrte")

# salutation_status values:
#   "mapped"   — a known personal salutation; personal briefanrede with surname.
#   "company"  — company contact; neutral greeting is correct, no review needed.
#   "unmapped" — missing/unknown personal code; neutral greeting applied AND flagged
#                so T4 validation surfaces it for human review.


def owner_client_id(unit: dict) -> Optional[int]:
    """Return the linked owner contact's client_id, or None if there is no owner."""
    for rel in unit.get("relationships", []) or []:
        if rel.get("internal_name") == OWNER_RELATIONSHIP:
            return rel.get("client_id")
    return None


def _resolve_salutation(contact: dict) -> tuple[str, str, str]:
    """Return (anrede, geehrte, status). Never returns blanks."""
    code = (contact.get("salutation") or "").strip().lower()
    if contact.get("is_company"):
        anrede, geehrte = _NEUTRAL
        return anrede, geehrte, "company"
    if code in _SALUTATION:
        anrede, geehrte = _SALUTATION[code]
        return anrede, geehrte, "mapped"
    # Missing or unknown personal salutation: safe neutral default + flag.
    anrede, geehrte = _NEUTRAL
    return anrede, geehrte, "unmapped"


def build_contact_block(contact: dict) -> dict:
    """Build the canonical recipient block from a contact record.

    Always includes a ready-to-render `briefanrede` (salutation line) that is never
    a silent blank: unknown/missing salutations fall back to the neutral
    "Sehr geehrte Damen und Herren" and set salutation_status="unmapped" for review.
    """
    anrede, geehrte, status = _resolve_salutation(contact)
    titel = contact.get("academic_title") or ""
    nachname = contact.get("last_name") or ""

    if status == "mapped":
        name_part = f"{titel} {nachname}".strip()
        briefanrede = f"Sehr {geehrte} {anrede} {name_part}".strip()
    else:
        briefanrede = f"Sehr {geehrte} {anrede}".strip()  # "Sehr geehrte Damen und Herren"

    return {
        "anrede": anrede,
        "geehrte": geehrte,
        "titel": titel,
        "vorname": contact.get("first_name") or "",
        "nachname": nachname,
        "email": contact.get("email") or "",
        "briefanrede": briefanrede,
        "salutation_status": status,
    }
