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
app.add_command(agent, name="agent")
app.add_command(runs, name="runs")

# Development commands group
dev_app = typer.Typer(
    name="dev", help="Development commands for local testing", no_args_is_help=True
)
app.add_command(dev_app, name="dev")


@dev_app.command("run")
def dev_run(
    manifest_file: Path = typer.Argument(..., help="Path to agent manifest.yaml file"),
    input: List[str] = typer.Option([], "--input", "-i", help="Input key=value pairs"),
    follow: bool = typer.Option(False, "--follow", help="Follow execution logs"),
    local: bool = typer.Option(
        False, "--local", help="Run locally instead of K8s cluster"
    ),
    orchestrator_url: str = typer.Option(
        "http://localhost:8001", "--orchestrator-url", help="Orchestrator service URL"
    ),
):
    """Execute an agent locally or against K8s cluster for development testing"""
    try:
        if not manifest_file.exists():
            typer.echo(
                f"❌ Error: Manifest file not found at {manifest_file}", err=True
            )
            raise typer.Exit(code=1)

        with open(manifest_file, "r") as f:
            try:
                manifest_data = yaml.safe_load(f)
            except yaml.YAMLError as e:
                typer.echo(f"❌ Error: Invalid YAML in manifest file: {e}", err=True)
                raise typer.Exit(code=1)

        # Parse input parameters
        inputs = {}
        for inp in input:
            if "=" in inp:
                key, value = inp.split("=", 1)
                inputs[key] = value
            else:
                typer.echo(
                    f"⚠️  Warning: Ignoring invalid input format '{inp}' (expected key=value)",
                    err=True,
                )

        # Prepare execution request
        execution_data = {
            "agent_manifest": manifest_data,
            "inputs": inputs,
            "execution_id": f"dev-{manifest_data.get('id', 'unknown')}",
        }

        typer.echo(f"🚀 Starting agent execution ({'local' if local else 'K8s'})...")
        typer.echo(
            f"📋 Agent: {manifest_data.get('id', 'unknown')} v{manifest_data.get('version', '?')}"
        )

        if inputs:
            typer.echo(f"📥 Inputs: {inputs}")

        # Submit for execution
        try:
            response = requests.post(
                f"{orchestrator_url}/agents/schedule", json=execution_data, timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                resource_id = result.get("resource_id")
                typer.echo(
                    f"✅ Agent scheduled successfully with resource ID: {resource_id}"
                )

                if follow and resource_id:
                    typer.echo("👀 Following execution logs...")
                    # Poll for status
                    import time

                    while True:
                        try:
                            status_response = requests.get(
                                f"{orchestrator_url}/jobs/{resource_id}/status",
                                timeout=10,
                            )
                            if status_response.status_code == 200:
                                status_data = status_response.json()
                                status = status_data.get("status", {}).get(
                                    "status", "unknown"
                                )
                                typer.echo(f"📊 Status: {status}")

                                if status in ["succeeded", "failed"]:
                                    break
                                elif status == "running":
                                    typer.echo("🔄 Agent is running...")

                            time.sleep(2)
                        except requests.RequestException as e:
                            typer.echo(f"⚠️  Warning: Could not check status: {e}")
                            break
                        except KeyboardInterrupt:
                            typer.echo("\n🛑 Stopped following logs")
                            break

            else:
                error_detail = response.text
                typer.echo(f"❌ Agent execution failed: {error_detail}", err=True)
                raise typer.Exit(code=1)

        except requests.RequestException as e:
            typer.echo(f"❌ Error connecting to orchestrator: {e}", err=True)
            raise typer.Exit(code=1)

    except Exception as e:
        typer.echo(f"❌ Error executing agent: {e}", err=True)
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
