"""Linked Eigentümer contact sourcing tests (T2).

Single source of truth: the recipient block comes from the linked contact
(relationships[internal_name == "owner"].client_id), NOT the retyped mwa_* fields
on the property. This kills the email/name drift (slenkeit@gmail.com vs ch.le@gmx.de).
"""

import pytest

from core.propstack.contact import owner_client_id, build_contact_block


def test_owner_client_id_from_relationships(load_sample):
    resolved = load_sample("property_5472912_resolved.json")

    assert owner_client_id(resolved) == 31692831


def test_owner_client_id_none_when_no_owner_relationship():
    assert owner_client_id({"relationships": [{"internal_name": "buyer", "client_id": 1}]}) is None
    assert owner_client_id({}) is None


def test_build_contact_block_from_linked_contact(load_sample):
    contact = load_sample("contact_31692831.json")

    block = build_contact_block(contact)

    assert block["vorname"] == "Christel"
    assert block["nachname"] == "Lenkeit"
    assert block["email"] == "ch.le@gmx.de"
    assert block["anrede"] == "Frau"
    assert block["geehrte"] == "geehrte"


def test_contact_block_email_overrides_retyped_property_field(load_sample):
    raw = load_sample("property_5472912_raw.json")
    contact = load_sample("contact_31692831.json")

    block = build_contact_block(contact)

    # the property field is the wrong, retyped value...
    assert raw["custom_fields"]["mwa_email"] == "slenkeit@gmail.com"
    # ...and the canonical contact block does not inherit it
    assert block["email"] == "ch.le@gmx.de"
    assert block["email"] != raw["custom_fields"]["mwa_email"]


@pytest.mark.parametrize(
    "salutation,anrede,geehrte",
    [("mr", "Herr", "geehrter"), ("ms", "Frau", "geehrte"), ("mrs", "Frau", "geehrte")],
)
def test_salutation_maps_to_german_anrede(salutation, anrede, geehrte):
    block = build_contact_block(
        {"salutation": salutation, "first_name": "A", "last_name": "B", "email": "a@b.de"}
    )

    assert block["anrede"] == anrede
    assert block["geehrte"] == geehrte
    assert block["salutation_status"] == "mapped"


def test_mapped_briefanrede_is_personal(load_sample):
    contact = load_sample("contact_31692831.json")

    block = build_contact_block(contact)

    assert block["briefanrede"] == "Sehr geehrte Frau Lenkeit"


def test_academic_title_is_carried_and_placed_before_surname():
    block = build_contact_block(
        {"salutation": "mr", "academic_title": "Dr.",
         "first_name": "Max", "last_name": "Mustermann", "email": "m@x.de"}
    )

    assert block["titel"] == "Dr."
    assert block["briefanrede"] == "Sehr geehrter Herr Dr. Mustermann"


def test_company_contact_uses_neutral_greeting_no_flag():
    block = build_contact_block(
        {"is_company": True, "company": "Acme GmbH", "salutation": None,
         "last_name": "", "email": "info@acme.de"}
    )

    assert block["briefanrede"] == "Sehr geehrte Damen und Herren"
    assert block["salutation_status"] == "company"


@pytest.mark.parametrize("salutation", [None, "", "divers", "x-unknown-code"])
def test_unmapped_salutation_never_blank_and_is_flagged(salutation):
    block = build_contact_block(
        {"salutation": salutation, "first_name": "Sam", "last_name": "Doe", "email": "s@d.de"}
    )

    # SAFE FALLBACK: never a silent blank "Sehr geehrte ___"
    assert block["briefanrede"] == "Sehr geehrte Damen und Herren"
    assert "  " not in block["briefanrede"]
    assert block["anrede"] != ""
    # ...and flagged so T4 validation surfaces it for human review
    assert block["salutation_status"] == "unmapped"
