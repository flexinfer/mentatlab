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
  emitError,
  setCorrelationId,
  type JsonObject,
} from "./emit";

export interface AgentInput {
  spec: JsonObject;
  context: JsonObject;
  execution_id?: string;
}

export interface MentatMeta {
  tokens_input: number;
  tokens_output: number;
  seconds: number;
  model: string;
}

export interface AgentOutput {
  result: JsonObject;
  mentat_meta: MentatMeta;
}

export interface AgentRuntime {
  agentId: string;
  version: string;
  signal: AbortSignal;
  executionId?: string;
}

export interface CreateAgentOptions {
  agentId: string;
  version?: string;
  onInput: (
    spec: JsonObject,
    context: JsonObject,
    runtime: AgentRuntime,
  ) => Promise<JsonObject> | JsonObject;
  onCancel?: (runtime: AgentRuntime) => Promise<void> | void;
}

export interface RunnableAgent {
  run(): Promise<number>;
}

export function createAgent(options: CreateAgentOptions): RunnableAgent {
  return new FunctionalMentatAgent(options);
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

      const contextExecID = typeof context.execution_id === "string" ? context.execution_id : undefined;
      const execId = incoming.execution_id ?? contextExecID;
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
          const parsed = JSON.parse(raw.trim());
          if (isObject(parsed)) {
            return normalizeInput(parsed);
          }
        } catch {
          // Fall through to env
        }
      }
    }

    // 2) Fallback to whole-input env var used by some launchers
    const agentInput = parseJSON(process.env.AGENT_INPUT ?? "");
    if (agentInput) {
      return normalizeInput(agentInput);
    }

    // 3) Fallback to split env vars
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
    spec: JsonObject,
    context: JsonObject,
  ): Promise<JsonObject> | JsonObject;

  /** Writes the final result to stdout in the standard format. */
  protected writeOutput(result: JsonObject): void {
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
    emitError("NO_INPUT", errMsg, { retryable: false });
    const output = this.makeOutputEnvelope({ error: errMsg }, this.startTime, Date.now());
    process.stdout.write(JSON.stringify(output) + "\n");
    return 1;
  }

  /** Standard error handling and reporting. */
  protected handleError(err: Error): number {
    logError(`${this.agentId}: internal error`, { exception: err.message });
    emitError("INTERNAL_ERROR", err.message, { retryable: false });
    const result: JsonObject = {
      error: "Internal agent error",
      exception: err.message,
    };
    if (err.stack) {
      result.stack = err.stack;
    }
    const output = this.makeOutputEnvelope(
      result,
      this.startTime,
      Date.now(),
    );
    process.stdout.write(JSON.stringify(output) + "\n");
    return 2;
  }

  /** Wraps result with standard mentat_meta block. */
  private makeOutputEnvelope(
    result: JsonObject,
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

class FunctionalMentatAgent extends MentatAgent {
  private readonly controller = new AbortController();
  private readonly onInput: CreateAgentOptions["onInput"];
  private readonly onCancel?: CreateAgentOptions["onCancel"];
  private executionId?: string;

  constructor(options: CreateAgentOptions) {
    super(options.agentId, options.version ?? "0.1.0");
    this.onInput = options.onInput;
    this.onCancel = options.onCancel;
  }

  override async run(): Promise<number> {
    const cleanup = this.installCancelHandlers();
    try {
      return await super.run();
    } finally {
      cleanup();
    }
  }

  protected override async execute(spec: JsonObject, context: JsonObject): Promise<JsonObject> {
    this.executionId = typeof context.execution_id === "string" ? context.execution_id : undefined;
    const runtime = this.runtime();
    if (runtime.signal.aborted) {
      return { cancelled: true };
    }
    return this.onInput(spec, context, runtime);
  }

  private runtime(): AgentRuntime {
    return {
      agentId: this.agentId,
      version: this.version,
      signal: this.controller.signal,
      executionId: this.executionId,
    };
  }

  private installCancelHandlers(): () => void {
    const cancel = async () => {
      if (!this.controller.signal.aborted) {
        this.controller.abort();
      }
      emitError("CANCELLED", "agent received cancellation signal", { retryable: false });
      if (this.onCancel) {
        await this.onCancel(this.runtime());
      }
    };
    const onSignal = () => {
      void cancel().finally(() => {
        process.exitCode = 130;
      });
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    return () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
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

function parseJSON(s: string): JsonObject | null {
  if (!s || !s.trim()) return null;
  try {
    const parsed = JSON.parse(s);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeInput(raw: JsonObject): AgentInput {
  return {
    spec: isObject(raw.spec) ? raw.spec : raw,
    context: isObject(raw.context) ? raw.context : {},
    execution_id: typeof raw.execution_id === "string" ? raw.execution_id : undefined,
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
