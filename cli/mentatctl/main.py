#!/usr/bin/env python3

import typer
import json
import yaml
from pathlib import Path
from jsonschema import validate, ValidationError

app = typer.Typer()

def main(
    file_path: Path = typer.Argument(..., help="Path to the .mlab flow file (YAML or JSON).")
):
    """
    Validates a .mlab flow file against the flow schema.
    """
    """
    Validates a .mlab flow file against the flow schema.
    """
    if not file_path.exists():
        typer.echo(f"Error: File not found at {file_path}")
        raise typer.Exit(code=1)

    if file_path.suffix not in [".yaml", ".yml", ".json", ".mlab"]:
        typer.echo(f"Error: Unsupported file type. Please provide a .yaml, .yml, .json, or .mlab file.")
        raise typer.Exit(code=1)

    try:
        with open(file_path, "r") as f:
            if file_path.suffix in [".yaml", ".yml", ".mlab"]:
                flow_data = yaml.safe_load(f)
            else:
                flow_data = json.load(f)
    except (json.JSONDecodeError, yaml.YAMLError) as e:
        typer.echo(f"Error: Could not parse {file_path}. Invalid JSON or YAML format: {e}")
        raise typer.Exit(code=1)

    # Load the schema
    schema_path = Path(__file__).parent.parent.parent / "schemas" / "flow.schema.json"
    if not schema_path.exists():
        typer.echo(f"Error: Schema file not found at {schema_path}")
        raise typer.Exit(code=1)

    try:
        with open(schema_path, "r") as f:
            flow_schema = json.load(f)
    except json.JSONDecodeError as e:
        typer.echo(f"Error: Could not parse schema file. Invalid JSON format: {e}")
        raise typer.Exit(code=1)

    try:
        validate(instance=flow_data, schema=flow_schema)
        typer.echo(f"Validation successful for {file_path}!")
    except ValidationError as e:
        typer.echo(f"Validation failed for {file_path}:")
        typer.echo(f"  Error: {e.message}")
        if e.path:
            typer.echo(f"  Path: {' -> '.join(map(str, e.path))}")
        raise typer.Exit(code=1)

if __name__ == "__main__":
    typer.run(main)