# loom-mcp-executor

`loom-mcp-executor` is a MentatLab agent that executes a Loom MCP tool and returns the result for downstream nodes.

## Input Contract

The agent expects `tool_name` and optional `tool_args` under `spec`:

```json
{
  "spec": {
    "tool_name": "k8s_apps_k3s__k8s_get",
    "tool_args": {
      "kind": "pods",
      "namespace": "default"
    }
  }
}
```

## Runtime Settings

- `MCP_EXECUTOR_COMMAND` (default: `loom mcp call`)
- `MCP_EXECUTOR_TIMEOUT_SECONDS` (default: `30`)

The command is invoked as:

```text
<MCP_EXECUTOR_COMMAND> <tool_name> <tool_args-json>
```

The last non-empty stdout line is parsed as JSON and mapped to `result.tool_result`.
