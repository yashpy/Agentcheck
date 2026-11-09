import { hashValue } from "../util.js";
import type { ToolDef } from "./lint.js";

/**
 * A pin records a hash of every tool's model-visible definition. Comparing a
 * later `tools/list` against it detects "rug pulls": a server that changes a
 * tool's description or schema after you approved it.
 */
export interface PinFile {
  version: 1;
  createdAt: string;
  server?: string;
  /** Tool name → sha256 of its pinned fields. */
  tools: Record<string, string>;
}

export interface PinCheck {
  ok: boolean;
  changed: string[];
  added: string[];
  removed: string[];
}

/**
 * Hash of the fields the model sees: description, input and output schema,
 * title and annotations. Key order does not affect the hash.
 */
export function hashTool(tool: ToolDef): string {
  return hashValue({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  });
}

export function makePin(tools: ToolDef[], server?: string): PinFile {
  const pinned: Record<string, string> = {};
  for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) pinned[t.name] = hashTool(t);
  return { version: 1, createdAt: new Date().toISOString(), ...(server ? { server } : {}), tools: pinned };
}

export function verifyPin(pin: PinFile, tools: ToolDef[]): PinCheck {
  const current = makePin(tools).tools;
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [name, hash] of Object.entries(current)) {
    const old = pin.tools[name];
    if (old === undefined) added.push(name);
    else if (old !== hash) changed.push(name);
  }
  for (const name of Object.keys(pin.tools)) if (!(name in current)) removed.push(name);
  return { ok: changed.length + added.length + removed.length === 0, changed, added, removed };
}

/** Compare two tool lists directly (used to spot changes within one session). */
export function compareTools(before: ToolDef[], after: ToolDef[]): PinCheck {
  return verifyPin(makePin(before), after);
}

export function assertPin(value: unknown): PinFile {
  const p = value as Partial<PinFile> | null;
  if (!p || typeof p !== "object" || typeof p.tools !== "object" || p.tools === null) {
    throw new Error('not a pin file (expected an object with a "tools" map)');
  }
  return p as PinFile;
}
