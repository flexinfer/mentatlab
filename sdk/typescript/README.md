# MentatLab TypeScript Agent SDK

Typed helpers for writing Node.js agents that speak the MentatLab NDJSON contract.

## Install

```bash
npm install @mentatlab/agent-sdk
```

Node.js 18 or newer is required.

## Factory API

```ts
import {
  createAgent,
  emitHeartbeat,
  emitOutput,
  emitProgress,
} from "@mentatlab/agent-sdk";

const agent = createAgent({
  agentId: "example.typescript",
  version: "0.1.0",
  async onInput(spec, context, runtime) {
    emitProgress({ percent: 25, message: "Starting work" });

    if (runtime.signal.aborted) {
      return { cancelled: true };
    }

    emitHeartbeat();
    emitOutput("result", { prompt: spec.prompt ?? null });

    return {
      output: `Processed: ${spec.prompt ?? ""}`,
      executionId: runtime.executionId ?? context.execution_id ?? null,
    };
  },
  onCancel() {
    emitOutput("cancelled", true);
  },
});

agent.run().then((code) => process.exit(code));
```

The runtime reads input from stdin first, then falls back to `AGENT_INPUT`, then to `INPUT_SPEC` and `INPUT_CONTEXT`.

## Event Helpers

- `emitEvent({ type, level, message, data })`
- `logInfo(message, data)`
- `logError(message, data)`
- `checkpoint(stage, progress, extra)`
- `emitOutput(key, value)`
- `emitError(code, message, { retryable, details })`
- `emitProgress({ percent, message, etaSeconds })`
- `emitProgress(current, total, { message })`
- `emitHeartbeat()`
- `setCorrelationId(id)`

## Build And Test

```bash
npm install
npm test
```
