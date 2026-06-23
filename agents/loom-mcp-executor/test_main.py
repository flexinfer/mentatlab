from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


def _load_module():
    module_path = Path(__file__).with_name("main.py")
    spec = importlib.util.spec_from_file_location("loom_mcp_executor_main", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_single_event(output: str):
    lines = [line for line in output.strip().splitlines() if line.strip()]
    assert len(lines) == 1
    return json.loads(lines[0])


def test_resolve_placeholders_nested():
    mod = _load_module()
    env = {
        "FLEXINFER_MODEL": "llama3.1:8b",
        "FLEXINFER_PROXY_URL": "http://flexinfer.example",
    }
    payload = {
        "model": "${FLEXINFER_MODEL}",
        "nested": {"url": "${FLEXINFER_PROXY_URL}"},
        "list": ["${FLEXINFER_MODEL}", "${MISSING:-fallback}"],
    }

    resolved = mod.resolve_placeholders(payload, env)
    assert resolved["model"] == "llama3.1:8b"
    assert resolved["nested"]["url"] == "http://flexinfer.example"
    assert resolved["list"] == ["llama3.1:8b", "fallback"]


def test_validate_runtime_contract_missing_env():
    mod = _load_module()
    spec = {
        "runtime_contract": {
            "required_env": ["FLEXINFER_PROXY_URL", "FLEXINFER_MODEL"],
        }
    }
    env = {"FLEXINFER_PROXY_URL": "http://flexinfer.example"}

    err = mod.validate_runtime_contract(spec, env)
    assert err is not None
    assert "FLEXINFER_MODEL" in err


def test_call_flexinfer_inference_builds_openai_request(monkeypatch):
    mod = _load_module()
    captured: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"id":"chatcmpl-test","choices":[]}'

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["timeout"] = timeout
        captured["body"] = req.data.decode("utf-8") if req.data else ""
        captured["authorization"] = req.headers.get("Authorization")
        return FakeResponse()

    monkeypatch.setattr(mod.urllib.request, "urlopen", fake_urlopen)

    result = mod.call_flexinfer_inference(
        {
            "proxy_url": "http://flexinfer-proxy.local",
            "model": "qwen2.5:7b",
            "prompt": "Summarize this DAG run",
            "temperature": "0.2",
            "max_tokens": "128",
            "api_key": "secret-token",
        }
    )

    assert captured["url"] == "http://flexinfer-proxy.local/v1/chat/completions"
    assert captured["timeout"] == 30.0
    assert captured["authorization"] == "Bearer secret-token"

    request_body = json.loads(str(captured["body"]))
    assert request_body["model"] == "qwen2.5:7b"
    assert request_body["messages"] == [{"role": "user", "content": "Summarize this DAG run"}]
    assert request_body["temperature"] == 0.2
    assert request_body["max_tokens"] == 128

    assert result["id"] == "chatcmpl-test"


def test_main_emits_result_for_mcp_tool(monkeypatch, capsys):
    mod = _load_module()

    monkeypatch.setattr(
        mod,
        "read_input_contract",
        lambda: {
            "spec": {
                "tool_name": "k8s_apps_k3s__k8s_get",
                "mcp_server": "k8s_apps_k3s",
                "tool_args": {"kind": "pods"},
            }
        },
    )

    seen = {}

    def fake_run(cmd, capture_output, text, check):
        seen["cmd"] = cmd
        return SimpleNamespace(returncode=0, stdout='{"ok":true}', stderr="")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)

    code = mod.main()
    assert code == 0

    event = parse_single_event(capsys.readouterr().out)
    assert event["type"] == "output"
    assert event["key"] == "result"
    assert event["value"]["tool_name"] == "k8s_apps_k3s__k8s_get"
    assert event["value"]["mcp_server"] == "k8s_apps_k3s"
    assert event["value"]["tool_args"] == {"kind": "pods"}
    assert Path(seen["cmd"][0]).name == "loom"
    assert seen["cmd"][1:4] == ["tools", "call", "k8s_apps_k3s__k8s_get"]


def test_main_uses_flexinfer_inference_path(monkeypatch, capsys):
    mod = _load_module()

    monkeypatch.setattr(
        mod,
        "read_input_contract",
        lambda: {
            "spec": {
                "tool_name": "flexinfer__inference_chat",
                "mcp_server": "flexinfer",
                "tool_args": {
                    "proxy_url": "http://proxy",
                    "model": "qwen2.5:7b",
                    "prompt": "hello",
                },
            }
        },
    )

    monkeypatch.setattr(mod, "call_flexinfer_inference", lambda args: {"choices": [{"message": {"content": "ok"}}]})

    def fail_if_called(*args, **kwargs):
        raise AssertionError("subprocess.run should not be called for flexinfer__inference_chat")

    monkeypatch.setattr(mod.subprocess, "run", fail_if_called)

    code = mod.main()
    assert code == 0

    event = parse_single_event(capsys.readouterr().out)
    assert event["type"] == "output"
    assert event["key"] == "result"
    assert event["value"]["tool_name"] == "flexinfer__inference_chat"
    assert event["value"]["mcp_server"] == "flexinfer"


def test_main_errors_without_tool_name(monkeypatch, capsys):
    mod = _load_module()

    monkeypatch.setattr(mod, "read_input_contract", lambda: {"spec": {}})

    code = mod.main()
    assert code == 2

    event = parse_single_event(capsys.readouterr().out)
    assert event["type"] == "output"
    assert event["key"] == "error"
    assert "missing tool_name" in event["value"]["error"]


def test_main_errors_when_loom_runtime_missing(monkeypatch, capsys):
    mod = _load_module()

    monkeypatch.setattr(
        mod,
        "read_input_contract",
        lambda: {
            "spec": {
                "tool_name": "k8s_apps_k3s__k8s_get",
                "tool_args": {"kind": "pods"},
            }
        },
    )
    monkeypatch.setattr(mod, "resolve_loom_bin", lambda: "/missing/loom")

    def raise_missing(*args, **kwargs):
        raise FileNotFoundError("loom not installed")

    monkeypatch.setattr(mod, "call_loom_tool", raise_missing)

    code = mod.main()
    assert code == 127

    event = parse_single_event(capsys.readouterr().out)
    assert event["type"] == "output"
    assert event["key"] == "error"
    assert event["value"]["error"] == "loom runtime unavailable"
    assert event["value"]["tool_name"] == "k8s_apps_k3s__k8s_get"


def test_main_preserves_nonzero_exit_code_for_loom_failures(monkeypatch, capsys):
    mod = _load_module()

    monkeypatch.setattr(
        mod,
        "read_input_contract",
        lambda: {
            "spec": {
                "tool_name": "k8s_apps_k3s__k8s_get",
                "tool_args": {"kind": "pods"},
            }
        },
    )

    def raise_runtime(*args, **kwargs):
        raise RuntimeError(
            '{"error":"loom tools call failed","exit_code":9,"command":["loom"],"stdout":"","stderr":"boom"}'
        )

    monkeypatch.setattr(mod, "call_loom_tool", raise_runtime)

    code = mod.main()
    assert code == 9

    event = parse_single_event(capsys.readouterr().out)
    assert event["type"] == "output"
    assert event["key"] == "error"
    assert event["value"]["exit_code"] == 9


@pytest.mark.parametrize(
    "tool_name,expected",
    [
        ("k8s_apps_k3s__k8s_get", "k8s_apps_k3s__k8s_get"),
        ("flexinfer__inference_chat", "flexinfer__inference_chat"),
    ],
)
def test_build_payload_preserves_tool_name(tool_name, expected):
    mod = _load_module()
    payload = mod.build_payload(
        {"tool_name": tool_name, "mcp_server": "server", "tool_args": {}},
        {"ok": True},
        0.123,
    )
    assert payload["tool_name"] == expected
