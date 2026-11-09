export type { Pricing, Step, ToolCall, Trace, Usage } from "./types.js";
export { VERSION, assertTrace, callKey, hashValue, stableStringify } from "./util.js";

// Module 1: agent regression testing
export { TraceRecorder, fromAISteps } from "./recorder.js";
export type { AIStepLike, FromAIStepsOptions, RecorderOptions } from "./recorder.js";
export { checkTrace } from "./assert.js";
export type { CheckResult, TraceFailure, TraceRuleName, TraceRules } from "./assert.js";
export { ReplayMissError, createReplayTools } from "./replay.js";
export type { ReplayFn, ReplayOptions, ReplayTools } from "./replay.js";
export { diffTraces, lcsDiff } from "./diff.js";
export type { DiffTolerance, SeqOp, TraceDiff } from "./diff.js";

// Module 2: MCP server security
export { INJECTION_PATTERNS, SEVERITY_WEIGHT, decodeTagChars, lintTools, parseTools, score } from "./mcp/lint.js";
export type {
  Finding,
  JsonSchema,
  LintOptions,
  LintReport,
  LintRule,
  Severity,
  ToolAnnotations,
  ToolDef,
} from "./mcp/lint.js";
export { assertPin, compareTools, hashTool, makePin, verifyPin } from "./mcp/pin.js";
export type { PinCheck, PinFile } from "./mcp/pin.js";
export { fetchTools, scanMcpServer } from "./mcp/scan.js";
export type { FetchedTools, ScanOptions, ScanReport, StdioServerOptions } from "./mcp/scan.js";
