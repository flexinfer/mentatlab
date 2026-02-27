from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "agents" / "loom-mcp-executor" / "main.py"


def load_module():
    spec = importlib.util.spec_from_file_location("loom_mcp_executor_main", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_extract_tool_request_valid_payload():
    module = load_module()
    tool_name, tool_args = module.extract_tool_request(
        {"tool_name": "gitlab__list_projects", "tool_args": {"per_page": 5}}
    )

    assert tool_name == "gitlab__list_projects"
    assert tool_args == {"per_page": 5}


def test_extract_tool_request_rejects_invalid_input():
    module = load_module()

    try:
        module.extract_tool_request({"tool_name": "", "tool_args": []})
    except ValueError as exc:
        assert "tool_name" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_parse_executor_output_prefers_last_json_line():
    module = load_module()
    payload = module.parse_executor_output('log line\n{"ok":true,"count":2}\n')

    assert payload == {"ok": True, "count": 2}


def test_agent_process_builds_command_and_maps_result(monkeypatch):
    module = load_module()
    calls = {}

    class Completed:
        returncode = 0
        stdout = '{"items":[1,2,3]}'
        stderr = ""

    def fake_run(cmd, capture_output, text, timeout, check):
        calls["cmd"] = cmd
        calls["timeout"] = timeout
        assert capture_output is True
        assert text is True
        assert check is False
        return Completed()

    monkeypatch.setenv("MCP_EXECUTOR_COMMAND", "loom mcp call")
    monkeypatch.setenv("MCP_EXECUTOR_TIMEOUT_SECONDS", "12")
    monkeypatch.setattr(module.subprocess, "run", fake_run)

    agent = module.LoomMCPExecutorAgent()
    out = agent.process(
        spec={"tool_name": "k8s_apps_k3s__k8s_get", "tool_args": {"kind": "pods"}},
        context={},
    )

    assert calls["cmd"][0:3] == ["loom", "mcp", "call"]
    assert calls["cmd"][3] == "k8s_apps_k3s__k8s_get"
    assert calls["timeout"] == 12
    assert out["tool_result"] == {"items": [1, 2, 3]}
