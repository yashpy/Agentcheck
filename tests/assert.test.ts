import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTrace } from "../src/assert.js";
import { makeTrace } from "./helpers.js";

const trace = makeTrace(
  [
    [{ name: "search", args: { q: "a" } }],
    [{ name: "fetch", args: { url: "1" } }, { name: "fetch", args: { url: "1" } }],
    [{ name: "answer", args: {}, error: "boom" }],
  ],
  0.01,
);

const rules = (r: Parameters<typeof checkTrace>[1]) => checkTrace(trace, r).failures.map((f) => f.rule);

test("passes when every rule holds", () => {
  const res = checkTrace(trace, {
    maxSteps: 3,
    maxToolCalls: 4,
    maxCostUsd: 0.05,
    mustCall: ["search"],
    mustNotCall: ["delete"],
    order: ["search", "answer"],
    maxRepeat: 2,
  });
  assert.deepEqual(res, { pass: true, failures: [] });
});

test("maxSteps / maxToolCalls / maxCostUsd", () => {
  assert.deepEqual(rules({ maxSteps: 2 }), ["maxSteps"]);
  assert.deepEqual(rules({ maxToolCalls: 3 }), ["maxToolCalls"]);
  assert.deepEqual(rules({ maxCostUsd: 0.02 }), ["maxCostUsd"]);
});

test("mustCall / mustNotCall", () => {
  assert.deepEqual(rules({ mustCall: ["search", "summarize"] }), ["mustCall"]);
  const res = checkTrace(trace, { mustNotCall: ["fetch"] });
  assert.match(res.failures[0]!.message, /called 2 time/);
});

test("order is a subsequence check", () => {
  assert.deepEqual(rules({ order: ["search", "fetch", "answer"] }), []);
  assert.deepEqual(rules({ order: ["fetch", "search"] }), ["order"]);
  assert.match(checkTrace(trace, { order: ["missing"] }).failures[0]!.message, /"missing" never appeared/);
  assert.match(checkTrace(trace, { order: ["answer", "search"] }).failures[0]!.message, /"search" did not appear after "answer"/);
});

test("maxRepeat flags identical name+args only", () => {
  assert.deepEqual(rules({ maxRepeat: 1 }), ["maxRepeat"]);
  const different = makeTrace([[{ name: "fetch", args: { url: "1" } }, { name: "fetch", args: { url: "2" } }]]);
  assert.equal(checkTrace(different, { maxRepeat: 1 }).pass, true);
});

test("noToolErrors", () => {
  const res = checkTrace(trace, { noToolErrors: true });
  assert.equal(res.pass, false);
  assert.match(res.failures[0]!.message, /step 2: "answer" failed: boom/);
});
