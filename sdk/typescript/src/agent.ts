/**
 * MentatAgent base class for TypeScript agents.
 *
 * Mirrors the Python agents/common/base.py Template Method pattern.
 * Provides standard input reading, output writing, and error handling.
 */

import {
  logInfo,
  logError,
  checkpoint,
  setCorrelationId,
} from "./emit";

export interface AgentInput {
  spec: Record<string, unknown>;
  context: Record<string, unknown>;
  execution_id?: string;
}

export interface MentatMeta {
  tokens_input: number;
  tokens_output: number;
  seconds: number;
  model: string;
}

export interface AgentOutput {
  result: Record<string, unknown>;
  mentat_meta: MentatMeta;
}

export abstract class MentatAgent {
  readonly agentId: string;
  readonly version: string;
  private startTime = 0;

  constructor(agentId: string, version = "0.1.0") {
    this.agentId = agentId;
    this.version = version;
  }

  /** Main entry point. Call from your script's top level. */
  async run(): Promise<number> {
    this.startTime = Date.now();
    try {
      this.setup();
      const incoming = await this.readInput();

      if (!incoming) {
        return this.handleNoInput();
      }

      const spec = incoming.spec ?? {};
      const context = incoming.context ?? {};

      const execId = incoming.execution_id ?? (context.execution_id as string);
      if (execId) setCorrelationId(execId);

      const result = await this.execute(spec, context);
      this.writeOutput(result);
      this.teardown();
      return 0;
    } catch (err) {
      return this.handleError(err as Error);
    }
  }

  /** Hook for initialization logic. */
  protected setup(): void {
    logInfo(`${this.agentId}: starting`);
    checkpoint("start", 0);
  }

  /** Reads agent input from stdin or environment variables. */
  protected async readInput(): Promise<AgentInput | null> {
    // 1) Try stdin
    if (!process.stdin.isTTY) {
      const raw = await readStdin();
      if (raw.trim()) {
        try {
          return JSON.parse(raw.trim()) as AgentInput;
        } catch {
          // Fall through to env
        }
      }
    }

    // 2) Fallback to env vars
    const specStr = process.env.INPUT_SPEC ?? "";
    const ctxStr = process.env.INPUT_CONTEXT ?? "";

    const spec = parseJSON(specStr);
    const ctx = parseJSON(ctxStr);

    if (spec || ctx) {
      const incoming: Partial<AgentInput> = {};
      if (spec) incoming.spec = spec;
      if (ctx) incoming.context = ctx;
      return incoming as AgentInput;
    }

    return null;
  }

  /** Core logic — subclasses must implement this. */
  protected abstract execute(
    spec: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;

  /** Writes the final result to stdout in the standard format. */
  protected writeOutput(result: Record<string, unknown>): void {
    const endTime = Date.now();
    const output = this.makeOutputEnvelope(result, this.startTime, endTime);

    process.stdout.write(JSON.stringify(output) + "\n");

    const seconds = (endTime - this.startTime) / 1000;
    logInfo(`${this.agentId}: completed`, { seconds: Math.round(seconds * 10000) / 10000 });
    checkpoint("end", 1.0);
  }

  /** Hook for cleanup logic. */
  protected teardown(): void {
    // Override in subclass if needed.
  }

  /** Handles cases where no input was received. */
  protected handleNoInput(): number {
    const errMsg = "No input received on stdin or environment variables.";
    logError(`${this.agentId}: ${errMsg}`);
    const output = this.makeOutputEnvelope({ error: errMsg }, this.startTime, Date.now());
    process.stdout.write(JSON.stringify(output) + "\n");
    return 1;
  }

  /** Standard error handling and reporting. */
  protected handleError(err: Error): number {
    logError(`${this.agentId}: internal error`, { exception: err.message });
    const output = this.makeOutputEnvelope(
      { error: "Internal agent error", exception: err.message, stack: err.stack },
      this.startTime,
      Date.now(),
    );
    process.stdout.write(JSON.stringify(output) + "\n");
    return 2;
  }

  /** Wraps result with standard mentat_meta block. */
  private makeOutputEnvelope(
    result: Record<string, unknown>,
    startMs: number,
    endMs: number,
  ): AgentOutput {
    return {
      result,
      mentat_meta: {
        tokens_input: 0,
        tokens_output: 0,
        seconds: Math.round((endMs - startMs) / 100) / 10,
        model: `${this.agentId}/${this.version}`,
      },
    };
  }
}

// --- helpers ---

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function parseJSON(s: string): Record<string, unknown> | null {
  if (!s || !s.trim()) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
