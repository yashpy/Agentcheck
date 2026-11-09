import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { VERSION } from "../util.js";
import { lintTools, type LintOptions, type LintReport, type ToolDef } from "./lint.js";
import { compareTools, verifyPin, type PinCheck, type PinFile } from "./pin.js";

export interface StdioServerOptions {
  command: string;
  args?: string[];
  /** Extra environment variables. Only a minimal safe set (PATH, HOME, …) is inherited otherwise. */
  env?: Record<string, string>;
  cwd?: string;
  /** Per-request timeout. Default 30 000 ms. */
  timeoutMs?: number;
  /** Safety cap on pagination. Default 100 pages. */
  maxPages?: number;
}

export interface FetchedTools {
  server?: { name: string; version: string };
  /** Tools from the second listing (what the client would use). */
  tools: ToolDef[];
  /** Tools from the first listing. */
  firstListing: ToolDef[];
  /** Differences between the two listings in the same session. */
  sessionDrift: PinCheck;
}

/**
 * Start an MCP server over stdio, list its tools (following pagination) twice,
 * then shut it down. The second listing catches servers that change their
 * tools mid-session.
 *
 * Security: this executes `command` with your user's permissions. Only scan
 * servers you would be willing to run.
 */
export async function fetchTools(options: StdioServerOptions): Promise<FetchedTools> {
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args ?? [],
    env: { ...getDefaultEnvironment(), ...options.env },
    ...(options.cwd ? { cwd: options.cwd } : {}),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  const client = new Client({ name: "agentcheck", version: VERSION }, { capabilities: {} });
  const timeout = options.timeoutMs ?? 30_000;
  const maxPages = options.maxPages ?? 100;

  const listAll = async (): Promise<ToolDef[]> => {
    const tools: ToolDef[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await client.listTools(cursor ? { cursor } : {}, { timeout });
      tools.push(...(res.tools as ToolDef[]));
      cursor = res.nextCursor;
      if (!cursor) return tools;
    }
    throw new Error(`tools/list did not finish after ${maxPages} pages`);
  };

  try {
    await client.connect(transport, { timeout });
    const firstListing = await listAll();
    const tools = await listAll();
    const info = client.getServerVersion();
    return {
      ...(info ? { server: { name: info.name, version: info.version } } : {}),
      tools,
      firstListing,
      sessionDrift: compareTools(firstListing, tools),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const tail = stderr.trim() ? `\nserver stderr:\n${stderr.trim()}` : "";
    throw new Error(`failed to scan "${[options.command, ...(options.args ?? [])].join(" ")}": ${msg}${tail}`, {
      cause: err,
    });
  } finally {
    await client.close().catch(() => {});
  }
}

export interface ScanOptions extends StdioServerOptions {
  /** Compare against a previously saved pin. */
  pin?: PinFile;
  lint?: LintOptions;
}

export interface ScanReport extends FetchedTools {
  lint: LintReport;
  pinCheck?: PinCheck;
  /** True when there are no high-severity findings, no session drift and the pin (if any) matches. */
  pass: boolean;
}

/** fetchTools + lintTools + optional pin verification. */
export async function scanMcpServer(options: ScanOptions): Promise<ScanReport> {
  const fetched = await fetchTools(options);
  const lint = lintTools(fetched.tools, options.lint);
  const pinCheck = options.pin ? verifyPin(options.pin, fetched.tools) : undefined;
  const pass =
    !lint.findings.some((f) => f.severity === "high") && fetched.sessionDrift.ok && (pinCheck?.ok ?? true);
  return { ...fetched, lint, ...(pinCheck ? { pinCheck } : {}), pass };
}
