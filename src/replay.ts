import type { ToolCall, Trace } from "./types.js";
import { allCalls, callKey, stableStringify } from "./util.js";

export interface ReplayOptions {
  /**
   * When true, a call must match a recorded call with identical args.
   * When false (default), an unmatched call gets the next unused recording for that tool.
   */
  strict?: boolean;
}

/** Thrown when the agent makes a call the trace cannot answer. */
export class ReplayMissError extends Error {
  constructor(
    readonly tool: string,
    readonly args: unknown,
    reason: string,
  ) {
    super(`replay: no recorded output for ${tool}(${stableStringify(args)}): ${reason}`);
    this.name = "ReplayMissError";
  }
}

export type ReplayFn = (args: unknown) => Promise<unknown>;

export interface ReplayTools {
  /** One async function per recorded tool name. Plug these in as your tools' `execute`. */
  tools: Record<string, ReplayFn>;
  /** Call any tool by name (also works for names that were never recorded; those throw). */
  call(name: string, args: unknown): Promise<unknown>;
  /** Recorded calls that the replay has not used yet. */
  unused(): ToolCall[];
}

/**
 * Build mock tools that answer from a recorded trace, so an agent can be
 * re-run offline, deterministically and without tool side effects.
 * Recorded errors are re-thrown as `Error(message)`.
 *
 * Note: this replays tools only. The model is still called unless you also
 * stub it; see the README.
 */
export function createReplayTools(trace: Trace, options: ReplayOptions = {}): ReplayTools {
  const queues = new Map<string, { call: ToolCall; key: string; used: boolean }[]>();
  for (const call of allCalls(trace)) {
    const q = queues.get(call.name) ?? [];
    q.push({ call, key: callKey(call.name, call.args), used: false });
    queues.set(call.name, q);
  }

  async function call(name: string, args: unknown): Promise<unknown> {
    const q = queues.get(name);
    if (!q) throw new ReplayMissError(name, args, "tool never appears in the trace");
    const key = callKey(name, args);
    let entry = q.find((e) => !e.used && e.key === key);
    if (!entry) {
      if (options.strict) throw new ReplayMissError(name, args, "no unused recording with identical args (strict mode)");
      entry = q.find((e) => !e.used);
    }
    if (!entry) throw new ReplayMissError(name, args, "all recordings for this tool are used up");
    entry.used = true;
    if (entry.call.error !== undefined) throw new Error(entry.call.error);
    return structuredClone(entry.call.output);
  }

  const tools: Record<string, ReplayFn> = {};
  for (const name of queues.keys()) tools[name] = (args) => call(name, args);

  return {
    tools,
    call,
    unused: () => [...queues.values()].flat().filter((e) => !e.used).map((e) => e.call),
  };
}
