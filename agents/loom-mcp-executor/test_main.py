from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _load_module():
    module_path = Path(__file__).with_name("main.py")
    spec = importlib.util.spec_from_file_location("loom_mcp_executor_main", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
