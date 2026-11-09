import type { Step, ToolCall, Trace } from "../src/types.js";
import { finalizeTrace } from "../src/util.js";

/** Build a trace from a compact description: one array of calls per step. */
export function makeTrace(steps: Array<Array<Partial<ToolCall> & { name: string }>>, costPerStep = 0): Trace {
  const out: Step[] = steps.map((calls, index) => ({
    index,
    toolCalls: calls.map((c) => ({ args: {}, ...c })),
    usage: { inputTokens: 100, outputTokens: 10 },
    costUsd: costPerStep,
  }));
  return finalizeTrace(out, undefined, "2026-01-01T00:00:00.000Z");
}
