"""Pydantic models for agent and tool specifications."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field


@dataclass
class NodeIO:
    """Input/output pin description."""

    name: str
    type: str


class NodeIOModel(BaseModel):
    name: str
    type: str

    class Config:
        extra = "forbid"


class AgentSpec(BaseModel):
    """Manifest describing an agent (Cog-Pak)."""

    id: str
    version: str
    image: str
    runtime: str
    description: Optional[str] = None
    inputs: List[NodeIOModel] = Field(default_factory=list)
    outputs: List[NodeIOModel] = Field(default_factory=list)
    longRunning: bool = False
    ui: Optional[Dict[str, Any]] = None

    class Config:
        extra = "forbid"


class ToolSpec(BaseModel):
    """Lightweight tool interface."""

    id: str
    description: Optional[str] = None
    inputs: List[NodeIOModel] = Field(default_factory=list)
    outputs: List[NodeIOModel] = Field(default_factory=list)

    class Config:
        extra = "forbid"


def to_json_schema(model: BaseModel) -> Dict[str, Any]:
    """Return JSON Schema for the given Pydantic model class."""
    return model.model_json_schema()
