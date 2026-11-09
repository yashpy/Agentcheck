import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { makePin } from "../src/mcp/pin.js";
import { fetchTools, scanMcpServer } from "../src/mcp/scan.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = (env: Record<string, string> = {}) => ({
  command: process.execPath,
  args: ["--import", "tsx", "examples/bad-server.ts"],
  cwd: root,
  env,
  timeoutMs: 20_000,
});

test("fetchTools follows pagination and reports server info", { timeout: 30_000 }, async () => {
  const res = await fetchTools(server());
  assert.deepEqual(res.server, { name: "bad-server", version: "0.0.1" });
  assert.deepEqual(
    res.tools.map((t) => t.name),
    ["add", "run_command", "get_weather", "read_file", "echo"],
    "5 tools across 3 pages",
  );
  assert.equal(res.sessionDrift.ok, true);
});

test("scanMcpServer flags the poisoned tools", { timeout: 30_000 }, async () => {
  const report = await scanMcpServer(server());
  assert.equal(report.pass, false);
  const byTool = (name: string) => report.lint.findings.filter((f) => f.tool === name).map((f) => f.rule);
  assert.ok(byTool("add").includes("injection-pattern"));
  assert.ok(byTool("get_weather").includes("hidden-unicode"));
  assert.ok(byTool("run_command").includes("dangerous-no-annotations"));
  assert.ok(byTool("run_command").includes("unbounded-string-param"));
  assert.deepEqual(byTool("echo"), []);
});

test("detects a tool that changes within one session", { timeout: 30_000 }, async () => {
  const report = await scanMcpServer(server({ BAD_SERVER_RUGPULL: "1" }));
  assert.deepEqual(report.sessionDrift.changed, ["get_weather"]);
  assert.equal(report.pass, false);
});

test("detects a rug pull against a saved pin", { timeout: 60_000 }, async () => {
  const pin = makePin((await fetchTools(server())).tools);
  const same = await scanMcpServer({ ...server(), pin });
  assert.equal(same.pinCheck?.ok, true);
  const updated = await scanMcpServer({ ...server({ BAD_SERVER_VERSION: "2" }), pin });
  assert.deepEqual(updated.pinCheck, { ok: false, changed: ["echo"], added: ["send_email"], removed: ["read_file"] });
});

test("reports a clear error when the server cannot start", { timeout: 30_000 }, async () => {
  await assert.rejects(
    fetchTools({ command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"], timeoutMs: 5_000 }),
    /failed to scan[\s\S]*boom/,
  );
});
