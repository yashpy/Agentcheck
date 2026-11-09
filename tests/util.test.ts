import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTrace, callKey, hashValue, stableStringify } from "../src/util.js";

test("stableStringify sorts keys at every level and drops undefined", () => {
  const a = stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } });
  assert.equal(a, '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
});

test("hashValue ignores key order", () => {
  assert.equal(hashValue({ x: 1, y: [1, 2] }), hashValue({ y: [1, 2], x: 1 }));
  assert.notEqual(hashValue({ x: 1 }), hashValue({ x: 2 }));
});

test("callKey distinguishes name and args", () => {
  assert.equal(callKey("a", { q: 1 }), callKey("a", { q: 1 }));
  assert.notEqual(callKey("a", { q: 1 }), callKey("b", { q: 1 }));
  assert.equal(callKey("a", undefined), callKey("a", null));
});

test("assertTrace rejects malformed input with a clear message", () => {
  assert.throws(() => assertTrace({}), /"steps" array/);
  assert.throws(() => assertTrace({ steps: [{}] }), /steps\[0\] has no "toolCalls"/);
  assert.throws(() => assertTrace({ steps: [{ toolCalls: [{}] }] }), /toolCalls\[0\] has no string "name"/);
  const t = assertTrace({ steps: [] });
  assert.equal(t.costUsd, 0);
});
