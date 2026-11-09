#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkTrace, type TraceRules } from "./assert.js";
import { diffTraces } from "./diff.js";
import { lintTools, parseTools, type Finding, type LintReport } from "./mcp/lint.js";
import { assertPin, makePin, type PinCheck } from "./mcp/pin.js";
import { scanMcpServer } from "./mcp/scan.js";
import { VERSION, assertTrace } from "./util.js";

const HELP = `agentcheck ${VERSION}: regression tests for AI agents and security checks for MCP servers

Usage:
  agentcheck check <trace.json> [--max-steps N] [--max-tool-calls N] [--max-cost USD]
                   [--must-call a,b] [--must-not-call a,b] [--order a,b] [--max-repeat N]
                   [--no-tool-errors]
  agentcheck diff <base.json> <new.json> [--max-step-increase N] [--max-cost-increase-pct N]
                   [--allow-sequence-change]
  agentcheck mcp-lint <tools.json> [--min-score N] [--json]
  agentcheck mcp-scan [--pin file] [--write-pin file] [--min-score N] [--env KEY[=VALUE]]... [--json]
                   -- <command> [args...]

Exit codes: 0 = pass, 1 = check failed, 2 = usage or runtime error.
`;

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Environment used to resolve --env KEY without a value. */
  env: NodeJS.ProcessEnv;
}

class UsageError extends Error {}

type FlagType = "number" | "string" | "list" | "boolean" | "multi";
type FlagSpec = Record<string, FlagType>;
type FlagValues = Record<string, number | string | string[] | boolean | undefined>;

/** Minimal flag parser: supports `--flag value`, `--flag=value` and `--` to end flags. */
export function parseArgs(argv: string[], spec: FlagSpec): { positionals: string[]; flags: FlagValues; rest: string[] } {
  const positionals: string[] = [];
  const flags: FlagValues = {};
  let rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      rest = argv.slice(i + 1);
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const type = spec[name];
    if (!type) throw new UsageError(`unknown option --${name}`);
    if (type === "boolean") {
      if (eq !== -1) throw new UsageError(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    let value: string | undefined = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith("--"))) throw new UsageError(`--${name} needs a value`);
    if (type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got "${value}"`);
      flags[name] = n;
    } else if (type === "list") {
      flags[name] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (type === "multi") {
      flags[name] = [...((flags[name] as string[] | undefined) ?? []), value];
    } else {
      flags[name] = value;
    }
  }
  return { positionals, flags, rest };
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdCheck(argv: string[], io: CliIO): number {
  const { positionals, flags } = parseArgs(argv, {
    "max-steps": "number",
    "max-tool-calls": "number",
    "max-cost": "number",
    "must-call": "list",
    "must-not-call": "list",
    order: "list",
    "max-repeat": "number",
    "no-tool-errors": "boolean",
  });
  if (positionals.length !== 1) throw new UsageError("check needs exactly one <trace.json>");
  const file = positionals[0]!;
  const trace = assertTrace(readJson(file), file);
  const rules: TraceRules = {};
  const set = <K extends keyof TraceRules>(k: K, v: TraceRules[K] | undefined) => {
    if (v !== undefined) rules[k] = v;
  };
  set("maxSteps", num(flags["max-steps"]));
  set("maxToolCalls", num(flags["max-tool-calls"]));
  set("maxCostUsd", num(flags["max-cost"]));
  set("mustCall", list(flags["must-call"]));
  set("mustNotCall", list(flags["must-not-call"]));
  set("order", list(flags.order));
  set("maxRepeat", num(flags["max-repeat"]));
  if (flags["no-tool-errors"]) rules.noToolErrors = true;
  if (Object.keys(rules).length === 0) throw new UsageError("check needs at least one rule option");

  const res = checkTrace(trace, rules);
  const calls = trace.steps.reduce((n, s) => n + s.toolCalls.length, 0);
  io.out(`${file}: ${trace.steps.length} steps, ${calls} tool calls, $${trace.costUsd}`);
  if (res.pass) {
    io.out(`PASS (${Object.keys(rules).length} rule(s))`);
    return 0;
  }
  for (const f of res.failures) io.out(`  ✗ ${f.rule}: ${f.message}`);
  io.out(`FAIL (${res.failures.length} failure(s))`);
  return 1;
}

function cmdDiff(argv: string[], io: CliIO): number {
  const { positionals, flags } = parseArgs(argv, {
    "max-step-increase": "number",
    "max-cost-increase-pct": "number",
    "allow-sequence-change": "boolean",
  });
  if (positionals.length !== 2) throw new UsageError("diff needs <base.json> <new.json>");
  const [baseFile, newFile] = positionals as [string, string];
  const base = assertTrace(readJson(baseFile), baseFile);
  const cur = assertTrace(readJson(newFile), newFile);
  const d = diffTraces(base, cur, {
    ...(num(flags["max-step-increase"]) !== undefined ? { maxStepIncrease: num(flags["max-step-increase"])! } : {}),
    ...(num(flags["max-cost-increase-pct"]) !== undefined ? { maxCostIncreasePct: num(flags["max-cost-increase-pct"])! } : {}),
    ...(flags["allow-sequence-change"] ? { allowSequenceChange: true } : {}),
  });

  io.out(`steps: ${d.steps.baseline} → ${d.steps.current} (${d.steps.delta >= 0 ? "+" : ""}${d.steps.delta})`);
  const pct = d.cost.deltaPct === null ? "n/a" : `${d.cost.deltaPct >= 0 ? "+" : ""}${d.cost.deltaPct.toFixed(1)}%`;
  io.out(`cost:  $${d.cost.baseline} → $${d.cost.current} (${pct})`);
  if (d.sequence.changed) {
    io.out("tool sequence:");
    for (const op of d.sequence.ops) io.out(`  ${op.op === "same" ? " " : op.op === "added" ? "+" : "-"} ${op.name}`);
  } else {
    io.out("tool sequence: unchanged");
  }
  if (!d.regression) {
    io.out("PASS: no regression");
    return 0;
  }
  for (const r of d.reasons) io.out(`  ✗ ${r}`);
  io.out("FAIL: regression");
  return 1;
}

function formatFindings(findings: Finding[]): string[] {
  const order = { high: 0, medium: 1, low: 2 } as const;
  return [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity] || a.tool.localeCompare(b.tool))
    .map((f) => `  [${f.severity}] ${f.tool}: ${f.rule}: ${f.message}${f.location ? ` (${f.location})` : ""}`);
}

function lintFails(report: LintReport, minScore: number | undefined): string[] {
  const reasons: string[] = [];
  const high = report.findings.filter((f) => f.severity === "high").length;
  if (high > 0) reasons.push(`${high} high-severity finding(s)`);
  if (minScore !== undefined && report.score < minScore) reasons.push(`score ${report.score} is below --min-score ${minScore}`);
  return reasons;
}

function cmdMcpLint(argv: string[], io: CliIO): number {
  const { positionals, flags } = parseArgs(argv, { "min-score": "number", json: "boolean" });
  if (positionals.length !== 1) throw new UsageError("mcp-lint needs exactly one <tools.json>");
  const file = positionals[0]!;
  let tools;
  try {
    tools = parseTools(readJson(file));
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`${file}: ${(err as Error).message}`);
  }
  const report = lintTools(tools);
  const reasons = lintFails(report, num(flags["min-score"]));
  if (flags.json) {
    io.out(JSON.stringify({ ...report, pass: reasons.length === 0, failReasons: reasons }, null, 2));
    return reasons.length ? 1 : 0;
  }
  io.out(`${file}: ${report.toolCount} tools, score ${report.score}/100, ${report.findings.length} finding(s)`);
  for (const line of formatFindings(report.findings)) io.out(line);
  if (reasons.length === 0) {
    io.out("PASS");
    return 0;
  }
  io.out(`FAIL: ${reasons.join("; ")}`);
  return 1;
}

function pinLines(label: string, c: PinCheck): string[] {
  const lines: string[] = [];
  for (const n of c.changed) lines.push(`  ✗ ${label}: "${n}" changed`);
  for (const n of c.added) lines.push(`  ✗ ${label}: "${n}" added`);
  for (const n of c.removed) lines.push(`  ✗ ${label}: "${n}" removed`);
  return lines;
}

async function cmdMcpScan(argv: string[], io: CliIO): Promise<number> {
  const { positionals, flags, rest } = parseArgs(argv, {
    pin: "string",
    "write-pin": "string",
    "min-score": "number",
    env: "multi",
    json: "boolean",
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"; put the server command after --`);
  if (rest.length === 0) throw new UsageError("mcp-scan needs a server command after --, e.g. -- npx -y my-mcp-server");
  const [command, ...args] = rest as [string, ...string[]];

  const env: Record<string, string> = {};
  for (const entry of (flags.env as string[] | undefined) ?? []) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      const v = io.env[entry];
      if (v !== undefined) env[entry] = v;
    } else {
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }
  const pinPath = typeof flags.pin === "string" ? flags.pin : undefined;
  let pin;
  if (pinPath) {
    try {
      pin = assertPin(readJson(pinPath));
    } catch (err) {
      if (err instanceof UsageError) throw err;
      throw new UsageError(`${pinPath}: ${(err as Error).message}`);
    }
  }

  const report = await scanMcpServer({ command, args, env, ...(pin ? { pin } : {}) });
  const reasons = lintFails(report.lint, num(flags["min-score"]));
  if (!report.sessionDrift.ok) reasons.push("tools changed between two listings in the same session");
  if (report.pinCheck && !report.pinCheck.ok) reasons.push(`tools differ from pin ${pinPath}`);
  const pass = reasons.length === 0;

  const writePin = typeof flags["write-pin"] === "string" ? flags["write-pin"] : undefined;
  if (writePin) {
    writeFileSync(writePin, JSON.stringify(makePin(report.tools, rest.join(" ")), null, 2) + "\n");
  }

  if (flags.json) {
    io.out(JSON.stringify({ ...report, pass, failReasons: reasons }, null, 2));
    return pass ? 0 : 1;
  }
  const name = report.server ? `${report.server.name}@${report.server.version}` : rest.join(" ");
  io.out(`${name}: ${report.lint.toolCount} tools, score ${report.lint.score}/100, ${report.lint.findings.length} finding(s)`);
  for (const line of formatFindings(report.lint.findings)) io.out(line);
  for (const line of pinLines("in-session change", report.sessionDrift)) io.out(line);
  if (report.pinCheck) {
    if (report.pinCheck.ok) io.out(`pin ${pinPath}: all tools match`);
    for (const line of pinLines(`pin ${pinPath}`, report.pinCheck)) io.out(line);
  }
  if (writePin) io.out(`wrote pin for ${report.tools.length} tools to ${writePin}`);
  io.out(pass ? "PASS" : `FAIL: ${reasons.join("; ")}`);
  return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function main(argv: string[], io: CliIO): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case "check":
        return cmdCheck(rest, io);
      case "diff":
        return cmdDiff(rest, io);
      case "mcp-lint":
        return cmdMcpLint(rest, io);
      case "mcp-scan":
        return await cmdMcpScan(rest, io);
      case "--version":
      case "-v":
        io.out(VERSION);
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return cmd === undefined ? 2 : 0;
      default:
        throw new UsageError(`unknown command "${cmd}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`agentcheck: ${err.message}\nRun "agentcheck --help" for usage.`);
    } else {
      io.err(`agentcheck: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 2;
  }
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2), {
    out: (t) => process.stdout.write(t + "\n"),
    err: (t) => process.stderr.write(t + "\n"),
    env: process.env,
  }).then((code) => {
    process.exitCode = code;
  });
}
