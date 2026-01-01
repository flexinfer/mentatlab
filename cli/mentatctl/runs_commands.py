#!/usr/bin/env python3
"""
Run lifecycle management commands for mentatctl CLI.
Provides list, get, cancel, and watch functionality for orchestrator runs.
"""

import json
import sys
import time
from typing import Optional

import requests
import typer
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

# Create the runs command group
runs = typer.Typer(
    name="runs",
    help="Manage orchestrator runs - list, inspect, cancel, and watch",
    no_args_is_help=True,
)

console = Console()

DEFAULT_ORCHESTRATOR_URL = "http://localhost:7070"


def get_orchestrator_url() -> str:
    """Get orchestrator URL from env or default."""
    import os

    return os.environ.get("MENTAT_ORCHESTRATOR_URL", DEFAULT_ORCHESTRATOR_URL)


@runs.command("list")
def list_runs(
    orchestrator_url: str = typer.Option(
        None,
        "--url",
        "-u",
        help="Orchestrator URL (default: $MENTAT_ORCHESTRATOR_URL or localhost:7070)",
    ),
    status: Optional[str] = typer.Option(
        None,
        "--status",
        "-s",
        help="Filter by status (pending, running, completed, failed, cancelled)",
    ),
    limit: int = typer.Option(
        20, "--limit", "-n", help="Maximum number of runs to show"
    ),
    output: str = typer.Option(
        "table", "--output", "-o", help="Output format: table, json, yaml"
    ),
):
    """List all runs from the orchestrator."""
    url = orchestrator_url or get_orchestrator_url()

    try:
        params = {"limit": limit}
        if status:
            params["status"] = status

        response = requests.get(f"{url}/api/v1/runs", params=params, timeout=10)

        if response.status_code != 200:
            typer.echo(f"Error: Failed to list runs: {response.text}", err=True)
            raise typer.Exit(code=1)

        data = response.json()
        runs_list = data.get("runs", [])

        if output == "json":
            typer.echo(json.dumps(runs_list, indent=2))
            return
        elif output == "yaml":
            import yaml

            typer.echo(yaml.dump(runs_list, default_flow_style=False))
            return

        # Table output
        if not runs_list:
            typer.echo("No runs found.")
            return

        table = Table(title="Orchestrator Runs")
        table.add_column("ID", style="cyan", no_wrap=True)
        table.add_column("Status", style="magenta")
        table.add_column("Flow ID", style="green")
        table.add_column("Created", style="yellow")
        table.add_column("Updated", style="yellow")

        for run in runs_list:
            status_style = {
                "pending": "yellow",
                "running": "blue",
                "completed": "green",
                "failed": "red",
                "cancelled": "dim",
            }.get(run.get("status", ""), "white")

            table.add_row(
                run.get("id", "")[:12],
                f"[{status_style}]{run.get('status', 'unknown')}[/]",
                run.get("flow_id", "-")[:20] if run.get("flow_id") else "-",
                run.get("created_at", "-")[:19] if run.get("created_at") else "-",
                run.get("updated_at", "-")[:19] if run.get("updated_at") else "-",
            )

        console.print(table)
        console.print(f"\nTotal: {len(runs_list)} runs")

    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)


@runs.command("get")
def get_run(
    run_id: str = typer.Argument(..., help="Run ID to inspect"),
    orchestrator_url: str = typer.Option(None, "--url", "-u", help="Orchestrator URL"),
    output: str = typer.Option(
        "pretty", "--output", "-o", help="Output format: pretty, json, yaml"
    ),
):
    """Get detailed information about a specific run."""
    url = orchestrator_url or get_orchestrator_url()

    try:
        response = requests.get(f"{url}/api/v1/runs/{run_id}", timeout=10)

        if response.status_code == 404:
            typer.echo(f"Error: Run '{run_id}' not found", err=True)
            raise typer.Exit(code=1)

        if response.status_code != 200:
            typer.echo(f"Error: Failed to get run: {response.text}", err=True)
            raise typer.Exit(code=1)

        run = response.json()

        if output == "json":
            typer.echo(json.dumps(run, indent=2))
            return
        elif output == "yaml":
            import yaml

            typer.echo(yaml.dump(run, default_flow_style=False))
            return

        # Pretty output
        status = run.get("status", "unknown")
        status_color = {
            "pending": "yellow",
            "running": "blue",
            "completed": "green",
            "failed": "red",
            "cancelled": "dim",
        }.get(status, "white")

        console.print(
            Panel(
                f"[bold]Run ID:[/] {run.get('id', 'N/A')}\n"
                f"[bold]Status:[/] [{status_color}]{status}[/]\n"
                f"[bold]Flow ID:[/] {run.get('flow_id', 'N/A')}\n"
                f"[bold]Created:[/] {run.get('created_at', 'N/A')}\n"
                f"[bold]Updated:[/] {run.get('updated_at', 'N/A')}\n"
                f"[bold]Error:[/] {run.get('error', 'None')}",
                title="Run Details",
                border_style="cyan",
            )
        )

        # Show node statuses if available
        node_statuses = run.get("node_statuses", {})
        if node_statuses:
            console.print("\n[bold]Node Statuses:[/]")
            for node_id, node_status in node_statuses.items():
                ns = (
                    node_status
                    if isinstance(node_status, str)
                    else node_status.get("status", "unknown")
                )
                console.print(f"  • {node_id}: {ns}")

    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)


@runs.command("cancel")
def cancel_run(
    run_id: str = typer.Argument(..., help="Run ID to cancel"),
    orchestrator_url: str = typer.Option(None, "--url", "-u", help="Orchestrator URL"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation prompt"),
):
    """Cancel a running orchestrator run."""
    url = orchestrator_url or get_orchestrator_url()

    if not force:
        confirm = typer.confirm(f"Are you sure you want to cancel run '{run_id}'?")
        if not confirm:
            typer.echo("Cancelled.")
            return

    try:
        response = requests.post(f"{url}/api/v1/runs/{run_id}/cancel", timeout=10)

        if response.status_code == 404:
            typer.echo(f"Error: Run '{run_id}' not found", err=True)
            raise typer.Exit(code=1)

        if response.status_code not in [200, 204]:
            typer.echo(f"Error: Failed to cancel run: {response.text}", err=True)
            raise typer.Exit(code=1)

        typer.echo(f"Run '{run_id}' cancelled successfully.")

    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)


@runs.command("delete")
def delete_run(
    run_id: str = typer.Argument(..., help="Run ID to delete"),
    orchestrator_url: str = typer.Option(None, "--url", "-u", help="Orchestrator URL"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation prompt"),
):
    """Delete a run from the orchestrator."""
    url = orchestrator_url or get_orchestrator_url()

    if not force:
        confirm = typer.confirm(
            f"Are you sure you want to delete run '{run_id}'? This cannot be undone."
        )
        if not confirm:
            typer.echo("Cancelled.")
            return

    try:
        response = requests.delete(f"{url}/api/v1/runs/{run_id}", timeout=10)

        if response.status_code == 404:
            typer.echo(f"Error: Run '{run_id}' not found", err=True)
            raise typer.Exit(code=1)

        if response.status_code not in [200, 204]:
            typer.echo(f"Error: Failed to delete run: {response.text}", err=True)
            raise typer.Exit(code=1)

        typer.echo(f"Run '{run_id}' deleted successfully.")

    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)


@runs.command("watch")
def watch_run(
    run_id: str = typer.Argument(..., help="Run ID to watch"),
    orchestrator_url: str = typer.Option(None, "--url", "-u", help="Orchestrator URL"),
    timeout_seconds: int = typer.Option(
        300, "--timeout", "-t", help="Watch timeout in seconds"
    ),
):
    """Watch run events in real-time via SSE stream."""
    url = orchestrator_url or get_orchestrator_url()

    console.print(f"[bold]Watching run:[/] {run_id}")
    console.print(f"[dim]Streaming events from {url}/api/v1/runs/{run_id}/events[/]")
    console.print("[dim]Press Ctrl+C to stop watching[/]\n")

    try:
        # Use streaming response for SSE
        response = requests.get(
            f"{url}/api/v1/runs/{run_id}/events",
            stream=True,
            timeout=timeout_seconds,
            headers={"Accept": "text/event-stream"},
        )

        if response.status_code == 404:
            typer.echo(f"Error: Run '{run_id}' not found", err=True)
            raise typer.Exit(code=1)

        if response.status_code != 200:
            typer.echo(
                f"Error: Failed to start event stream: {response.text}", err=True
            )
            raise typer.Exit(code=1)

        event_count = 0
        for line in response.iter_lines():
            if not line:
                continue

            line_str = line.decode("utf-8")

            # Parse SSE format
            if line_str.startswith("data:"):
                data_str = line_str[5:].strip()
                if not data_str:
                    continue

                try:
                    event = json.loads(data_str)
                    event_count += 1

                    event_type = event.get("type", "unknown")
                    timestamp = (
                        event.get("timestamp", "")[:19]
                        if event.get("timestamp")
                        else ""
                    )

                    # Format based on event type
                    if event_type == "run:started":
                        console.print(f"[green]▶ Run started[/] [{timestamp}]")
                    elif event_type == "run:completed":
                        console.print(f"[green]✓ Run completed[/] [{timestamp}]")
                        break
                    elif event_type == "run:failed":
                        error = event.get("error", "Unknown error")
                        console.print(f"[red]✗ Run failed: {error}[/] [{timestamp}]")
                        break
                    elif event_type == "run:cancelled":
                        console.print(f"[yellow]⊘ Run cancelled[/] [{timestamp}]")
                        break
                    elif event_type == "node:started":
                        node_id = event.get("node_id", "unknown")
                        console.print(
                            f"[blue]  → Node started: {node_id}[/] [{timestamp}]"
                        )
                    elif event_type == "node:completed":
                        node_id = event.get("node_id", "unknown")
                        console.print(
                            f"[green]  ✓ Node completed: {node_id}[/] [{timestamp}]"
                        )
                    elif event_type == "node:failed":
                        node_id = event.get("node_id", "unknown")
                        error = event.get("error", "")
                        console.print(
                            f"[red]  ✗ Node failed: {node_id} - {error}[/] [{timestamp}]"
                        )
                    elif event_type == "log":
                        level = event.get("level", "info")
                        message = event.get("message", "")
                        level_style = {
                            "error": "red",
                            "warn": "yellow",
                            "info": "white",
                            "debug": "dim",
                        }.get(level, "white")
                        console.print(f"[{level_style}]  [{level}] {message}[/]")
                    else:
                        console.print(f"[dim]  {event_type}: {json.dumps(event)}[/]")

                except json.JSONDecodeError:
                    console.print(f"[dim]  Raw: {data_str}[/]")

        console.print(f"\n[dim]Received {event_count} events[/]")

    except requests.exceptions.Timeout:
        typer.echo(
            f"Timeout: No events received for {timeout_seconds} seconds", err=True
        )
        raise typer.Exit(code=1)
    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopped watching[/]")


@runs.command("create")
def create_run(
    flow_file: Optional[str] = typer.Argument(
        None, help="Path to flow file (YAML/JSON)"
    ),
    orchestrator_url: str = typer.Option(None, "--url", "-u", help="Orchestrator URL"),
    watch: bool = typer.Option(
        False, "--watch", "-w", help="Watch the run after creation"
    ),
    input_json: Optional[str] = typer.Option(
        None, "--input", "-i", help="Input JSON string"
    ),
):
    """Create and start a new run."""
    url = orchestrator_url or get_orchestrator_url()

    try:
        # Build run request
        run_request = {}

        if flow_file:
            from pathlib import Path
            import yaml

            flow_path = Path(flow_file)
            if not flow_path.exists():
                typer.echo(f"Error: Flow file not found: {flow_file}", err=True)
                raise typer.Exit(code=1)

            with open(flow_path) as f:
                if flow_path.suffix in [".yaml", ".yml"]:
                    flow_data = yaml.safe_load(f)
                else:
                    flow_data = json.load(f)
            run_request["flow"] = flow_data

        if input_json:
            run_request["inputs"] = json.loads(input_json)

        # Create the run
        response = requests.post(
            f"{url}/api/v1/runs",
            json=run_request,
            timeout=10,
        )

        if response.status_code not in [200, 201]:
            typer.echo(f"Error: Failed to create run: {response.text}", err=True)
            raise typer.Exit(code=1)

        result = response.json()
        run_id = result.get("id") or result.get("run_id")

        console.print(f"[green]✓ Run created:[/] {run_id}")

        if watch and run_id:
            console.print()
            watch_run(run_id=run_id, orchestrator_url=url)

    except json.JSONDecodeError as e:
        typer.echo(f"Error: Invalid JSON input: {e}", err=True)
        raise typer.Exit(code=1)
    except requests.RequestException as e:
        typer.echo(f"Error: Connection failed: {e}", err=True)
        raise typer.Exit(code=1)
