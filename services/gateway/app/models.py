"""Pydantic models for agent and tool specifications."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Dict, Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class Pin(BaseModel):
    """Input/output pin description."""

    name: str
    type: Literal["string", "number", "boolean", "json", "binary"]

    class Config:
        extra = "forbid"


class UI(BaseModel):
    """UI configuration for the agent."""

    remoteEntry: HttpUrl

    class Config:
        extra = "forbid"


class Resources(BaseModel):
    """Resource requirements for the agent."""

    gpu: bool

    class Config:
        extra = "forbid"


class Agent(BaseModel):
    """Manifest describing an agent (Cog-Pak)."""

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

    class Config:
        extra = "forbid"


class ToolSpec(BaseModel):
    """Lightweight tool interface."""

    id: str
    description: Optional[str] = None
    inputs: List[Pin] = Field(default_factory=list)
    outputs: List[Pin] = Field(default_factory=list)

    class Config:
        extra = "forbid"


class Position(BaseModel):
    """2D position coordinates."""

    x: float
    y: float

    class Config:
        extra = "forbid"


class Node(BaseModel):
    """A node in the flow graph."""

    id: str
    type: str
    position: Position
    outputs: Optional[Dict[str, Any]] = None
    params: Optional[Dict[str, Any]] = None

    class Config:
        extra = "forbid"


class Edge(BaseModel):
    """An edge connecting two nodes in the flow graph."""

    from_node: str = Field(alias="from", pattern=r"^[^.]+\.[^.]+$")
    to_node: str = Field(alias="to", pattern=r"^[^.]+\.[^.]+$")

    class Config:
        extra = "forbid"
        populate_by_name = True


class Meta(BaseModel):
    """Metadata for the flow."""

    id: str
    name: str
    version: str
    createdAt: datetime
    description: Optional[str] = None
    createdBy: Optional[str] = None

    class Config:
        extra = "forbid"


class Graph(BaseModel):
    """The graph structure of the flow."""

    nodes: List[Node]
    edges: List[Edge]

    class Config:
        extra = "forbid"


class Layout(BaseModel):
    """Layout information for the flow UI."""

    zoom: Optional[float] = None
    viewport: Optional[Position] = None

    class Config:
        extra = "forbid"


class RunConfig(BaseModel):
    """Runtime configuration for the flow."""

    maxTokens: Optional[int] = None
    temperature: Optional[float] = None
    secrets: Optional[List[str]] = None

    class Config:
        extra = "forbid"


class Flow(BaseModel):
    """MentatLab Flow definition."""

    apiVersion: str = Field(pattern=r"^v1(alpha|beta)?\d*$")
    kind: Literal["Flow"] = "Flow"
    meta: Meta
    graph: Graph
    layout: Optional[Layout] = None
    runConfig: Optional[RunConfig] = None

    class Config:
        extra = "forbid"


def to_json_schema(model: BaseModel) -> Dict[str, Any]:
    """Return JSON Schema for the given Pydantic model class."""
    return model.model_json_schema()
