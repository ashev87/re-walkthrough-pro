"""Propstack integration: client, dropdown normalizer, and contact sourcing.

Owner-fetch approach (COMMITTED)
--------------------------------
A property's canonical Eigentümer contact is resolved in TWO API calls:

    1. GET /v1/units/{id}?new=1&expand=1   -> the expanded unit, whose
       `relationships` array carries [{internal_name: "owner", client_id: ...}].
       (The plain, non-expanded unit has an empty `relationships`/`links`, and the
       /v1/contacts `property_id` filter is ignored, so this is the only reliable link.)
    2. GET /v1/contacts/{client_id}        -> the canonical name/salutation/email.

`PropstackClient.get_owner_contact(expanded_unit)` encapsulates step 2.

Rate-limit cost (relevant for Phase 3 batching): every property needs the unit call
PLUS one contact call — i.e. ~2 requests per property minimum, before
custom_field_groups (a 3rd). Batch jobs must budget for this and respect Propstack's
rate limits (consider caching custom_field_groups, which is property-independent).
"""
