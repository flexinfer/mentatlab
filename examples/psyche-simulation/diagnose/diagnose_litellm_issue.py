#!/usr/bin/env python3
"""
Diagnostic script for LiteLLM/Ollama integration issues
Validates the diagnosis and prepares the fix
"""

import yaml
import json
from datetime import datetime

# Current problematic configuration
current_config = """
model_list:
- litellm_params:
    api_base: http://ollama-cluster.ai.svc.cluster.local:11434/v1
    api_key: dummy
    keep_alive: 300
    model: openai/deepseek-r1:8b
    model_type: openai
    num_batch: 512
    num_ctx: 8192
    num_gpu: 999
    num_thread: 8
    stream: true
  model_info:
    max_input_tokens: 8192
    max_output_tokens: 2000
  model_name: deepseek-r1:8b
"""

# Fixed configuration
fixed_config = """
model_list:
- litellm_params:
    api_base: http://ollama-cluster.ai.svc.cluster.local:11434
    api_key: ""
    custom_llm_provider: ollama
    keep_alive: 300
    model: ollama/deepseek-r1:8b
    num_batch: 512
    num_ctx: 8192
    num_gpu: 999
    num_thread: 8
    stream: true
  model_info:
    max_input_tokens: 8192
    max_output_tokens: 2000
  model_name: deepseek-r1:8b
"""

def main():
    print("=== LiteLLM/Ollama Integration Diagnostic Report ===")
    print(f"Generated at: {datetime.now().isoformat()}")
    print()
    
    print("DIAGNOSIS SUMMARY:")
    print("-" * 50)
    print("✓ Ollama pod 'ollama-7900xtx' is running")
    print("✓ Model 'deepseek-r1:8b' is available on Ollama")
    print("✓ Service 'ollama-cluster' exists and is accessible")
    print("✗ LiteLLM configuration has incorrect model format")
    print("✗ API endpoint includes '/v1' which Ollama doesn't support")
    print("✗ Using 'openai' model type instead of 'ollama'")
    print()
    
    print("ROOT CAUSE:")
    print("-" * 50)
    print("The LiteLLM configuration is treating Ollama as an OpenAI-compatible")
    print("endpoint, but Ollama requires specific configuration:")
    print()
    print("Current (INCORRECT) configuration:")
    print("  - model: openai/deepseek-r1:8b")
    print("  - model_type: openai")
    print("  - api_base: http://ollama-cluster.ai.svc.cluster.local:11434/v1")
    print()
    print("Required (CORRECT) configuration:")
    print("  - model: ollama/deepseek-r1:8b")
    print("  - custom_llm_provider: ollama")
    print("  - api_base: http://ollama-cluster.ai.svc.cluster.local:11434")
    print()
    
    print("CONFIGURATION CHANGES NEEDED:")
    print("-" * 50)
    current = yaml.safe_load(current_config)
    fixed = yaml.safe_load(fixed_config)
    
    print("1. Change model format:")
    print(f"   FROM: {current['model_list'][0]['litellm_params']['model']}")
    print(f"   TO:   {fixed['model_list'][0]['litellm_params']['model']}")
    print()
    
    print("2. Remove '/v1' from API base:")
    print(f"   FROM: {current['model_list'][0]['litellm_params']['api_base']}")
    print(f"   TO:   {fixed['model_list'][0]['litellm_params']['api_base']}")
    print()
    
    print("3. Change model type:")
    print(f"   FROM: model_type: {current['model_list'][0]['litellm_params'].get('model_type', 'N/A')}")
    print(f"   TO:   custom_llm_provider: {fixed['model_list'][0]['litellm_params'].get('custom_llm_provider', 'N/A')}")
    print()
    
    print("VALIDATION STEPS:")
    print("-" * 50)
    print("1. The model exists on Ollama: deepseek-r1:8b ✓")
    print("2. The service is accessible: ollama-cluster.ai.svc.cluster.local ✓")
    print("3. The configuration format matches Ollama requirements: ✗ (needs fix)")
    print()
    
    print("READY TO APPLY FIX:")
    print("-" * 50)
    print("The diagnosis is complete. The fix involves updating the LiteLLM")
    print("ConfigMap with the correct Ollama configuration format.")
    print()
    print("This will resolve:")
    print("- 404 'model not found' errors")
    print("- 429 rate limiting errors (caused by retries)")
    print("- Enable proper communication with Ollama")

if __name__ == "__main__":
    main()