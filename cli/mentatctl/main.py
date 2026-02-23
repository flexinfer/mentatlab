#!/usr/bin/env python3
"""
Mentat CLI - Command line interface for Mentat Lab
Enhanced for Sprint 5 with agent lifecycle management commands
"""

import typer
import json
import yaml
import requests
import sys
from pathlib import Path
from jsonschema import validate, ValidationError
from typing import Optional, List, Dict, Any

from .agent_commands import agent
from .runs_commands import runs

# Main CLI application
app = typer.Typer(
    name="mentatctl",
    help="Mentat CLI - Command line interface for managing flows, agents, and runs",
    no_args_is_help=True,
)

# Add subcommand groups
app.add_typer(agent, name="agent")
app.add_typer(runs, name="runs")

# Development commands group
dev_app = typer.Typer(
    name="dev", help="Development commands for local testing", no_args_is_help=True
)
app.add_typer(dev_app, name="dev")


@dev_app.command("run")
def dev_run(
    manifest_file: Path = typer.Argument(..., help="Path to agent manifest.yaml file"),
    input: List[str] = typer.Option([], "--input", "-i", help="Input key=value pairs"),
    input_json: Optional[str] = typer.Option(
        None,
        "--input-json",
        help="JSON object or @path/to/file.json to merge into agent input",
    ),
    follow: bool = typer.Option(False, "--follow", help="Follow execution logs"),
    local: bool = typer.Option(
        False, "--local", help="Run agent as local subprocess (no orchestrator needed)"
    ),
    orchestrator_url: str = typer.Option(
        "http://localhost:7070", "--orchestrator-url", help="Orchestrator service URL"
    ),
    watch: bool = typer.Option(
        False, "--watch", help="Re-run agent when source files change (local mode only)"
    ),
):
    """Execute an agent locally or via orchestrator for development testing"""
    try:
        if watch and not local:
            typer.echo("Error: --watch requires --local", err=True)
            raise typer.Exit(code=1)

        if not manifest_file.exists():
            typer.echo(f"Error: Manifest file not found at {manifest_file}", err=True)
            raise typer.Exit(code=1)

        with open(manifest_file, "r") as f:
            try:
                manifest_data = yaml.safe_load(f)
            except yaml.YAMLError as e:
                typer.echo(f"Error: Invalid YAML in manifest file: {e}", err=True)
                raise typer.Exit(code=1)

        # Parse and merge input parameters
        inputs = _build_dev_inputs(input, input_json)

        agent_id = manifest_data.get("id", "unknown")
        agent_ver = manifest_data.get("version", "?")
        typer.echo(f"Agent: {agent_id} v{agent_ver}")

        if local:
            _dev_run_local(manifest_file, manifest_data, inputs, watch)
        else:
            _dev_run_remote(manifest_data, inputs, orchestrator_url, follow)

    except typer.Exit:
        raise
    except Exception as e:
        typer.echo(f"Error executing agent: {e}", err=True)
        raise typer.Exit(code=1)


def _parse_input_value(raw: str) -> Any:
    """Parse JSON scalars/objects/arrays when possible, otherwise keep string."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _load_input_json(input_json: str) -> Dict[str, Any]:
    """Load JSON object from inline string or @file path."""
    source = input_json.strip()
    if source.startswith("@"):
        file_path = Path(source[1:])
        if not file_path.exists():
            raise ValueError(f"Input JSON file not found: {file_path}")
        content = file_path.read_text(encoding="utf-8")
    else:
        content = source

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON for --input-json: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("--input-json must decode to a JSON object")

    return parsed


def _build_dev_inputs(input_pairs: List[str], input_json: Optional[str]) -> Dict[str, Any]:
    """Merge --input-json base object with --input key=value pairs."""
    inputs: Dict[str, Any] = {}

    if input_json:
        inputs.update(_load_input_json(input_json))

    for inp in input_pairs:
        if "=" not in inp:
            typer.echo(
                f"Warning: Ignoring invalid input format '{inp}' (expected key=value)",
                err=True,
            )
            continue
        key, value = inp.split("=", 1)
        inputs[key] = _parse_input_value(value)

    return inputs


def _dev_run_local(
    manifest_file: Path,
    manifest_data: dict,
    inputs: dict,
    watch: bool,
):
    """Run agent as a local subprocess, optionally watching for file changes."""
    import json as json_mod
    import subprocess
    import time

    command = manifest_data.get("command")
    if not command:
        typer.echo(
            "Error: Manifest has no 'command' field. Cannot run locally.", err=True
        )
        raise typer.Exit(code=1)

    agent_dir = manifest_file.parent

    def run_once() -> int:
        typer.echo(f"Running: {' '.join(command)}")
        try:
            proc = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(agent_dir),
                text=True,
            )
            stdin_data = json_mod.dumps(inputs) if inputs else ""
            stdout, stderr = proc.communicate(input=stdin_data, timeout=120)

            # Parse and display NDJSON events from stdout
            for line in stdout.strip().splitlines():
                try:
                    event = json_mod.loads(line)
                    etype = event.get("type", "?")
                    if etype == "log":
                        level = event.get("level", "info").upper()
                        msg = event.get("message", "")
                        typer.echo(f"  [{level}] {msg}")
                    elif etype == "checkpoint":
                        stage = event.get("data", {}).get("stage", "?")
                        progress = event.get("data", {}).get("progress", 0)
                        typer.echo(f"  [CHECKPOINT] {stage} ({progress:.0%})")
                    elif etype == "output":
                        key = event.get("data", {}).get("key", "?")
                        value = event.get("data", {}).get("value", "")
                        typer.echo(f"  [OUTPUT] {key} = {value}")
                    else:
                        typer.echo(
                            f"  [{etype}] {json_mod.dumps(event.get('data', {}))}"
                        )
                except json_mod.JSONDecodeError:
                    typer.echo(f"  {line}")

            if stderr.strip():
                for line in stderr.strip().splitlines():
                    typer.echo(f"  [STDERR] {line}", err=True)

            typer.echo(f"Exit code: {proc.returncode}")
            return proc.returncode

        except subprocess.TimeoutExpired:
            proc.kill()
            typer.echo("Error: Agent timed out after 120s", err=True)
            return 1

    exit_code = run_once()

    if watch:
        typer.echo(f"\nWatching {agent_dir} for changes (Ctrl+C to stop)...")
        last_mtime = _dir_mtime(agent_dir)
        try:
            while True:
                time.sleep(1)
                current_mtime = _dir_mtime(agent_dir)
                if current_mtime != last_mtime:
                    last_mtime = current_mtime
                    typer.echo(f"\n--- File changed, re-running ---")
                    exit_code = run_once()
        except KeyboardInterrupt:
            typer.echo("\nStopped watching.")

    raise typer.Exit(code=exit_code)


def _dir_mtime(directory: Path) -> float:
    """Return the most recent modification time of any file in directory."""
    latest = 0.0
    for p in directory.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            try:
                mt = p.stat().st_mtime
                if mt > latest:
                    latest = mt
            except OSError:
                pass
    return latest


def _dev_run_remote(
    manifest_data: dict,
    inputs: dict,
    orchestrator_url: str,
    follow: bool,
):
    """Submit agent execution to orchestrator via API."""
    import time

    # Build a run plan with a single agent node
    run_data = {
        "plan": {
            "nodes": [
                {
                    "id": "dev-node",
                    "type": "agent",
                    "agent_id": manifest_data.get("id", "unknown"),
                    "inputs": inputs,
                }
            ],
            "edges": [],
        },
        "auto_start": True,
    }

    try:
        response = requests.post(
            f"{orchestrator_url}/api/v1/runs", json=run_data, timeout=30
        )

        if response.status_code in (200, 201):
            result = response.json()
            run_id = result.get("run", {}).get("id", result.get("id"))
            typer.echo(f"Run created: {run_id}")

            if follow and run_id:
                typer.echo("Following execution...")
                while True:
                    try:
                        status_response = requests.get(
                            f"{orchestrator_url}/api/v1/runs/{run_id}",
                            timeout=10,
                        )
                        if status_response.status_code == 200:
                            run_info = status_response.json()
                            run_status = run_info.get("run", {}).get(
                                "status", "unknown"
                            )
                            typer.echo(f"  Status: {run_status}")

                            if run_status in ("succeeded", "failed", "cancelled"):
                                break

                        time.sleep(2)
                    except requests.RequestException as e:
                        typer.echo(f"Warning: Could not check status: {e}")
                        break
                    except KeyboardInterrupt:
                        typer.echo("\nStopped following.")
                        break
        else:
            typer.echo(f"Error: {response.status_code} {response.text}", err=True)
            raise typer.Exit(code=1)

    except requests.RequestException as e:
        typer.echo(f"Error connecting to orchestrator: {e}", err=True)
        raise typer.Exit(code=1)


# Legacy flow validation command (backward compatibility)
@app.command("validate")
def validate_flow(
    file_path: Path = typer.Argument(
        ..., help="Path to the .mlab flow file (YAML or JSON)."
    ),
    gateway_url: str = typer.Option(
        "http://localhost:8000", "--gateway-url", help="Gateway service URL"
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate without executing"),
):
    """Validate a flow configuration file"""
    try:
        if not file_path.exists():
            typer.echo(f"❌ Error: File not found at {file_path}", err=True)
            raise typer.Exit(code=1)

        if file_path.suffix not in [".yaml", ".yml", ".json", ".mlab"]:
            typer.echo(
                f"❌ Error: Unsupported file type. Please provide a .yaml, .yml, .json, or .mlab file.",
                err=True,
            )
            raise typer.Exit(code=1)

        try:
            with open(file_path, "r") as f:
                if file_path.suffix in [".yaml", ".yml", ".mlab"]:
                    flow_data = yaml.safe_load(f)
                else:
                    flow_data = json.load(f)
        except (json.JSONDecodeError, yaml.YAMLError) as e:
            typer.echo(
                f"❌ Error: Could not parse {file_path}. Invalid JSON or YAML format: {e}",
                err=True,
            )
            raise typer.Exit(code=1)

        if dry_run:
            # Load the schema
            schema_path = (
                Path(__file__).parent.parent.parent / "schemas" / "flow.schema.json"
            )
            if not schema_path.exists():
                typer.echo(
                    f"❌ Error: Schema file not found at {schema_path}", err=True
                )
                raise typer.Exit(code=1)

            try:
                with open(schema_path, "r") as f:
                    flow_schema = json.load(f)
            except json.JSONDecodeError as e:
                typer.echo(
                    f"❌ Error: Could not parse schema file. Invalid JSON format: {e}",
                    err=True,
                )
                raise typer.Exit(code=1)

            try:
                validate(instance=flow_data, schema=flow_schema)
                typer.echo(f"✅ Flow file '{file_path}' is valid JSON/YAML")
                return
            except ValidationError as e:
                typer.echo(f"❌ Validation failed for {file_path}:")
                typer.echo(f"  Error: {e.message}")
                if e.path:
                    typer.echo(f"  Path: {' -> '.join(map(str, e.path))}")
                raise typer.Exit(code=1)

        # Send to gateway for validation
        try:
            response = requests.post(
                f"{gateway_url}/flows/validate", json=flow_data, timeout=30
            )

            if response.status_code == 200:
                typer.echo(f"✅ Flow '{file_path}' is valid")
            else:
                typer.echo(f"❌ Flow validation failed: {response.text}", err=True)
                raise typer.Exit(code=1)
        except requests.RequestException as e:
            typer.echo(f"❌ Error connecting to gateway: {e}", err=True)
            raise typer.Exit(code=1)

    except Exception as e:
        typer.echo(f"❌ Error validating flow: {e}", err=True)
        raise typer.Exit(code=1)


@app.command("run")
def run_flow(
    file_path: Path = typer.Argument(
        ..., help="Path to the .mlab flow file (YAML or JSON)."
    ),
    gateway_url: str = typer.Option(
        "http://localhost:8000", "--gateway-url", help="Gateway service URL"
    ),
    follow: bool = typer.Option(False, "--follow", help="Follow execution logs"),
):
    """Execute a flow"""
    try:
        if not file_path.exists():
            typer.echo(f"❌ Error: File not found at {file_path}", err=True)
            raise typer.Exit(code=1)

        try:
            with open(file_path, "r") as f:
                if file_path.suffix in [".yaml", ".yml", ".mlab"]:
                    flow_data = yaml.safe_load(f)
                else:
                    flow_data = json.load(f)
        except (json.JSONDecodeError, yaml.YAMLError) as e:
            typer.echo(
                f"❌ Error: Could not parse {file_path}. Invalid JSON or YAML format: {e}",
                err=True,
            )
            raise typer.Exit(code=1)

        # Submit flow for execution
        try:
            response = requests.post(
                f"{gateway_url}/flows/execute", json=flow_data, timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                execution_id = result.get("execution_id")
                typer.echo(f"✅ Flow submitted with execution ID: {execution_id}")

                if follow and execution_id:
                    typer.echo("👀 Following execution logs...")
                    # TODO: Implement log following

            else:
                typer.echo(f"❌ Flow execution failed: {response.text}", err=True)
                raise typer.Exit(code=1)
        except requests.RequestException as e:
            typer.echo(f"❌ Error connecting to gateway: {e}", err=True)
            raise typer.Exit(code=1)

    except Exception as e:
        typer.echo(f"❌ Error executing flow: {e}", err=True)
        raise typer.Exit(code=1)


# Completion command for shell integration
@app.command("completion")
def generate_completion(
    shell: str = typer.Argument(
        ..., help="Shell to generate completion for: bash, zsh, fish, or powershell"
    ),
):
    """Generate shell completion script.

    To install completions:

    \b
    # Bash (add to ~/.bashrc):
    eval "$(mentatctl completion bash)"

    \b
    # Zsh (add to ~/.zshrc):
    eval "$(mentatctl completion zsh)"

    \b
    # Fish:
    mentatctl completion fish > ~/.config/fish/completions/mentatctl.fish

    \b
    # PowerShell:
    mentatctl completion powershell >> $PROFILE
    """
    import subprocess
    import os

    shell = shell.lower()
    valid_shells = {"bash", "zsh", "fish", "powershell"}

    if shell not in valid_shells:
        typer.echo(f"❌ Unsupported shell: {shell}", err=True)
        typer.echo(f"   Supported shells: {', '.join(valid_shells)}", err=True)
        raise typer.Exit(code=1)

    # Get the path to this script
    script_name = "mentatctl"

    # Typer uses click under the hood, which provides completion via _<APP>_COMPLETE env var
    env_var = f"_{script_name.upper()}_COMPLETE"

    if shell == "bash":
        completion_var = f"{env_var}=bash_source"
    elif shell == "zsh":
        completion_var = f"{env_var}=zsh_source"
    elif shell == "fish":
        completion_var = f"{env_var}=fish_source"
    else:  # powershell
        completion_var = f"{env_var}=powershell_source"

    # Generate completion by running ourselves with the completion env var
    env = os.environ.copy()
    env[env_var] = completion_var.split("=")[1]

    try:
        result = subprocess.run(
            [sys.executable, "-m", "cli.mentatctl.main"],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.stdout:
            typer.echo(result.stdout)
        else:
            # Fallback: generate a basic completion script
            if shell == "bash":
                typer.echo(
                    f"""
# mentatctl bash completion
_mentatctl_completion() {{
    local IFS=$'\\n'
    COMPREPLY=( $(compgen -W "agent runs dev validate run debug completion" -- "${{COMP_WORDS[COMP_CWORD]}}") )
}}
complete -F _mentatctl_completion mentatctl
"""
                )
            elif shell == "zsh":
                typer.echo(
                    f"""
# mentatctl zsh completion
#compdef mentatctl

_mentatctl() {{
    local -a commands
    commands=(
        'agent:Manage agents - register, list, inspect, delete'
        'runs:Manage orchestrator runs - list, inspect, cancel, watch'
        'dev:Development commands for local testing'
        'validate:Validate a flow configuration file'
        'run:Execute a flow'
        'debug:Check connectivity to all MentatLab services'
        'completion:Generate shell completion script'
    )
    _describe 'command' commands
}}

compdef _mentatctl mentatctl
"""
                )
            elif shell == "fish":
                typer.echo(
                    """
# mentatctl fish completion
complete -c mentatctl -n "__fish_use_subcommand" -a agent -d "Manage agents"
complete -c mentatctl -n "__fish_use_subcommand" -a runs -d "Manage runs"
complete -c mentatctl -n "__fish_use_subcommand" -a dev -d "Development commands"
complete -c mentatctl -n "__fish_use_subcommand" -a validate -d "Validate a flow"
complete -c mentatctl -n "__fish_use_subcommand" -a run -d "Execute a flow"
complete -c mentatctl -n "__fish_use_subcommand" -a debug -d "Check connectivity"
complete -c mentatctl -n "__fish_use_subcommand" -a completion -d "Generate completions"
"""
                )
            else:  # powershell
                typer.echo(
                    """
# mentatctl PowerShell completion
Register-ArgumentCompleter -Native -CommandName mentatctl -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @('agent', 'runs', 'dev', 'validate', 'run', 'debug', 'completion')
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
"""
                )
    except Exception as e:
        typer.echo(f"❌ Error generating completions: {e}", err=True)
        raise typer.Exit(code=1)


# Debug command for connection diagnostics
@app.command("debug")
def debug_connections(
    gateway_url: str = typer.Option(
        "http://localhost:8080", "--gateway-url", help="Gateway service URL"
    ),
    orchestrator_url: str = typer.Option(
        "http://localhost:7070", "--orchestrator-url", help="Orchestrator service URL"
    ),
    redis_url: str = typer.Option("localhost:6379", "--redis-url", help="Redis URL"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show detailed output"),
):
    """Check connectivity to all MentatLab services"""
    import socket

    typer.echo("🔍 MentatLab Connection Diagnostics")
    typer.echo("=" * 40)

    all_healthy = True

    # Check Gateway
    typer.echo("\n📡 Gateway:")
    try:
        response = requests.get(f"{gateway_url}/healthz", timeout=5)
        if response.status_code == 200:
            typer.echo(f"   ✓ {gateway_url} - healthy")
            if verbose:
                typer.echo(f"     Response: {response.text[:100]}")
        else:
            typer.echo(
                f"   ✗ {gateway_url} - unhealthy (status {response.status_code})"
            )
            all_healthy = False
    except requests.exceptions.ConnectionError:
        typer.echo(f"   ✗ {gateway_url} - connection refused")
        all_healthy = False
    except requests.exceptions.Timeout:
        typer.echo(f"   ✗ {gateway_url} - timeout")
        all_healthy = False
    except Exception as e:
        typer.echo(f"   ✗ {gateway_url} - error: {e}")
        all_healthy = False

    # Check Orchestrator
    typer.echo("\n🎭 Orchestrator:")
    try:
        response = requests.get(f"{orchestrator_url}/healthz", timeout=5)
        if response.status_code == 200:
            typer.echo(f"   ✓ {orchestrator_url} - healthy")
            if verbose:
                typer.echo(f"     Response: {response.text[:100]}")
        else:
            typer.echo(
                f"   ✗ {orchestrator_url} - unhealthy (status {response.status_code})"
            )
            all_healthy = False
    except requests.exceptions.ConnectionError:
        typer.echo(f"   ✗ {orchestrator_url} - connection refused")
        all_healthy = False
    except requests.exceptions.Timeout:
        typer.echo(f"   ✗ {orchestrator_url} - timeout")
        all_healthy = False
    except Exception as e:
        typer.echo(f"   ✗ {orchestrator_url} - error: {e}")
        all_healthy = False

    # Check Redis
    typer.echo("\n🔴 Redis:")
    try:
        host, port = redis_url.split(":")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, int(port)))
        sock.close()
        if result == 0:
            typer.echo(f"   ✓ {redis_url} - port open")
        else:
            typer.echo(f"   ✗ {redis_url} - port closed")
            all_healthy = False
    except Exception as e:
        typer.echo(f"   ✗ {redis_url} - error: {e}")
        all_healthy = False

    # Summary
    typer.echo("\n" + "=" * 40)
    if all_healthy:
        typer.echo("✅ All services are healthy!")
    else:
        typer.echo("❌ Some services are unhealthy")
        typer.echo("\n💡 Troubleshooting tips:")
        typer.echo("   • Start services: make up")
        typer.echo("   • Check logs: make logs")
        typer.echo("   • View status: make status")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
