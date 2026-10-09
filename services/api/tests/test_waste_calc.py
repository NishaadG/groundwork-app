import pytest

from app.calc.waste import Item, materials, preset_kg, value_scan


def test_every_material_is_sourced_or_explicitly_unvalued() -> None:
    for m in materials().values():
        if m["rate_inr_per_kg"] is not None:
            assert m["rate_sources"], m["id"]
            assert m["rate_inr_per_kg"]["min"] <= m["rate_inr_per_kg"]["max"]
        assert m["stream"] in {"wet", "dry", "sanitary", "special_care", "e_waste"}


def test_value_by_hand() -> None:
    v = value_scan(
        [Item(material="newspaper", kg=5), Item(material="pet", kg=1), Item(material="glass", kg=2)]
    )
    # newspaper 5 × ₹11–12, PET 1 × ₹20, glass not bought
    assert (v.inr_min, v.inr_max) == (75, 80)
    # WARM: newspaper (−0.85 − −2.71) and PET (0.02 − −1.04), glass (0.02 − −0.28), per short ton
    expected_kg = (
        5 * 1.86 * 1000 / 907.18474 + 1 * 1.06 * 1000 / 907.18474 + 2 * 0.30 * 1000 / 907.18474
    )
    assert v.co2_t == pytest.approx(expected_kg / 1000, abs=1e-4)
    assert v.kg_total == 8 and v.kg_diverted == 8
    glass = next(i for i in v.items if i.material == "glass")
    assert glass.inr_min is None and glass.co2_kg is not None


def test_sanitary_is_not_diverted_and_has_no_value() -> None:
    v = value_scan([Item(material="sanitary", kg=1), Item(material="wet", kg=2)])
    assert v.inr_max == 0 and v.kg_diverted == 2  # wet waste counts when composted
    assert next(i for i in v.items if i.material == "sanitary").co2_kg is None


def test_unknown_material_rejected() -> None:
    with pytest.raises(ValueError):
        value_scan([Item(material="unobtainium", kg=1)])


def test_presets() -> None:
    assert (preset_kg("handful"), preset_kg("bag"), preset_kg("sack")) == (0.2, 1.5, 6.0)
