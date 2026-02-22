#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import List, Optional, Dict, Any
from agents.common.base import MentatAgent

class EchoAgent(MentatAgent):
    def __init__(self):
        super().__init__(agent_id="echo", version="0.1.0")

    def process(self, spec: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Echoes back the input. If spec is a dict, returns it.
        Also includes CLI args for backward compatibility if any.
        """
        # Echo the spec payload
        result = {"spec": spec}

        # Include CLI args if present (legacy behavior)
        if len(sys.argv) > 1:
            result["args"] = sys.argv[1:]

        return result

if __name__ == "__main__":
    agent = EchoAgent()
    sys.exit(agent.run())
