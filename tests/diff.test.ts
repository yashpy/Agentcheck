import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTraces, lcsDiff } from "../src/diff.js";
import { makeTrace } from "./helpers.js";

const base = makeTrace([[{ name: "search" }], [{ name: "fetch" }], [{ name: "answer" }]], 0.01);

test("identical traces have no regression", () => {
  const d = diffTraces(base, base);
  assert.equal(d.regression, false);
  assert.equal(d.sequence.changed, false);
  assert.equal(d.cost.deltaPct, 0);
});

test("sequence change is a regression unless allowed", () => {
  const cur = makeTrace([[{ name: "search" }], [{ name: "browse" }], [{ name: "answer" }]], 0.01);
  const d = diffTraces(base, cur);
  assert.equal(d.regression, true);
  assert.match(d.reasons[0]!, /removed fetch; added browse/);
  assert.deepEqual(
    d.sequence.ops.map((o) => `${o.op}:${o.name}`),
    ["same:search", "removed:fetch", "added:browse", "same:answer"],
  );
  assert.equal(diffTraces(base, cur, { allowSequenceChange: true }).regression, false);
});

test("step increase respects tolerance", () => {
  const cur = makeTrace([[{ name: "search" }, { name: "fetch" }], [], [], [{ name: "answer" }]], 0.0075);
  assert.match(diffTraces(base, cur).reasons.join(), /steps increased by 1/);
  assert.equal(diffTraces(base, cur, { maxStepIncrease: 1 }).regression, false);
});

test("cost increase respects tolerance and handles a zero baseline", () => {
  const cur = makeTrace([[{ name: "search" }], [{ name: "fetch" }], [{ name: "answer" }]], 0.012);
  const d = diffTraces(base, cur);
  assert.equal(d.cost.deltaPct, 20);
  assert.match(d.reasons[0]!, /cost increased 20.0%/);
  assert.equal(diffTraces(base, cur, { maxCostIncreasePct: 25 }).regression, false);

  const free = makeTrace([[{ name: "search" }], [{ name: "fetch" }], [{ name: "answer" }]], 0);
  const fromZero = diffTraces(free, base);
  assert.equal(fromZero.cost.deltaPct, null);
  assert.match(fromZero.reasons[0]!, /from \$0/);
  assert.equal(diffTraces(base, free).regression, false, "cheaper is fine");
});

test("lcsDiff handles empty inputs", () => {
  assert.deepEqual(lcsDiff([], []), []);
  assert.deepEqual(lcsDiff(["a"], []), [{ op: "removed", name: "a" }]);
  assert.deepEqual(lcsDiff([], ["a"]), [{ op: "added", name: "a" }]);
});
