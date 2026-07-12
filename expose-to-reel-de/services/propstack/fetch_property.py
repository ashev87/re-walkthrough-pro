"""CLI bridge: fetch one Propstack property and print it as JSON to stdout.

Called by the Exposé-to-Reel web app (Node spawns `python fetch_property.py <id>`).
The Propstack access itself lives verbatim in core/propstack/ (copied from
MWA_webapp — do not rewrite); this file only implements the committed
fetch-and-normalize pattern around it and the process I/O contract:

    stdout: one JSON object — {"ok": true, "data": {...}} or
            {"ok": false, "code": "...", "error": "..."}
    exit:   0 ok · 2 invalid input · 3 missing api key · 4 http error · 5 timeout

Offline mode (tests/demo, no network, no key): set PROPSTACK_FIXTURES=1 —
serves the committed samples/ fixtures for property 5472912 only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import requests

from core.propstack.client import PropstackClient, PropstackTimeoutError
from core.propstack.contact import build_contact_block
from core.propstack.normalizer import (
    build_dropdown_map,
    normalize_property,
    resolve_custom_fields,
)

SAMPLES = ROOT / "samples"
FIXTURE_PROPERTY_ID = 5472912
FIXTURE_CONTACT_ID = 31692831


class FixtureClient:
    """Offline stand-in for PropstackClient, serving the committed fixtures.

    Same read interface as PropstackClient (see also FakePropstack in the MWA
    test suite) — only supports the fixture property 5472912.
    """

    def _load(self, name: str) -> dict:
        return json.loads((SAMPLES / name).read_text(encoding="utf-8"))

    def _check(self, property_id: int) -> None:
        if int(property_id) != FIXTURE_PROPERTY_ID:
            raise LookupError(
                f"Fixture-Modus kennt nur Objekt {FIXTURE_PROPERTY_ID} (angefragt: {property_id})."
            )

    def get_unit(self, property_id: int, expand: bool = False) -> dict:
        self._check(property_id)
        name = "property_5472912_resolved.json" if expand else "property_5472912_raw.json"
        return self._load(name)

    def get_custom_field_groups(self, property_id: int) -> dict:
        self._check(property_id)
        return self._load("custom_field_groups_5472912.json")

    def get_owner_contact(self, expanded_unit: dict):
        from core.propstack.contact import owner_client_id

        cid = owner_client_id(expanded_unit)
        if cid is None:
            return None
        if cid != FIXTURE_CONTACT_ID:
            return None
        return self._load("contact_31692831.json")


def fetch_property(client, property_id: int) -> dict:
    """Committed fetch-and-normalize pattern (from MWA `_fetch_and_normalize`)."""
    unit_expanded = client.get_unit(property_id, expand=True)
    unit_raw = client.get_unit(property_id)
    field_groups = client.get_custom_field_groups(property_id)
    owner = client.get_owner_contact(unit_expanded) or {}

    normalized = normalize_property(unit_raw, field_groups, owner)

    option_map, dropdown_fields = build_dropdown_map(field_groups)
    resolved_cf = resolve_custom_fields(
        unit_raw.get("custom_fields", {}), option_map, dropdown_fields
    )
    contact = build_contact_block(owner)

    return {
        "id": property_id,
        "raw": unit_raw,
        "expanded": unit_expanded,
        "custom_fields": resolved_cf,
        "contact": contact,
        "normalized": normalized,
        "broker": unit_raw.get("broker"),
        "address": {
            "street": unit_raw.get("street"),
            "house_number": unit_raw.get("house_number"),
            "zip_code": unit_raw.get("zip_code"),
            "city": unit_raw.get("city"),
            "district": unit_raw.get("district"),
        },
        "images": unit_raw.get("images", []),
    }


def _emit(payload: dict, exit_code: int) -> int:
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.flush()
    return exit_code


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Fetch a Propstack property as JSON.")
    parser.add_argument("property_id", help="Numeric Propstack unit ID")
    parser.add_argument(
        "--fixtures",
        action="store_true",
        help="Serve committed sample fixtures instead of the live API (also: PROPSTACK_FIXTURES=1)",
    )
    args = parser.parse_args(argv)

    if not str(args.property_id).strip().isdigit():
        return _emit(
            {"ok": False, "code": "invalid_id", "error": "Objekt-ID muss numerisch sein."}, 2
        )
    property_id = int(args.property_id)

    import os

    use_fixtures = args.fixtures or os.environ.get("PROPSTACK_FIXTURES") == "1"
    try:
        if use_fixtures:
            client = FixtureClient()
        else:
            client = PropstackClient.from_env()
        data = fetch_property(client, property_id)
        return _emit({"ok": True, "data": data}, 0)
    except RuntimeError as error:
        # from_env(): missing propstack_api_key (or demo-mode write block)
        return _emit({"ok": False, "code": "missing_api_key", "error": str(error)}, 3)
    except LookupError as error:
        return _emit({"ok": False, "code": "not_found", "error": str(error)}, 4)
    except PropstackTimeoutError as error:
        return _emit({"ok": False, "code": "timeout", "error": str(error)}, 5)
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else 0
        message = (
            f"Propstack antwortete mit HTTP {status}"
            + (" (Objekt nicht gefunden?)" if status == 404 else "")
            + (" (API-Key ungültig?)" if status in (401, 403) else "")
        )
        return _emit({"ok": False, "code": "http_error", "status": status, "error": message}, 4)
    except requests.RequestException as error:
        return _emit(
            {"ok": False, "code": "network", "error": f"Netzwerkfehler: {error}"}, 4
        )


if __name__ == "__main__":
    sys.exit(main())
