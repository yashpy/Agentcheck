import type { Pricing, Step, ToolCall, Trace, Usage } from "./types.js";
import { costOf, errorMessage, finalizeTrace, round } from "./util.js";

export interface RecorderOptions {
  /** Used to compute cost from token usage. Without it, cost stays 0 unless set explicitly. */
  pricing?: Pricing;
  meta?: Record<string, unknown>;
}

/**
 * Records an agent run step by step.
 *
 * ```ts
 * const rec = new TraceRecorder({ pricing: { inputPerMillion: 3, outputPerMillion: 15 } });
 * rec.step();
 * const hits = await rec.recordCall("search", { q: "mcp" }, () => search("mcp"));
 * rec.addUsage({ inputTokens: 1200, outputTokens: 80 });
 * const trace = rec.toTrace();
 * ```
 */
export class TraceRecorder {
  private readonly steps: Step[] = [];
  private readonly pricing: Pricing | undefined;
  private readonly meta: Record<string, unknown> | undefined;
  private readonly now: () => number;

  constructor(options: RecorderOptions = {}, now: () => number = () => performance.now()) {
    this.pricing = options.pricing;
    this.meta = options.meta;
    this.now = now;
  }

  /** Start a new step and return its index. */
  step(text?: string): number {
    const index = this.steps.length;
    const step: Step = { index, toolCalls: [] };
    if (text !== undefined) step.text = text;
    this.steps.push(step);
    return index;
  }

  private current(): Step {
    const last = this.steps[this.steps.length - 1];
    if (last) return last;
    this.step();
    return this.steps[0]!;
  }

  /**
   * Run `fn` as the tool `name`, recording args, output or error, and duration.
   * Errors are recorded and then re-thrown so agent behavior is unchanged.
   */
  async recordCall<T>(name: string, args: unknown, fn: () => T | Promise<T>): Promise<T> {
    const call: ToolCall = { name, args };
    this.current().toolCalls.push(call);
    const start = this.now();
    try {
      const output = await fn();
      call.output = output;
      return output;
    } catch (err) {
      call.error = errorMessage(err);
      throw err;
    } finally {
      call.durationMs = round(this.now() - start);
    }
  }

  /** Add an already-finished call to the current step. */
  addCall(call: ToolCall): void {
    this.current().toolCalls.push(call);
  }

  /** Add token usage (and optionally an explicit cost) to the current step. */
  addUsage(usage: Usage, costUsd?: number): void {
    const step = this.current();
    const total = step.usage ?? { inputTokens: 0, outputTokens: 0 };
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    step.usage = total;
    const cost = costUsd ?? (this.pricing ? costOf(usage, this.pricing) : 0);
    step.costUsd = round((step.costUsd ?? 0) + cost);
  }

  toTrace(): Trace {
    return finalizeTrace(structuredClone(this.steps), this.meta);
  }
}

// ---------------------------------------------------------------------------
// Vercel AI SDK adapter
// ---------------------------------------------------------------------------

/** The subset of an AI SDK step that we read. Covers AI SDK v4 and v5+ field names. */
export interface AIStepLike {
  text?: string;
  toolCalls?: ReadonlyArray<{
    toolCallId?: string;
    toolName: string;
    /** v5+ */
    input?: unknown;
    /** v4 */
    args?: unknown;
  }>;
  toolResults?: ReadonlyArray<{
    toolCallId?: string;
    toolName?: string;
    /** v5+ */
    output?: unknown;
    /** v4 */
    result?: unknown;
  }>;
  /** v5+ puts tool errors here as `{ type: "tool-error" }` parts. */
  content?: ReadonlyArray<{ type?: string; toolCallId?: string; error?: unknown }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface FromAIStepsOptions {
  pricing?: Pricing;
  meta?: Record<string, unknown>;
}

/**
 * Convert the `.steps` of a Vercel AI SDK `generateText` result into a Trace.
 * Accepts both `args`/`result` (v4) and `input`/`output` (v5+) field names.
 */
export function fromAISteps(steps: ReadonlyArray<AIStepLike>, options: FromAIStepsOptions = {}): Trace {
  const out: Step[] = steps.map((s, index) => {
    const results = new Map<string, unknown>();
    for (const r of s.toolResults ?? []) {
      if (r.toolCallId !== undefined) results.set(r.toolCallId, "output" in r ? r.output : r.result);
    }
    const errors = new Map<string, string>();
    for (const part of s.content ?? []) {
      if (part.type === "tool-error" && part.toolCallId !== undefined) {
        errors.set(part.toolCallId, errorMessage(part.error));
      }
    }

    const toolCalls: ToolCall[] = (s.toolCalls ?? []).map((c, i) => {
      const call: ToolCall = { name: c.toolName, args: "input" in c ? c.input : c.args };
      if (c.toolCallId !== undefined) call.id = c.toolCallId;
      const id = c.toolCallId;
      if (id !== undefined && errors.has(id)) {
        call.error = errors.get(id)!;
      } else if (id !== undefined && results.has(id)) {
        call.output = results.get(id);
      } else if (id === undefined) {
        // No ids: fall back to matching results by position.
        const r = s.toolResults?.[i];
        if (r) call.output = "output" in r ? r.output : r.result;
      }
      return call;
    });

    const step: Step = { index, toolCalls };
    if (s.text) step.text = s.text;
    if (s.usage) {
      const usage: Usage = {
        inputTokens: s.usage.inputTokens ?? s.usage.promptTokens ?? 0,
        outputTokens: s.usage.outputTokens ?? s.usage.completionTokens ?? 0,
      };
      step.usage = usage;
      if (options.pricing) step.costUsd = round(costOf(usage, options.pricing));
    }
    return step;
  });
  return finalizeTrace(out, options.meta);
}
