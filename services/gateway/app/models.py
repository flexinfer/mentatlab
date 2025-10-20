"""Pydantic models for agent and tool specifications."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Dict, Any, Literal

from pydantic import BaseModel, Field, HttpUrl, ConfigDict


class Pin(BaseModel):
    """Input/output pin description."""

    model_config = ConfigDict(extra="forbid")

    name: str
    type: Literal["string", "number", "boolean", "json", "binary"]


class UI(BaseModel):
    """UI configuration for the agent."""

    model_config = ConfigDict(extra="forbid")

    remoteEntry: HttpUrl


class Resources(BaseModel):
    """Resource requirements for the agent."""

    model_config = ConfigDict(extra="forbid")

    gpu: bool


class Agent(BaseModel):
    """Manifest describing an agent (Cog-Pak)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]+$")
    version: str = Field(pattern=r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$")
    image: str
    description: str
    inputs: List[Pin] = Field(default_factory=list)
    outputs: List[Pin] = Field(default_factory=list)
    runtime: Optional[str] = None
    longRunning: bool = False
    ui: Optional[UI] = None
    resources: Optional[Resources] = None
    env: Optional[List[str]] = None


class ToolSpec(BaseModel):
    """Lightweight tool interface."""

    model_config = ConfigDict(extra="forbid")

    id: str
    description: Optional[str] = None
    inputs: List[Pin] = Field(default_factory=list)
    outputs: List[Pin] = Field(default_factory=list)


class Position(BaseModel):
    """2D position coordinates."""

    model_config = ConfigDict(extra="forbid")

    x: float
    y: float


class Node(BaseModel):
    """A node in the flow graph."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    position: Position
    outputs: Optional[Dict[str, Any]] = None
    params: Optional[Dict[str, Any]] = None


class Edge(BaseModel):
    """An edge connecting two nodes in the flow graph."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_node: str = Field(alias="from", pattern=r"^[^.]+\.[^.]+$")
    to_node: str = Field(alias="to", pattern=r"^[^.]+\.[^.]+$")


class Meta(BaseModel):
    """Metadata for the flow."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    version: str
    createdAt: datetime
    description: Optional[str] = None
    createdBy: Optional[str] = None


class Graph(BaseModel):
    """The graph structure of the flow."""

    model_config = ConfigDict(extra="forbid")

    nodes: List[Node]
    edges: List[Edge]


class Layout(BaseModel):
    """Layout information for the flow UI."""

    model_config = ConfigDict(extra="forbid")

    zoom: Optional[float] = None
    viewport: Optional[Position] = None


class RunConfig(BaseModel):
    """Runtime configuration for the flow."""

    model_config = ConfigDict(extra="forbid")

    maxTokens: Optional[int] = None
    temperature: Optional[float] = None
    secrets: Optional[List[str]] = None


class Flow(BaseModel):
    """MentatLab Flow definition."""

    model_config = ConfigDict(extra="forbid")

    apiVersion: str = Field(pattern=r"^v1(alpha|beta)?\d*$")
    kind: Literal["Flow"] = "Flow"
    meta: Meta
    graph: Graph
    layout: Optional[Layout] = None
    runConfig: Optional[RunConfig] = None


def to_json_schema(model: BaseModel) -> Dict[str, Any]:
    """Return JSON Schema for the given Pydantic model class."""
    return model.model_json_schema()
