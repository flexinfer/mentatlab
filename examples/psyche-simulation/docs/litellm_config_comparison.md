# LiteLLM Configuration Comparison

## Current ConfigMap (Broken)
```yaml
model_list:
- litellm_params:
    api_base: http://ollama-cluster.ai.svc.cluster.local:11434/v1  # ❌ Has /v1 suffix
    api_key: dummy
    keep_alive: 300
    model: openai/deepseek-r1:8b  # ❌ Using openai/ prefix
    model_type: openai  # ❌ Wrong model type
    num_batch: 512
    num_ctx: 8192
    num_gpu: 999
    num_thread: 8
    stream: true
  model_info:
    max_input_tokens: 8192
    max_output_tokens: 2000
  model_name: deepseek-r1:8b
```

## Fixed ConfigMap
```yaml
model_list:
- litellm_params:
    api_base: http://ollama-cluster.ai.svc.cluster.local:11434  # ✅ No /v1 suffix
    api_key: ""
    custom_llm_provider: ollama  # ✅ Correct provider
    keep_alive: 300
    model: ollama/deepseek-r1:8b  # ✅ Using ollama/ prefix
    num_batch: 512
    num_ctx: 8192
    num_gpu: 999
    num_thread: 8
    stream: true
  model_info:
    max_input_tokens: 8192
    max_output_tokens: 2000
  model_name: deepseek-r1:8b
```

## Key Differences:
1. **API Base URL**: Current has `/v1` suffix which causes 404 errors with Ollama
2. **Model Provider**: Current uses `model_type: openai`, fixed uses `custom_llm_provider: ollama`
3. **Model Name**: Current uses `openai/deepseek-r1:8b`, fixed uses `ollama/deepseek-r1:8b`
4. **API Key**: Current uses "dummy", fixed uses empty string

## Why This Matters:
The error logs show:
- 404 Error: model "deepseek-r1:8b" not found
- This happens because LiteLLM is trying to use OpenAI-style API calls to Ollama
- The `/v1` suffix and `openai/` prefix are causing the mismatch

## Verification Needed:
Before applying, we should check if the deepseek-r1:8b model actually exists on the Ollama cluster.