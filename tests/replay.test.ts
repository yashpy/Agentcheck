import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplayMissError, createReplayTools } from "../src/replay.js";
import { makeTrace } from "./helpers.js";

const trace = makeTrace([
  [
    { name: "search", args: { q: "a" }, output: ["A"] },
    { name: "search", args: { q: "b" }, output: ["B"] },
  ],
  [{ name: "fetch", args: { url: "x" }, error: "404" }],
]);

test("matches by args hash regardless of call order or key order", async () => {
  const r = createReplayTools(trace);
  assert.deepEqual(await r.tools.search!({ q: "b" }), ["B"]);
  assert.deepEqual(await r.call("search", { q: "a" }), ["A"]);
  assert.equal(r.unused().length, 1);
});

test("non-strict falls back to the next unused recording", async () => {
  const r = createReplayTools(trace);
  assert.deepEqual(await r.call("search", { q: "zzz" }), ["A"]);
  assert.deepEqual(await r.call("search", { q: "a" }), ["B"], "the exact match was consumed by the fallback");
  await assert.rejects(r.call("search", { q: "a" }), ReplayMissError);
});

test("strict mode refuses unmatched args", async () => {
  const r = createReplayTools(trace, { strict: true });
  await assert.rejects(r.call("search", { q: "zzz" }), /strict mode/);
});

test("recorded errors are re-thrown; unknown tools throw ReplayMissError", async () => {
  const r = createReplayTools(trace);
  await assert.rejects(r.call("fetch", { url: "x" }), (e: Error) => e.message === "404" && !(e instanceof ReplayMissError));
  await assert.rejects(r.call("delete", {}), /never appears in the trace/);
});

test("returned outputs are copies, so callers cannot mutate the trace", async () => {
  const r = createReplayTools(trace);
  const out = (await r.call("search", { q: "a" })) as string[];
  out.push("mutated");
  assert.deepEqual(trace.steps[0]!.toolCalls[0]!.output, ["A"]);
});
