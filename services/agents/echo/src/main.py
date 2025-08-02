#!/usr/bin/env python3
"""
Echo Agent - A simple agent that echoes back the input text.
Follows MentatLab roadmap standards with stdin/stdout JSON I/O model.
"""

import sys
import json
import time
from typing import Dict, Any


def process_request(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process the echo request by returning the input text as output.
    
    Args:
        input_data: Dictionary containing the input data
        
    Returns:
        Dictionary containing the output and metadata
    """
    start_time = time.time()
    
    # Extract input text
    input_text = input_data.get("text", "")
    
    # Echo processing (simply return the input)
    output_text = input_text
    
    # Calculate processing time
    processing_time = time.time() - start_time
    
    # Return response with mentat_meta for metrics collection
    return {
        "text": output_text,
        "mentat_meta": {
            "tokens_input": len(input_text.split()) if input_text else 0,
            "tokens_output": len(output_text.split()) if output_text else 0,
            "seconds": round(processing_time, 3),
            "model": "echo-agent"
        }
    }


def main():
    """
    Main function implementing stdin/stdout JSON I/O model.
    """
    try:
        # Read JSON input from stdin
        input_line = sys.stdin.read().strip()
        if not input_line:
            raise ValueError("No input received from stdin")
        
        input_data = json.loads(input_line)
        
        # Process the request
        output_data = process_request(input_data)
        
        # Write JSON output to stdout
        json.dump(output_data, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        
    except json.JSONDecodeError as e:
        error_response = {
            "error": f"Invalid JSON input: {str(e)}",
            "mentat_meta": {
                "tokens_input": None,
                "tokens_output": None,
                "seconds": None,
                "model": "echo-agent"
            }
        }
        json.dump(error_response, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        sys.exit(1)
        
    except Exception as e:
        error_response = {
            "error": f"Processing error: {str(e)}",
            "mentat_meta": {
                "tokens_input": None,
                "tokens_output": None,
                "seconds": None,
                "model": "echo-agent"
            }
        }
        json.dump(error_response, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()