import { MentatAgent } from "@mentatlab/agent-sdk";

class {{AGENT_CLASS}} extends MentatAgent {
  constructor() {
    super("{{AGENT_ID}}", "{{VERSION}}");
  }

  protected async execute(
    spec: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // TODO: Implement your agent logic here
    const input = (spec.prompt as string) ?? "";

    return {
      output: `Processed: ${input}`,
    };
  }
}

const agent = new {{AGENT_CLASS}}();
agent.run().then((code) => process.exit(code));
