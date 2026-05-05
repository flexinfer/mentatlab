from __future__ import annotations

import json

from agents.common.emit import emit_error, emit_heartbeat, emit_progress


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


def test_emit_progress_emits_percent_message_and_eta(capsys) -> None:
    emit_progress(percent=42.25, message="halfway-ish", eta_seconds=12.5)

    event = json.loads(capsys.readouterr().out.strip())
    assert event["type"] == "progress"
    assert event["level"] == "info"
    assert event["message"] == "halfway-ish"
    assert event["data"] == {
        "percent": 42.2,
        "message": "halfway-ish",
        "eta_seconds": 12.5,
    }


def test_emit_progress_preserves_current_total_compatibility(capsys) -> None:
    emit_progress(2, 5)

    event = json.loads(capsys.readouterr().out.strip())
    assert event["type"] == "progress"
    assert event["message"] == "Progress: 2/5"
    assert event["data"] == {
        "percent": 40.0,
        "current": 2,
        "total": 5,
    }


def test_emit_heartbeat_emits_liveness_event(capsys) -> None:
    emit_heartbeat()

    event = json.loads(capsys.readouterr().out.strip())
    assert event["type"] == "heartbeat"
    assert "data" not in event
