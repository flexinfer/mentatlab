const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function runAgent(script, options = {}) {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: __dirname + "/..",
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...(options.env ?? {}) },
  });

  return {
    ...result,
    lines: result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test("createAgent reads stdin, emits typed events, and writes the result envelope", () => {
  const script = `
    const { createAgent, emitOutput, emitProgress } = require("./dist");
    const agent = createAgent({
      agentId: "test.agent",
      version: "1.2.3",
      onInput(spec, context, runtime) {
        emitProgress({ percent: spec.percent, message: "Halfway", etaSeconds: 3 });
        emitOutput("answer", { value: spec.value });
        return {
          ok: true,
          value: spec.value,
          runtimeAgent: runtime.agentId,
          executionId: runtime.executionId,
          contextExecutionId: context.execution_id,
        };
      },
    });
    agent.run().then((code) => process.exit(code));
  `;

  const result = runAgent(script, {
    input: JSON.stringify({
      spec: { value: "hello", percent: 55.55 },
      context: { execution_id: "exec-1" },
    }),
  });

  assert.equal(result.status, 0, result.stderr);

  const progress = result.lines.find((line) => line.type === "progress");
  assert.equal(progress.message, "Halfway");
  assert.equal(progress.correlation_id, "exec-1");
  assert.deepEqual(progress.data, {
    percent: 55.6,
    message: "Halfway",
    eta_seconds: 3,
  });

  const output = result.lines.find((line) => line.type === "output");
  assert.deepEqual(output.data, { key: "answer", value: { value: "hello" } });

  const envelope = result.lines.find((line) => line.result);
  assert.deepEqual(envelope.result, {
    ok: true,
    value: "hello",
    runtimeAgent: "test.agent",
    executionId: "exec-1",
    contextExecutionId: "exec-1",
  });
  assert.equal(envelope.mentat_meta.model, "test.agent/1.2.3");
});

test("createAgent reads AGENT_INPUT when stdin is empty", () => {
  const script = `
    const { createAgent } = require("./dist");
    createAgent({
      agentId: "env.agent",
      onInput(spec) {
        return { fromEnv: spec.value };
      },
    }).run().then((code) => process.exit(code));
  `;

  const result = runAgent(script, {
    env: {
      AGENT_INPUT: JSON.stringify({ spec: { value: 42 }, context: {} }),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const envelope = result.lines.find((line) => line.result);
  assert.equal(envelope.result.fromEnv, 42);
});

test("emitProgress supports current/total compatibility overload", () => {
  const script = `
    const { emitProgress } = require("./dist");
    emitProgress(2, 4, { message: "Two of four" });
  `;

  const result = runAgent(script);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.lines[0].data, {
    percent: 50,
    current: 2,
    total: 4,
    message: "Two of four",
  });
});
