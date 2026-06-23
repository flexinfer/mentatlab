import { createAgent, emitProgress } from "@mentatlab/agent-sdk";

const agent = createAgent({
  agentId: "{{AGENT_ID}}",
  version: "{{VERSION}}",
  async onInput(spec, context, runtime) {
    const input = (spec.prompt as string) ?? "";
    emitProgress({ percent: 50, message: "Processing input" });

    return {
      output: `Processed: ${input}`,
      executionId: runtime.executionId ?? context.execution_id ?? null,
    };
  },
});

agent.run().then((code) => process.exit(code));
