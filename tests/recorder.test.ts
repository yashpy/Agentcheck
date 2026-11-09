import assert from "node:assert/strict";
import { test } from "node:test";
import { TraceRecorder, fromAISteps } from "../src/recorder.js";

test("TraceRecorder records calls, errors, durations, usage and cost", async () => {
  let t = 0;
  const rec = new TraceRecorder({ pricing: { inputPerMillion: 3, outputPerMillion: 15 } }, () => (t += 5));
  rec.step("thinking");
  const out = await rec.recordCall("search", { q: "mcp" }, () => ["hit"]);
  assert.deepEqual(out, ["hit"]);
  await assert.rejects(rec.recordCall("fetch", { url: "x" }, () => Promise.reject(new Error("404"))), /404/);
  rec.addUsage({ inputTokens: 1_000_000, outputTokens: 0 });
  rec.step();
  rec.addCall({ name: "answer", args: {} });
  rec.addUsage({ inputTokens: 0, outputTokens: 1_000_000 });

  const trace = rec.toTrace();
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0]!.text, "thinking");
  const [search, fetch] = trace.steps[0]!.toolCalls;
  assert.deepEqual(search!.output, ["hit"]);
  assert.equal(search!.durationMs, 5);
  assert.equal(fetch!.error, "404");
  assert.equal(fetch!.output, undefined);
  assert.equal(trace.steps[0]!.costUsd, 3);
  assert.equal(trace.costUsd, 18);
  assert.deepEqual(trace.usage, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
});

test("TraceRecorder creates a first step automatically and snapshots on toTrace", async () => {
  const rec = new TraceRecorder();
  await rec.recordCall("a", {}, () => 1);
  const first = rec.toTrace();
  rec.addCall({ name: "b", args: {} });
  assert.equal(first.steps[0]!.toolCalls.length, 1, "earlier trace must not change");
  assert.equal(rec.toTrace().steps[0]!.toolCalls.length, 2);
  assert.equal(first.costUsd, 0);
});

test("fromAISteps reads AI SDK v5+ steps (input/output, tool-error parts, inputTokens)", () => {
  const trace = fromAISteps(
    [
      {
        text: "",
        toolCalls: [
          { toolCallId: "1", toolName: "search", input: { q: "x" } },
          { toolCallId: "2", toolName: "fetch", input: { url: "u" } },
        ],
        toolResults: [{ toolCallId: "1", toolName: "search", output: { hits: 2 } }],
        content: [{ type: "tool-error", toolCallId: "2", error: new Error("timeout") }],
        usage: { inputTokens: 500_000, outputTokens: 100_000 },
      },
      { text: "done", toolCalls: [], toolResults: [], usage: { inputTokens: 500_000, outputTokens: 0 } },
    ],
    { pricing: { inputPerMillion: 2, outputPerMillion: 10 } },
  );
  const [search, fetch] = trace.steps[0]!.toolCalls;
  assert.deepEqual(search, { id: "1", name: "search", args: { q: "x" }, output: { hits: 2 } });
  assert.deepEqual(fetch, { id: "2", name: "fetch", args: { url: "u" }, error: "timeout" });
  assert.equal(trace.steps[1]!.text, "done");
  assert.equal(trace.steps[0]!.costUsd, 2);
  assert.equal(trace.costUsd, 3);
});

test("fromAISteps reads AI SDK v4 steps (args/result, promptTokens)", () => {
  const trace = fromAISteps([
    {
      toolCalls: [{ toolCallId: "a", toolName: "weather", args: { city: "Paris" } }],
      toolResults: [{ toolCallId: "a", toolName: "weather", result: "sunny" }],
      usage: { promptTokens: 10, completionTokens: 5 },
    },
  ]);
  assert.deepEqual(trace.steps[0]!.toolCalls[0], { id: "a", name: "weather", args: { city: "Paris" }, output: "sunny" });
  assert.deepEqual(trace.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(trace.costUsd, 0);
});

test("fromAISteps matches results by position when ids are missing", () => {
  const trace = fromAISteps([{ toolCalls: [{ toolName: "a", args: 1 }], toolResults: [{ result: 2 }] }]);
  assert.equal(trace.steps[0]!.toolCalls[0]!.output, 2);
});
