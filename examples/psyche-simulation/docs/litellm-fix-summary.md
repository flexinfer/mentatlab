# LiteLLM Integration Fix Summary

## Root Causes Identified:

### 1. Service Selector Issue
The `ollama-cluster` service is selecting ALL Ollama deployments instead of just `ollama-7900xtx`:
- Current selector: `app.kubernetes.io/name: ollama` (matches all)
- Fixed selector: `app.kubernetes.io/instance: ollama-7900xtx` AND `app.kubernetes.io/name: ollama`
- This causes load balancing to `ollama-embed` which may not have the required models

### 2. LiteLLM ConfigMap Issues
The current ConfigMap has incorrect settings:
- Using `model_type: openai` instead of `custom_llm_provider: ollama`
- API base has `/v1` suffix (OpenAI style) instead of plain Ollama endpoint
- Model prefix is `openai/` instead of `ollama/`

## Actions Required:

1. **Apply the comprehensive fix**:
   ```bash
   kubectl apply -f litellm-comprehensive-fix.yaml
   ```

2. **Restart LiteLLM deployment** to pick up ConfigMap changes:
   ```bash
   kubectl rollout restart deployment/litellm -n litellm
   ```

3. **Verify the fix**:
   - Check service endpoints: `kubectl get endpoints ollama-cluster -n ai`
   - Test LiteLLM API: `curl http://litellm.flexinfer.ai/v1/models`

## Expected Results:
- ollama-cluster service should only route to ollama-7900xtx pod
- LiteLLM should properly communicate with Ollama using correct API format
- No more 404 or 429 errors when accessing deepseek-r1:8b model