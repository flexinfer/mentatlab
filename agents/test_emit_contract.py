from __future__ import annotations

import json

from agents.common.emit import emit_error


def test_emit_error_emits_retryable_structured_event(capsys) -> None:
    emit_error(
        "MODEL_NOT_READY",
        "model is still loading",
        retryable=True,
        details={"model": "qwen2.5:7b"},
    )

    event = json.loads(capsys.readouterr().out.strip())
    assert event["type"] == "error"
    assert event["level"] == "error"
    assert event["message"] == "model is still loading"
    assert event["data"] == {
        "code": "MODEL_NOT_READY",
        "message": "model is still loading",
        "retryable": True,
        "details": {"model": "qwen2.5:7b"},
    }


def test_emit_error_emits_permanent_structured_event(capsys) -> None:
    emit_error("INVALID_INPUT", "missing required field 'text'", retryable=False)

    event = json.loads(capsys.readouterr().out.strip())
    assert event["type"] == "error"
    assert event["level"] == "error"
    assert event["message"] == "missing required field 'text'"
    assert event["data"] == {
        "code": "INVALID_INPUT",
        "message": "missing required field 'text'",
        "retryable": False,
    }
