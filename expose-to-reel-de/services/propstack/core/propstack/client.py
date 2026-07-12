"""Thin Propstack REST client.

Wraps the handful of `/v1` endpoints the MWA engine needs. The API key is loaded
from the environment by the caller (never hardcoded) and injected as the
`api_key` query param Propstack expects.

A `session` can be injected for testing; in production it defaults to a
`requests.Session`.
"""

from __future__ import annotations

import base64
import contextlib
import os
from typing import Optional, Tuple, Union

import requests

from core.propstack.contact import owner_client_id

BASE_URL = "https://api.propstack.de/v1"

# (connect, read) seconds. A hung Propstack call or file download must never pin a
# worker thread indefinitely — every request carries an explicit timeout.
DEFAULT_TIMEOUT: Tuple[float, float] = (5.0, 60.0)


class PropstackTimeoutError(RuntimeError):
    """A Propstack request exceeded its timeout — surfaced as a clear job error."""


@contextlib.contextmanager
def _as_timeout(what: str):
    """Translate requests' timeout into a clear, German-surfaceable application error."""
    try:
        yield
    except requests.Timeout as error:
        raise PropstackTimeoutError(
            f"Propstack-Anfrage hat das Zeitlimit überschritten ({what})."
        ) from error


class PropstackClient:
    def __init__(
        self,
        api_key: str,
        session: Optional[object] = None,
        base_url: str = BASE_URL,
        read_only: bool = False,
        timeout: Union[float, Tuple[float, float]] = DEFAULT_TIMEOUT,
    ):
        if not api_key:
            raise ValueError("Propstack api_key is required (load it from the environment).")
        self._api_key = api_key
        self._session = session or requests.Session()
        self._base = base_url.rstrip("/")
        self._read_only = read_only
        self._timeout = timeout

    @classmethod
    def from_env(cls, var: str = "propstack_api_key", **kwargs) -> "PropstackClient":
        """Build a client from an environment variable holding the (rotated) key.

        In DEMO_MODE the client is read-only: every write (upload_document) is blocked,
        so a demo deployment can never push files to Propstack.
        """
        key = os.environ.get(var)
        if not key:
            raise RuntimeError(f"Environment variable {var!r} is not set.")
        kwargs.setdefault("read_only", bool(os.environ.get("DEMO_MODE")))
        return cls(key, **kwargs)

    def __repr__(self) -> str:  # never leak the key
        return f"PropstackClient(base_url={self._base!r})"

    def _get(self, path: str, **params) -> dict:
        params["api_key"] = self._api_key
        with _as_timeout(f"GET {path}"):
            response = self._session.get(
                f"{self._base}/{path}", params=params, timeout=self._timeout
            )
        response.raise_for_status()
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        if self._read_only:
            raise RuntimeError("Propstack ist im Demo-Modus schreibgeschützt (keine Uploads).")
        with _as_timeout(f"POST {path}"):
            response = self._session.post(
                f"{self._base}/{path}", params={"api_key": self._api_key},
                json=payload, timeout=self._timeout,
            )
        response.raise_for_status()
        return response.json()

    def get_unit(self, unit_id: int, expand: bool = False) -> dict:
        """Fetch a property/unit. With expand=True, dropdowns are resolved to
        `pretty_value` and `relationships` (linked contacts) are included."""
        params = {}
        if expand:
            params["new"] = 1
            params["expand"] = 1
        return self._get(f"units/{unit_id}", **params)

    def get_custom_field_groups(self, unit_id: int) -> dict:
        """Fetch custom-field definitions (incl. dropdown option id->name) for a property."""
        return self._get("custom_field_groups", for_properties=unit_id)

    def get_contact(self, contact_id: int) -> dict:
        """Fetch a single contact (the canonical owner/Eigentümer record)."""
        return self._get(f"contacts/{contact_id}")

    def get_documents(self, property_id: int) -> list:
        """List documents attached to a property (normalized to a list)."""
        response = self._get("documents", property=property_id, per=100)
        if isinstance(response, list):
            return response
        for key in ("data", "documents"):
            value = response.get(key)
            if isinstance(value, list):
                return value
        return []

    def download_file(self, url: str) -> bytes:
        """Download a document's file bytes (external/signed URL, no api_key)."""
        with _as_timeout("download_file"):
            response = self._session.get(url, timeout=self._timeout)
        response.raise_for_status()
        return response.content

    def upload_document(
        self, property_id: int, title: str, content: bytes, content_type: str = "application/pdf"
    ) -> dict:
        """Attach a document (e.g. the generated MWA, or the Pricehubble report) to a property."""
        data_uri = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
        payload = {"document": {"property_id": int(property_id), "doc": data_uri, "title": title}}
        return self._post("documents", payload)

    def get_owner_contact(self, expanded_unit: dict) -> Optional[dict]:
        """Fetch the linked Eigentümer contact for an already-fetched expanded unit.

        Committed owner-fetch approach (see the package docstring): the owner link
        lives only in the expand=1 unit's `relationships`, so resolving a property's
        canonical contact costs TWO calls — get_unit(expand=True) then this one
        contact fetch. Returns None when the property has no owner relationship.
        """
        cid = owner_client_id(expanded_unit)
        if cid is None:
            return None
        return self.get_contact(cid)
