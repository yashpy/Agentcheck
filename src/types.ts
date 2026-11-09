/** Token counts for one model call or a whole run. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Price per one million tokens, in USD. */
export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** One tool invocation made by the agent. */
export interface ToolCall {
  /** Provider or framework call id, if any. */
  id?: string;
  name: string;
  args: unknown;
  /** Present when the tool returned normally. */
  output?: unknown;
  /** Present when the tool threw or reported an error. */
  error?: string;
  durationMs?: number;
}

/** One agent step: usually one model call plus the tools it requested. */
export interface Step {
  index: number;
  toolCalls: ToolCall[];
  usage?: Usage;
  costUsd?: number;
  /** Model text produced in this step, if captured. */
  text?: string;
}

/** A full agent run. Stored as JSON and used as a test fixture or baseline. */
export interface Trace {
  version: 1;
  createdAt: string;
  meta?: Record<string, unknown>;
  steps: Step[];
  /** Totals across all steps. */
  usage: Usage;
  costUsd: number;
}
