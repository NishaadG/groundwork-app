"""The browser tests' fake API must accept exactly the profile fields the real API does."""

import re
from pathlib import Path

from app.models import ProfileFields

FAKE = Path(__file__).resolve().parents[3] / "apps" / "web" / "e2e" / "fake-api.ts"


def test_fake_api_profile_fields_match_real_model() -> None:
    src = FAKE.read_text(encoding="utf-8")
    block = re.search(r"const PROFILE_FIELDS = new Set\(\[(.*?)\]\)", src, re.S)
    assert block, "PROFILE_FIELDS not found in e2e/fake-api.ts"
    fake = set(re.findall(r'"([a-z_0-9]+)"', block.group(1)))
    assert fake == set(ProfileFields.model_fields)
