#!/usr/bin/env python3
"""
{{AGENT_NAME}} Agent - {{DESCRIPTION}}
Follows MentatLab roadmap standards with stdin/stdout JSON I/O model.
"""

import sys
import json
import time
import logging
from typing import Dict, Any

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def process_request(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process the agent request.
    
    Args:
        input_data: Dictionary containing the input data
        
    Returns:
        Dictionary containing the output and metadata
    """
    start_time = time.time()
    
    # Extract input text
    input_text = input_data.get("text", "")
    
    # TODO: Implement your agent logic here
    # This is a basic template - replace with your actual processing
    result = f"Processed: {input_text}"
    
    # Calculate processing time
    processing_time = time.time() - start_time
    
    # Return response with mentat_meta for metrics collection
    return {
        "result": result,
        "mentat_meta": {
            "tokens_input": len(input_text.split()) if input_text else 0,
            "tokens_output": len(result.split()) if result else 0,
            "seconds": round(processing_time, 3),
            "model": "{{AGENT_ID}}"
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
        logger.info(f"Processing input: {input_data}")
        
        # Process the request
        output_data = process_request(input_data)
        
        # Write JSON output to stdout
        json.dump(output_data, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        
        logger.info("Processing completed successfully")
        
    except json.JSONDecodeError as e:
        error_response = {
            "error": f"Invalid JSON input: {str(e)}",
            "mentat_meta": {
                "tokens_input": None,
                "tokens_output": None,
                "seconds": None,
                "model": "{{AGENT_ID}}"
            }
        }
        json.dump(error_response, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        logger.error(f"JSON decode error: {e}")
        sys.exit(1)
        
    except Exception as e:
        error_response = {
            "error": f"Processing error: {str(e)}",
            "mentat_meta": {
                "tokens_input": None,
                "tokens_output": None,
                "seconds": None,
                "model": "{{AGENT_ID}}"
            }
        }
        json.dump(error_response, sys.stdout, separators=(',', ':'))
        sys.stdout.flush()
        logger.error(f"Processing error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()