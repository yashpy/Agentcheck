import type { Trace } from "./types.js";
import { allCalls, round } from "./util.js";

export interface DiffTolerance {
  /** Allowed increase in step count before it counts as a regression. Default 0. */
  maxStepIncrease?: number;
  /** Allowed cost increase in percent. Default 10. */
  maxCostIncreasePct?: number;
  /** When true, a changed tool sequence is reported but is not a regression. Default false. */
  allowSequenceChange?: boolean;
}

export type SeqOp = { op: "same" | "added" | "removed"; name: string };

export interface TraceDiff {
  regression: boolean;
  reasons: string[];
  sequence: {
    baseline: string[];
    current: string[];
    changed: boolean;
    /** Edit script from baseline to current (longest common subsequence). */
    ops: SeqOp[];
  };
  steps: { baseline: number; current: number; delta: number };
  cost: {
    baseline: number;
    current: number;
    /** Percent change; null when the baseline cost is 0. */
    deltaPct: number | null;
  };
}

export function diffTraces(baseline: Trace, current: Trace, tolerance: DiffTolerance = {}): TraceDiff {
  const maxStepIncrease = tolerance.maxStepIncrease ?? 0;
  const maxCostIncreasePct = tolerance.maxCostIncreasePct ?? 10;
  const reasons: string[] = [];

  const a = allCalls(baseline).map((c) => c.name);
  const b = allCalls(current).map((c) => c.name);
  const ops = lcsDiff(a, b);
  const changed = ops.some((o) => o.op !== "same");
  if (changed && !tolerance.allowSequenceChange) {
    const added = ops.filter((o) => o.op === "added").map((o) => o.name);
    const removed = ops.filter((o) => o.op === "removed").map((o) => o.name);
    const parts = [];
    if (removed.length) parts.push(`removed ${removed.join(", ")}`);
    if (added.length) parts.push(`added ${added.join(", ")}`);
    reasons.push(`tool sequence changed: ${parts.join("; ")}`);
  }

  const stepDelta = current.steps.length - baseline.steps.length;
  if (stepDelta > maxStepIncrease) {
    reasons.push(`steps increased by ${stepDelta} (${baseline.steps.length} → ${current.steps.length}), allowed ${maxStepIncrease}`);
  }

  let deltaPct: number | null = null;
  if (baseline.costUsd > 0) {
    deltaPct = round(((current.costUsd - baseline.costUsd) / baseline.costUsd) * 100);
    if (deltaPct > maxCostIncreasePct) {
      reasons.push(`cost increased ${deltaPct.toFixed(1)}% ($${baseline.costUsd} → $${current.costUsd}), allowed ${maxCostIncreasePct}%`);
    }
  } else if (current.costUsd > 0) {
    reasons.push(`cost increased from $0 to $${current.costUsd}`);
  }

  return {
    regression: reasons.length > 0,
    reasons,
    sequence: { baseline: a, current: b, changed, ops },
    steps: { baseline: baseline.steps.length, current: current.steps.length, delta: stepDelta },
    cost: { baseline: baseline.costUsd, current: current.costUsd, deltaPct },
  };
}

/** Line-diff style edit script between two name sequences. */
export function lcsDiff(a: string[], b: string[]): SeqOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: SeqOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: "same", name: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ op: "removed", name: a[i++]! });
    } else {
      ops.push({ op: "added", name: b[j++]! });
    }
  }
  while (i < n) ops.push({ op: "removed", name: a[i++]! });
  while (j < m) ops.push({ op: "added", name: b[j++]! });
  return ops;
}
