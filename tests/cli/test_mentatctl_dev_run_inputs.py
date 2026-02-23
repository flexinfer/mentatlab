import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "cli"))

from mentatctl.main import _build_dev_inputs, _parse_input_value


def test_parse_input_value_json_and_string_fallback():
    assert _parse_input_value("true") is True
    assert _parse_input_value("123") == 123
    assert _parse_input_value('{"k":"v"}') == {"k": "v"}
    assert _parse_input_value("plain-text") == "plain-text"


def test_build_dev_inputs_merges_input_json_and_pair_overrides(tmp_path):
    json_file = tmp_path / "inputs.json"
    json_file.write_text('{"a":"from-json","n":1,"obj":{"k":"base"}}', encoding="utf-8")

    result = _build_dev_inputs(
        ["n=2", 'obj={"k":"override"}', "flag=true", "msg=hello"],
        f"@{json_file}",
    )

    assert result == {
        "a": "from-json",
        "n": 2,
        "obj": {"k": "override"},
        "flag": True,
        "msg": "hello",
    }


def test_build_dev_inputs_rejects_invalid_json():
    with pytest.raises(ValueError, match="Invalid JSON for --input-json"):
        _build_dev_inputs([], '{"a":')


def test_build_dev_inputs_requires_object_json():
    with pytest.raises(ValueError, match="must decode to a JSON object"):
        _build_dev_inputs([], "[1,2,3]")
