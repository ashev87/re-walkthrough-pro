import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SAMPLES = ROOT / "samples"


@pytest.fixture
def load_sample():
    """Load a JSON fixture from samples/ by filename."""

    def _load(name: str):
        return json.loads((SAMPLES / name).read_text(encoding="utf-8"))

    return _load
