from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from agents.common.input_contract import read_input_contract


def test_read_input_contract_prefers_stdin_spec_context() -> None:
    payload = {"spec": {"tool_name": "x"}, "context": {"execution_id": "abc"}}
    out = read_input_contract(stdin_text=json.dumps(payload), environ={})
    assert out["spec"] == {"tool_name": "x"}
    assert out["context"] == {"execution_id": "abc"}


def test_read_input_contract_treats_direct_object_as_spec() -> None:
    out = read_input_contract(stdin_text='{"foo":"bar"}', environ={})
    assert out["spec"] == {"foo": "bar"}
    assert out["context"] == {}


def test_read_input_contract_falls_back_to_env_vars() -> None:
    env = {
        "INPUT_SPEC": '{"alpha":1}',
        "INPUT_CONTEXT": "{'execution_id':'run-1'}",
    }
    out = read_input_contract(stdin_text="", environ=env)
    assert out["spec"] == {"alpha": 1}
    assert out["context"] == {"execution_id": "run-1"}


def test_echo_agent_uses_input_spec_and_context_contract() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["INPUT_SPEC"] = '{"message":"hello"}'
    env["INPUT_CONTEXT"] = '{"trace_id":"trace-1"}'

    proc = subprocess.run(
        ["python", "agents/echo/main.py"],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout.strip())
    assert payload["result"]["spec"] == {"message": "hello"}
    assert payload["result"]["context"] == {"trace_id": "trace-1"}


def test_packaged_echo_agent_uses_env_contract() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["INPUT_SPEC"] = '{"message":"hello"}'
    env["INPUT_CONTEXT"] = '{"trace_id":"trace-2"}'

    proc = subprocess.run(
        ["python", "services/agents/echo/src/main.py"],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout.strip())
    assert payload["result"]["spec"] == {"message": "hello"}
    assert payload["result"]["context"] == {"trace_id": "trace-2"}
