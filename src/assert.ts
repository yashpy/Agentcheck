import type { Trace } from "./types.js";
import { allCalls, callKey } from "./util.js";

export interface TraceRules {
  /** Fail if the trace has more steps than this. */
  maxSteps?: number;
  /** Fail if the trace has more tool calls than this, across all steps. */
  maxToolCalls?: number;
  /** Fail if total cost exceeds this many USD. */
  maxCostUsd?: number;
  /** Every listed tool must be called at least once. */
  mustCall?: string[];
  /** None of the listed tools may be called. */
  mustNotCall?: string[];
  /** These tools must appear in this order (other calls may be interleaved). */
  order?: string[];
  /** Loop detection: fail if any identical call (same name and args) happens more than N times. */
  maxRepeat?: number;
  /** Fail if any tool call recorded an error. */
  noToolErrors?: boolean;
}

export type TraceRuleName = keyof TraceRules;

export interface TraceFailure {
  rule: TraceRuleName;
  message: string;
}

export interface CheckResult {
  pass: boolean;
  failures: TraceFailure[];
}

export function checkTrace(trace: Trace, rules: TraceRules): CheckResult {
  const failures: TraceFailure[] = [];
  const fail = (rule: TraceRuleName, message: string) => failures.push({ rule, message });
  const calls = allCalls(trace);
  const names = calls.map((c) => c.name);

  if (rules.maxSteps !== undefined && trace.steps.length > rules.maxSteps) {
    fail("maxSteps", `${trace.steps.length} steps, limit is ${rules.maxSteps}`);
  }
  if (rules.maxToolCalls !== undefined && calls.length > rules.maxToolCalls) {
    fail("maxToolCalls", `${calls.length} tool calls, limit is ${rules.maxToolCalls}`);
  }
  if (rules.maxCostUsd !== undefined && trace.costUsd > rules.maxCostUsd) {
    fail("maxCostUsd", `cost $${trace.costUsd.toFixed(6)}, limit is $${rules.maxCostUsd}`);
  }
  for (const name of rules.mustCall ?? []) {
    if (!names.includes(name)) fail("mustCall", `"${name}" was never called`);
  }
  for (const name of rules.mustNotCall ?? []) {
    const n = names.filter((x) => x === name).length;
    if (n > 0) fail("mustNotCall", `"${name}" was called ${n} time(s)`);
  }
  if (rules.order && rules.order.length > 0) {
    const matched = matchSubsequence(names, rules.order);
    if (matched < rules.order.length) {
      const where =
        matched === 0
          ? `"${rules.order[0]}" never appeared`
          : `"${rules.order[matched]}" did not appear after "${rules.order[matched - 1]}"`;
      fail(
        "order",
        `expected order ${rules.order.join(" → ")}: ${where}. Actual: ${names.join(" → ") || "(no calls)"}`,
      );
    }
  }
  if (rules.maxRepeat !== undefined) {
    const counts = new Map<string, { name: string; n: number }>();
    for (const c of calls) {
      const key = callKey(c.name, c.args);
      const entry = counts.get(key) ?? { name: c.name, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
    for (const { name, n } of counts.values()) {
      if (n > rules.maxRepeat) {
        fail("maxRepeat", `"${name}" was called ${n} times with identical args (limit ${rules.maxRepeat}); possible loop`);
      }
    }
  }
  if (rules.noToolErrors) {
    for (const [i, step] of trace.steps.entries()) {
      for (const c of step.toolCalls) {
        if (c.error !== undefined) fail("noToolErrors", `step ${i}: "${c.name}" failed: ${c.error}`);
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

/** How many items of `expected` appear in `actual` in order (greedy subsequence match). */
function matchSubsequence(actual: string[], expected: string[]): number {
  let j = 0;
  for (const name of actual) {
    if (j < expected.length && name === expected[j]) j++;
  }
  return j;
}
