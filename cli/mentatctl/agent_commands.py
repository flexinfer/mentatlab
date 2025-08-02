#!/usr/bin/env python3
"""
Agent-specific commands for mentatctl CLI
Implements agent lifecycle management as specified in Sprint 5
"""

import typer
import json
import yaml
import requests
import subprocess
import shutil
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

# Agent commands group
agent = typer.Typer(
    name="agent",
    help="Agent lifecycle management commands",
    no_args_is_help=True
)

@agent.command("create")
def create_agent(
    name: str = typer.Argument(..., help="Agent name (will be used as directory name)"),
    template: Literal["python", "nodejs", "rust"] = typer.Option("python", "--template", help="Agent template to use"),
    directory: Optional[Path] = typer.Option(None, "--dir", help="Directory to create agent in (default: current directory)"),
    id_prefix: Optional[str] = typer.Option(None, "--id", help="Custom agent ID prefix (default: uses name)")
):
    """Scaffold a new agent from template"""
    try:
        # Determine target directory
        if directory:
            target_dir = directory / name
        else:
            target_dir = Path.cwd() / name
            
        if target_dir.exists():
            typer.echo(f"❌ Error: Directory '{target_dir}' already exists", err=True)
            raise typer.Exit(code=1)
            
        # Create agent ID
        agent_id = id_prefix or f"dev.{name}"
        
        typer.echo(f"🏗️  Creating new {template} agent: {name}")
        typer.echo(f"📁 Directory: {target_dir}")
        typer.echo(f"🆔 Agent ID: {agent_id}")
        
        # Create directory structure
        target_dir.mkdir(parents=True, exist_ok=True)
        src_dir = target_dir / "src"
        src_dir.mkdir(exist_ok=True)
        
        # Get template directory
        template_dir = Path(__file__).parent / "templates" / template
        if not template_dir.exists():
            typer.echo(f"❌ Error: Template '{template}' not found at {template_dir}", err=True)
            raise typer.Exit(code=1)
            
        # Copy template files
        for template_file in template_dir.rglob("*"):
            if template_file.is_file():
                relative_path = template_file.relative_to(template_dir)
                target_file = target_dir / relative_path
                target_file.parent.mkdir(parents=True, exist_ok=True)
                
                # Read template and substitute variables
                content = template_file.read_text()
                content = content.replace("{{AGENT_NAME}}", name)
                content = content.replace("{{AGENT_ID}}", agent_id)
                content = content.replace("{{VERSION}}", "0.1.0")
                content = content.replace("{{DESCRIPTION}}", f"A {template} agent that processes inputs")
                
                target_file.write_text(content)
                
        typer.echo(f"✅ Agent '{name}' created successfully!")
        typer.echo(f"📝 Next steps:")
        typer.echo(f"   1. cd {target_dir}")
        typer.echo(f"   2. Edit manifest.yaml and src/ files")
        typer.echo(f"   3. Test with: mentatctl dev run manifest.yaml")
        typer.echo(f"   4. Build with: mentatctl agent push .")
        
    except Exception as e:
        typer.echo(f"❌ Error creating agent: {e}", err=True)
        raise typer.Exit(code=1)

@agent.command("validate")
def validate_agent(
    manifest_file: Path = typer.Argument(..., help="Path to agent manifest.yaml file"),
    orchestrator_url: str = typer.Option("http://localhost:8001", "--orchestrator-url", help="Orchestrator service URL"),
    mode: Optional[str] = typer.Option(None, "--mode", help="Validation mode (strict, permissive, disabled)")
):
    """Validate an agent manifest against the schema"""
    try:
        if not manifest_file.exists():
            typer.echo(f"❌ Error: Manifest file not found at {manifest_file}", err=True)
            raise typer.Exit(code=1)
            
        # Read manifest
        try:
            with open(manifest_file, 'r') as f:
                manifest_data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            typer.echo(f"❌ Error: Invalid YAML in manifest file: {e}", err=True)
            raise typer.Exit(code=1)
            
        typer.echo(f"🔍 Validating agent manifest: {manifest_file}")
        typer.echo(f"🆔 Agent: {manifest_data.get('id', 'unknown')} v{manifest_data.get('version', '?')}")
        
        # Send to orchestrator for validation
        try:
            validation_request = {'agent_manifest': manifest_data}
            if mode:
                validation_request['validation_mode'] = mode
                
            response = requests.post(f"{orchestrator_url}/agents/validate", json=validation_request, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                
                if result.get('valid', False):
                    typer.echo(f"✅ Manifest validation passed!")
                    if result.get('warnings'):
                        typer.echo(f"⚠️  Warnings:")
                        for warning in result['warnings']:
                            typer.echo(f"   • {warning}")
                else:
                    typer.echo(f"❌ Manifest validation failed:")
                    for error in result.get('errors', []):
                        typer.echo(f"   • {error}")
                    raise typer.Exit(code=1)
                    
                typer.echo(f"🔧 Validation mode: {result.get('validation_mode', 'unknown')}")
                
            else:
                typer.echo(f"❌ Validation request failed: {response.text}", err=True)
                raise typer.Exit(code=1)
                
        except requests.RequestException as e:
            typer.echo(f"❌ Error connecting to orchestrator: {e}", err=True)
            raise typer.Exit(code=1)
            
    except Exception as e:
        typer.echo(f"❌ Error validating manifest: {e}", err=True)
        raise typer.Exit(code=1)

@agent.command("list")
def list_agents(
    search: Optional[str] = typer.Option(None, "--search", help="Search term to filter agents"),
    orchestrator_url: str = typer.Option("http://localhost:8001", "--orchestrator-url", help="Orchestrator service URL"),
    registry: Optional[str] = typer.Option(None, "--registry", help="Container registry to search")
):
    """List and discover available agents"""
    try:
        typer.echo("🔍 Discovering available agents...")
        
        if search:
            typer.echo(f"🔎 Search term: {search}")
            
        # Show local agents
        typer.echo("\n📁 Local Agents:")
        local_agents = []
        
        # Check common agent directories
        for agent_dir in [Path.cwd(), Path.cwd() / "agents", Path("services/agents")]:
            if agent_dir.exists():
                for manifest_path in agent_dir.rglob("manifest.yaml"):
                    try:
                        with open(manifest_path, 'r') as f:
                            manifest = yaml.safe_load(f)
                        
                        agent_id = manifest.get('id', 'unknown')
                        version = manifest.get('version', '?')
                        description = manifest.get('description', 'No description')
                        
                        if not search or search.lower() in agent_id.lower() or search.lower() in description.lower():
                            local_agents.append({
                                'id': agent_id,
                                'version': version,
                                'description': description,
                                'path': str(manifest_path.parent)
                            })
                    except Exception:
                        continue
        
        if local_agents:
            for agent in local_agents[:10]:  # Limit output
                typer.echo(f"   • {agent['id']} v{agent['version']}")
                typer.echo(f"     {agent['description']}")
                typer.echo(f"     📂 {agent['path']}")
                typer.echo()
        else:
            typer.echo("   No local agents found")
            
        # Mock registry results
        typer.echo("🌐 Registry Agents (sample):")
        sample_agents = [
            {"id": "flexinfer.echo", "version": "0.1.0", "description": "Echo agent for testing"},
            {"id": "flexinfer.openai-chat", "version": "1.2.0", "description": "OpenAI GPT chat integration"},
            {"id": "flexinfer.image-classifier", "version": "0.5.1", "description": "Image classification using ResNet"},
            {"id": "flexinfer.text-summarizer", "version": "1.0.0", "description": "Text summarization agent"},
        ]
        
        for agent in sample_agents:
            if not search or search.lower() in agent['id'].lower() or search.lower() in agent['description'].lower():
                typer.echo(f"   • {agent['id']} v{agent['version']}")
                typer.echo(f"     {agent['description']}")
                typer.echo(f"     🐳 Available in registry")
                typer.echo()
                
        typer.echo("💡 Use 'mentatctl agent create <name>' to scaffold a new agent")
        typer.echo("💡 Use 'mentatctl dev run <manifest>' to test an agent locally")
        
    except Exception as e:
        typer.echo(f"❌ Error listing agents: {e}", err=True)
        raise typer.Exit(code=1)

@agent.command("push")
def push_agent(
    agent_dir: Path = typer.Argument(..., help="Path to agent directory containing manifest.yaml and Dockerfile"),
    registry: str = typer.Option("harbor.lan", "--registry", help="Container registry to push to"),
    tag: Optional[str] = typer.Option(None, "--tag", help="Custom tag (default: uses version from manifest)"),
    build_only: bool = typer.Option(False, "--build-only", help="Only build, don't push to registry")
):
    """Build and push agent container to registry"""
    try:
        if not agent_dir.exists():
            typer.echo(f"❌ Error: Agent directory not found at {agent_dir}", err=True)
            raise typer.Exit(code=1)
            
        manifest_path = agent_dir / "manifest.yaml"
        dockerfile_path = agent_dir / "Dockerfile"
        
        if not manifest_path.exists():
            typer.echo(f"❌ Error: manifest.yaml not found in {agent_dir}", err=True)
            raise typer.Exit(code=1)
            
        if not dockerfile_path.exists():
            typer.echo(f"❌ Error: Dockerfile not found in {agent_dir}", err=True)
            raise typer.Exit(code=1)
            
        # Read manifest
        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)
        except yaml.YAMLError as e:
            typer.echo(f"❌ Error: Invalid YAML in manifest: {e}", err=True)
            raise typer.Exit(code=1)
            
        agent_id = manifest.get('id', 'unknown')
        version = manifest.get('version', 'latest')
        image_tag = tag or version
        
        # Construct image name
        image_name = f"{registry}/{agent_id}:{image_tag}"
        
        typer.echo(f"🏗️  Building agent container...")
        typer.echo(f"🆔 Agent: {agent_id}")
        typer.echo(f"📦 Image: {image_name}")
        
        # Check if Docker is available
        try:
            subprocess.run(["docker", "--version"], check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            typer.echo(f"❌ Error: Docker is not available. Please install Docker to build agents.", err=True)
            raise typer.Exit(code=1)
            
        # Build the image
        try:
            typer.echo("🔨 Running docker build...")
            result = subprocess.run([
                "docker", "build", 
                "-t", image_name,
                str(agent_dir)
            ], check=True, capture_output=True, text=True)
            
            typer.echo("✅ Build completed successfully!")
            
        except subprocess.CalledProcessError as e:
            typer.echo(f"❌ Docker build failed:", err=True)
            typer.echo(f"   stdout: {e.stdout}", err=True)
            typer.echo(f"   stderr: {e.stderr}", err=True)
            raise typer.Exit(code=1)
            
        if build_only:
            typer.echo(f"🏁 Build complete. Image tagged as: {image_name}")
            return
            
        # Push to registry
        try:
            typer.echo(f"🚀 Pushing to registry: {registry}")
            result = subprocess.run([
                "docker", "push", image_name
            ], check=True, capture_output=True, text=True)
            
            typer.echo("✅ Push completed successfully!")
            typer.echo(f"📦 Agent available at: {image_name}")
            
            # Update manifest with pushed image reference
            manifest['image'] = image_name
            with open(manifest_path, 'w') as f:
                yaml.dump(manifest, f, default_flow_style=False)
            typer.echo(f"📝 Updated manifest.yaml with image reference")
            
        except subprocess.CalledProcessError as e:
            typer.echo(f"❌ Docker push failed:", err=True)
            typer.echo(f"   stdout: {e.stdout}", err=True)
            typer.echo(f"   stderr: {e.stderr}", err=True)
            typer.echo(f"💡 You may need to: docker login {registry}")
            raise typer.Exit(code=1)
            
    except Exception as e:
        typer.echo(f"❌ Error pushing agent: {e}", err=True)
        raise typer.Exit(code=1)

if __name__ == "__main__":
    agent()