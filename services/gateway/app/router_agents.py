from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter()

class AgentDefinition(BaseModel):
    name: str
    type: str
    description: str

@router.get("/agents", response_model=List[AgentDefinition])
async def get_agents():
    return [
        {
            "name": "Echo Agent",
            "type": "flexinfer.echo",
            "description": "A simple agent that echoes its input."
        }
    ]

@router.get("/agents/{agent_type}/schema")
async def get_agent_schema(agent_type: str):
    if agent_type == "flexinfer.echo":
        return {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "title": "Input Text",
                    "default": "Default echo text"
                }
            },
            "required": ["text"]
        }
    else:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent type not found")