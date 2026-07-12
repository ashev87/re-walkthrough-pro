"""Propstack data normalizer.

Turns a raw `/v1/units/{id}` response (dropdown values stored as option IDs) into
resolved, human-readable values — the same names Propstack's own `expand=1` view
exposes as `pretty_value`. The dropdown definitions come from
`/v1/custom_field_groups`.

Foundation: legacy/main.py `create_dropdown_mapping` / `get_readable_name_from_option_id`,
generalized so dropdown fields are detected from the field definitions rather than
hardcoded per template slot.
"""

from __future__ import annotations

from core.propstack.contact import build_contact_block

# Contact fields retyped onto the property. They are intentionally dropped from the
# normalized output: the canonical recipient comes from the linked Eigentümer contact.
RETYPED_CONTACT_FIELDS = frozenset(
    {"mwa_anrede", "mwa_geehrte", "mwa_vorname", "mwa_nachname", "mwa_email"}
)


def build_dropdown_map(custom_field_groups: dict) -> tuple[dict[int, str], set[str]]:
    """Build the dropdown resolution tables from a custom_field_groups response.

    Returns:
        option_map: {option_id: option_name} across all Dropdown fields.
        dropdown_fields: the set of custom-field names whose type is Dropdown.
    """
    option_map: dict[int, str] = {}
    dropdown_fields: set[str] = set()

    for group in custom_field_groups.get("data", []):
        for field in group.get("custom_fields", []):
            if field.get("field_type") != "Dropdown":
                continue
            dropdown_fields.add(field["name"])
            for option in field.get("custom_options", []):
                option_map[option["id"]] = option["name"]

    return option_map, dropdown_fields


def resolve_option(value, option_map: dict[int, str]):
    """Resolve a single dropdown value (an option id, or a list of ids) to its name(s).

    Unknown ids resolve to an empty string, mirroring legacy behaviour.
    """
    if isinstance(value, list):
        return [option_map.get(v, "") for v in value]
    return option_map.get(value, "")


def resolve_custom_fields(
    custom_fields: dict,
    option_map: dict[int, str],
    dropdown_fields: set[str],
) -> dict:
    """Resolve dropdown option IDs to names; pass all other fields through unchanged."""
    resolved: dict = {}
    for key, value in custom_fields.items():
        if key in dropdown_fields and value is not None:
            resolved[key] = resolve_option(value, option_map)
        else:
            resolved[key] = value
    return resolved


def normalize_property(
    raw_unit: dict,
    custom_field_groups: dict,
    owner_contact: dict,
) -> dict:
    """Assemble the normalized property model.

    - Dropdown custom fields are resolved from option IDs to names.
    - The recipient/contact block is sourced from the linked Eigentümer contact;
      the retyped mwa_* contact fields are dropped (single source of truth).
    """
    option_map, dropdown_fields = build_dropdown_map(custom_field_groups)
    resolved = resolve_custom_fields(
        raw_unit.get("custom_fields", {}), option_map, dropdown_fields
    )
    custom = {k: v for k, v in resolved.items() if k not in RETYPED_CONTACT_FIELDS}

    return {
        "id": raw_unit.get("id"),
        "address": {
            "street": raw_unit.get("street"),
            "house_number": raw_unit.get("house_number"),
            "zip_code": raw_unit.get("zip_code"),
            "city": raw_unit.get("city"),
            "district": raw_unit.get("district"),
        },
        "broker": raw_unit.get("broker"),
        "contact": build_contact_block(owner_contact),
        "custom_fields": custom,
    }
