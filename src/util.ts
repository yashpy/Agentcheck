import { createHash } from "node:crypto";
import type { Pricing, Step, ToolCall, Trace, Usage } from "./types.js";

/** Keep in sync with package.json. */
export const VERSION = "0.1.0";

/**
 * JSON.stringify with object keys sorted at every level, so logically equal
 * values always produce the same string (and the same hash).
 * `undefined` object properties are dropped, as in JSON.stringify.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? "null";
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return normalize((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined && typeof v !== "function") out[key] = normalize(v);
  }
  return out;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Stable hash of any JSON-like value. */
export function hashValue(value: unknown): string {
  return sha256(stableStringify(value));
}

/** Key identifying a call by tool name and arguments. */
export function callKey(name: string, args: unknown): string {
  return `${name}:${hashValue(args ?? null)}`;
}

export function costOf(usage: Usage, pricing: Pricing): number {
  return (
    (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) /
    1_000_000
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return stableStringify(err);
}

/** Flat list of every tool call in a trace, in order. */
export function allCalls(trace: Trace): ToolCall[] {
  return trace.steps.flatMap((s) => s.toolCalls);
}

/** Recompute trace-level totals from its steps. */
export function finalizeTrace(
  steps: Step[],
  meta?: Record<string, unknown>,
  createdAt = new Date().toISOString(),
): Trace {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  for (const s of steps) {
    usage.inputTokens += s.usage?.inputTokens ?? 0;
    usage.outputTokens += s.usage?.outputTokens ?? 0;
    costUsd += s.costUsd ?? 0;
  }
  const trace: Trace = { version: 1, createdAt, steps, usage, costUsd: round(costUsd) };
  if (meta) trace.meta = meta;
  return trace;
}

/** Round to 10 decimal places to avoid float noise in stored JSON. */
export function round(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

/** Basic shape check for traces loaded from disk. Throws with a clear message. */
export function assertTrace(value: unknown, label = "trace"): Trace {
  const t = value as Partial<Trace> | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.steps)) {
    throw new Error(`${label}: not a trace (expected an object with a "steps" array)`);
  }
  t.steps.forEach((s, i) => {
    if (!s || !Array.isArray(s.toolCalls)) {
      throw new Error(`${label}: steps[${i}] has no "toolCalls" array`);
    }
    s.toolCalls.forEach((c, j) => {
      if (!c || typeof c.name !== "string") {
        throw new Error(`${label}: steps[${i}].toolCalls[${j}] has no string "name"`);
      }
    });
  });
  return {
    version: 1,
    createdAt: t.createdAt ?? "",
    steps: t.steps,
    usage: t.usage ?? { inputTokens: 0, outputTokens: 0 },
    costUsd: typeof t.costUsd === "number" ? t.costUsd : 0,
    ...(t.meta ? { meta: t.meta } : {}),
  };
}
