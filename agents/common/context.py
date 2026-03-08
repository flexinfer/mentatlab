import os
import subprocess
import json
from typing import Dict, Any, List, Optional, Union

def loom_context_add(entries: List[Dict[str, Any]], session_id: Optional[str] = None) -> bool:
    """
    Add context entries to the active loom agent session.
    Automatically reads LOOM_SESSION_ID from the environment if not provided.
    
    Each entry in `entries` should follow the agent_context_add schema, e.g.:
    {
        "entry_type": "decision",
        "title": "Use JWT for auth",
        "content": "Chose JWT over session cookies because...",
        "tags": ["auth", "security"]
    }
    """
    sid = session_id or os.environ.get("LOOM_SESSION_ID")
    if not sid:
        return False
        
    args = {
        "session_id": sid,
        "entries": entries
    }
    
    return _call_loom_tool("agent_context__agent_context_add", args)

def loom_context_recall(query: str, session_id: Optional[str] = None, **kwargs) -> Union[Dict[str, Any], str, None]:
    """
    Look up context using agent_context_recall_enhanced.
    Automatically reads LOOM_SESSION_ID from the environment if not provided.
    
    Args:
        query: What you are trying to do (used for relevance)
        session_id: Optional Session ID to filter by
        **kwargs: Additional parameters like `file_context`, `symbol_context`, etc.
    """
    args = {
        "query": query,
    }
    sid = session_id or os.environ.get("LOOM_SESSION_ID")
    if sid:
        args["session_id"] = sid
        
    args.update(kwargs)
    
    return _call_loom_tool("agent_context__agent_context_recall_enhanced", args, return_result=True)

def _call_loom_tool(tool_name: str, args: Dict[str, Any], return_result: bool = False) -> Any:
    """
    Helper to execute loom CLI tools securely as a subprocess.
    """
    try:
        proc = subprocess.run(
            ["loom", "tools", "call", tool_name, "--json", "--args", json.dumps(args)],
            capture_output=True,
            text=True,
            check=False
        )
        if proc.returncode != 0:
            # We fail silently to not disrupt agent business logic if tracing is disconnected
            return None if return_result else False
            
        if not return_result:
            return True
            
        try:
            return json.loads(proc.stdout.strip())
        except json.JSONDecodeError:
            return proc.stdout.strip()
    except Exception:
        return None if return_result else False
