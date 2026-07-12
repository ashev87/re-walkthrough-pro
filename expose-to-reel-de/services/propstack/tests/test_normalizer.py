"""Dropdown-resolution tests for the Propstack normalizer (T1).

Contract: given the raw /v1/units response (dropdown values as option IDs) and the
custom_field_groups definitions, the normalizer must produce the same resolved
names that Propstack's own expand=1 view returns as `pretty_value`.
"""

from core.propstack.normalizer import (
    build_dropdown_map,
    normalize_property,
    resolve_custom_fields,
)


def test_build_dropdown_map_maps_option_id_to_name(load_sample):
    cfg = load_sample("custom_field_groups_5472912.json")

    option_map, dropdown_fields = build_dropdown_map(cfg)

    assert option_map[138776] == "Einfamilienhaus mit Garten"
    assert "mwa_objekttyp" in dropdown_fields
    assert "mwa_baujahr" not in dropdown_fields  # numeric field, not a dropdown


def test_resolve_dropdowns_match_propstack_expand_pretty_values(load_sample):
    raw = load_sample("property_5472912_raw.json")
    cfg = load_sample("custom_field_groups_5472912.json")
    resolved = load_sample("property_5472912_resolved.json")

    option_map, dropdown_fields = build_dropdown_map(cfg)
    out = resolve_custom_fields(raw["custom_fields"], option_map, dropdown_fields)

    expected = resolved["custom_fields"]
    checked = 0
    for field in dropdown_fields:
        raw_val = raw["custom_fields"].get(field)
        if raw_val is None or field not in expected:
            continue
        assert out[field] == expected[field]["pretty_value"], field
        checked += 1
    assert checked > 10  # sanity: many dropdown fields were actually exercised


def test_non_dropdown_fields_pass_through_unchanged(load_sample):
    raw = load_sample("property_5472912_raw.json")
    cfg = load_sample("custom_field_groups_5472912.json")

    option_map, dropdown_fields = build_dropdown_map(cfg)
    out = resolve_custom_fields(raw["custom_fields"], option_map, dropdown_fields)

    assert out["mwa_baujahr"] == 1933  # numeric, passed through untouched


def test_unknown_option_id_resolves_to_empty_string(load_sample):
    cfg = load_sample("custom_field_groups_5472912.json")
    option_map, dropdown_fields = build_dropdown_map(cfg)

    out = resolve_custom_fields({"mwa_objekttyp": 999999999}, option_map, dropdown_fields)

    assert out["mwa_objekttyp"] == ""


def test_normalize_property_resolves_dropdowns_and_sources_contact(load_sample):
    raw = load_sample("property_5472912_raw.json")
    cfg = load_sample("custom_field_groups_5472912.json")
    contact = load_sample("contact_31692831.json")

    norm = normalize_property(raw, cfg, contact)

    assert norm["id"] == 5472912
    assert norm["custom_fields"]["mwa_objekttyp"] == "Einfamilienhaus mit Garten"
    assert norm["contact"]["email"] == "ch.le@gmx.de"
    assert norm["contact"]["anrede"] == "Frau"


def test_normalize_property_drops_retyped_contact_fields(load_sample):
    raw = load_sample("property_5472912_raw.json")
    cfg = load_sample("custom_field_groups_5472912.json")
    contact = load_sample("contact_31692831.json")

    norm = normalize_property(raw, cfg, contact)

    for field in ("mwa_email", "mwa_vorname", "mwa_nachname", "mwa_anrede", "mwa_geehrte"):
        assert field not in norm["custom_fields"]
