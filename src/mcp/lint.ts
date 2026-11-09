/**
 * Heuristic linter for MCP tool definitions.
 *
 * Tool names, descriptions and schemas are sent straight to the model, so they
 * are an attack surface (tool poisoning). These rules catch common mistakes
 * and known attack patterns. They are heuristics: a clean report does not
 * prove a server is safe, and some findings will be false positives.
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

/** An MCP tool definition as returned by `tools/list`. */
export interface ToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  [key: string]: unknown;
}

export type Severity = "high" | "medium" | "low";

export type LintRule =
  | "missing-description"
  | "short-description"
  | "description-too-long"
  | "no-input-schema"
  | "param-no-description"
  | "open-additional-properties"
  | "injection-pattern"
  | "hidden-unicode"
  | "dangerous-no-annotations"
  | "unbounded-string-param"
  | "duplicate-name";

export interface Finding {
  rule: LintRule;
  severity: Severity;
  tool: string;
  message: string;
  /** Where in the tool definition, e.g. "description" or "inputSchema.path.description". */
  location?: string;
}

export interface LintOptions {
  /** Descriptions shorter than this are flagged. Default 20. */
  minDescriptionLength?: number;
  /** Descriptions longer than this are flagged. Default 1500. */
  maxDescriptionLength?: number;
}

export interface LintReport {
  toolCount: number;
  score: number;
  findings: Finding[];
}

/** Points removed from 100 per finding. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 25, medium: 10, low: 3 };

/** 0–100. Starts at 100 and subtracts a weight per finding. */
export function score(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

// ---------------------------------------------------------------------------
// Pattern tables
// ---------------------------------------------------------------------------

interface InjectionPattern {
  label: string;
  severity: Severity;
  re: RegExp;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    label: "ignore previous instructions",
    severity: "high",
    re: /\b(ignor(e|es|ed|ing)|disregard(s|ed|ing)?|forget(s|ting)?)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|other|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directions)\b/i,
  },
  {
    label: "override instructions",
    severity: "high",
    re: /\b(overrid(e|es|ing|den)|bypass(es|ed|ing)?|supersed(e|es|ed|ing))\b[^.\n]{0,30}\b(instructions?|rules|guidelines|safety|system prompt|restrictions)\b/i,
  },
  {
    label: "hide from user",
    severity: "high",
    re: /\b(do not|don't|dont|never|must not)\s+(tell|inform|mention|reveal|show|notify|alert)\b[^.\n]{0,30}\buser\b/i,
  },
  {
    label: "hide from user",
    severity: "high",
    re: /\bwithout\s+(telling|informing|notifying|alerting|asking)\s+the\s+user\b|\bthe\s+user\s+(must|should)\s+not\s+(know|see|be told)\b/i,
  },
  {
    label: "instruction tag",
    severity: "high",
    re: /<\s*\/?\s*(important|system|instructions?|secret|hidden|admin)\b[^>]*>/i,
  },
  {
    label: "sensitive file reference",
    severity: "high",
    re: /~\/\.ssh|\.ssh\/|\bid_(rsa|ed25519|ecdsa)\b|\/etc\/(passwd|shadow)\b|\.aws\/credentials|\.kube\/config|(^|[\s"'`(/])\.(env|npmrc|netrc|pgpass)\b|\bmcp\.json\b|\bprivate[_ ]key\b/i,
  },
  {
    label: "send data to URL",
    severity: "medium",
    re: /\b(send|post|upload|forward|exfiltrate|transmit|leak)\b[^.\n]{0,60}(https?:\/\/|webhook)/i,
  },
  {
    label: "role hijack",
    severity: "medium",
    re: /\b(you are now|new instructions|act as (an? )?(admin|root|system|developer))\b/i,
  },
];

/**
 * Invisible or direction-changing characters: zero-width, bidi controls,
 * soft hyphen, word joiners, BOM, Unicode tag characters (U+E0000–E007F,
 * which can smuggle invisible ASCII) and variation selectors supplement.
 */
const HIDDEN_UNICODE =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;

const DANGEROUS_NAME_TOKENS = new Set([
  "exec", "execute", "shell", "bash", "cmd", "command", "run", "eval", "spawn",
  "delete", "remove", "rm", "unlink", "destroy", "drop", "truncate", "purge", "wipe", "kill",
  "write", "overwrite", "move", "rename", "deploy", "transfer",
]);

const RISKY_PARAM_TOKENS = new Set([
  "path", "filepath", "file", "filename", "dir", "directory", "folder",
  "command", "cmd", "script",
  "url", "uri", "endpoint", "href",
  "sql",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split "runShellCommand" / "run_shell-command" into ["run", "shell", "command"]. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface Param {
  /** Display path, e.g. "options.path" or "files[].name". */
  path: string;
  name: string;
  schema: JsonSchema;
}

/** All properties in a schema, including nested objects and array items. */
function collectParams(schema: JsonSchema, prefix = "", depth = 0): Param[] {
  if (depth > 6) return [];
  const out: Param[] = [];
  const props = schema.properties;
  if (isObject(props)) {
    for (const [name, sub] of Object.entries(props)) {
      if (!isObject(sub)) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      out.push({ path, name, schema: sub });
      out.push(...collectParams(sub, path, depth + 1));
    }
  }
  const items = schema.items;
  if (isObject(items)) out.push(...collectParams(items, `${prefix}[]`, depth + 1));
  return out;
}

/** Every string inside a tool definition that the model may read, with its location. */
function collectTexts(tool: ToolDef): { location: string; text: string }[] {
  const out: { location: string; text: string }[] = [];
  const add = (location: string, v: unknown) => {
    if (typeof v === "string" && v) out.push({ location, text: v });
  };
  add("name", tool.name);
  add("title", tool.title);
  add("description", tool.description);
  add("annotations.title", tool.annotations?.title);
  const walk = (schema: unknown, loc: string, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(schema)) {
      schema.forEach((v, i) => walk(v, `${loc}[${i}]`, depth + 1));
      return;
    }
    if (!isObject(schema)) {
      add(loc, schema);
      return;
    }
    for (const [k, v] of Object.entries(schema)) {
      if (k === "properties" && isObject(v)) {
        for (const [pname, pschema] of Object.entries(v)) {
          add(`${loc}.properties.${pname}(name)`, pname);
          walk(pschema, `${loc}.properties.${pname}`, depth + 1);
        }
      } else {
        walk(v, `${loc}.${k}`, depth + 1);
      }
    }
  };
  walk(tool.inputSchema, "inputSchema", 0);
  walk(tool.outputSchema, "outputSchema", 0);
  return out;
}

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

function describeCodePoint(ch: string): string {
  return "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
}

/** Decode Unicode tag characters (U+E0020–E007E) back to the ASCII they hide. */
export function decodeTagChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCodePoint(cp - 0xe0000);
  }
  return out;
}

function isStringType(schema: JsonSchema): boolean {
  const t = schema.type;
  if (t === undefined) return !("enum" in schema) && !("const" in schema) && !isObject(schema.properties);
  return t === "string" || (Array.isArray(t) && t.includes("string"));
}

// ---------------------------------------------------------------------------
// Linter
// ---------------------------------------------------------------------------

export function lintTools(tools: ToolDef[], options: LintOptions = {}): LintReport {
  const minLen = options.minDescriptionLength ?? 20;
  const maxLen = options.maxDescriptionLength ?? 1500;
  const findings: Finding[] = [];

  const seen = new Map<string, number>();
  for (const t of tools) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
  for (const [name, n] of seen) {
    if (n > 1) {
      findings.push({
        rule: "duplicate-name",
        severity: "medium",
        tool: name,
        message: `tool name defined ${n} times; one definition can shadow another`,
      });
    }
  }

  for (const tool of tools) {
    const push = (rule: LintRule, severity: Severity, message: string, location?: string) =>
      findings.push({ rule, severity, tool: tool.name, message, ...(location ? { location } : {}) });

    // Description quality
    const desc = tool.description?.trim() ?? "";
    if (!desc) {
      push("missing-description", "medium", "tool has no description; the model has to guess what it does", "description");
    } else if (desc.length < minLen) {
      push("short-description", "low", `description is ${desc.length} chars (min ${minLen})`, "description");
    } else if (desc.length > maxLen) {
      push("description-too-long", "low", `description is ${desc.length} chars (max ${maxLen}); long descriptions are a common place to hide instructions`, "description");
    }

    // Schema shape
    const schema = tool.inputSchema;
    if (!isObject(schema)) {
      push("no-input-schema", "medium", "tool has no inputSchema", "inputSchema");
    } else {
      const hasProps = isObject(schema.properties) && Object.keys(schema.properties).length > 0;
      if (hasProps && schema.additionalProperties !== false) {
        push("open-additional-properties", "low", "inputSchema allows unknown properties; set additionalProperties: false", "inputSchema");
      }
      for (const p of collectParams(schema)) {
        if (typeof p.schema.description !== "string" || !p.schema.description.trim()) {
          push("param-no-description", "low", `parameter "${p.path}" has no description`, `inputSchema.${p.path}`);
        }
        const risky = nameTokens(p.name).some((tok) => RISKY_PARAM_TOKENS.has(tok));
        const bounded = "enum" in p.schema || "const" in p.schema || "pattern" in p.schema || "maxLength" in p.schema;
        if (risky && isStringType(p.schema) && !bounded) {
          push(
            "unbounded-string-param",
            "medium",
            `parameter "${p.path}" accepts any string; add enum, pattern or maxLength`,
            `inputSchema.${p.path}`,
          );
        }
      }
    }

    // Annotations on dangerous tools
    const ann = tool.annotations;
    const dangerous = nameTokens(tool.name).filter((tok) => DANGEROUS_NAME_TOKENS.has(tok));
    if (dangerous.length > 0 && ann?.readOnlyHint === undefined && ann?.destructiveHint === undefined) {
      push(
        "dangerous-no-annotations",
        "medium",
        `name suggests side effects (${dangerous.join(", ")}) but no readOnlyHint/destructiveHint annotation is set`,
        "annotations",
      );
    }

    // Text content: injection patterns and hidden characters
    for (const { location, text } of collectTexts(tool)) {
      for (const pat of INJECTION_PATTERNS) {
        const m = pat.re.exec(text);
        if (m) {
          push("injection-pattern", pat.severity, `${pat.label}: "${snippet(text, m.index, m[0].length)}"`, location);
        }
      }
      const hidden = text.match(HIDDEN_UNICODE);
      if (hidden) {
        const codes = [...new Set(hidden.map(describeCodePoint))];
        const decoded = decodeTagChars(text);
        push(
          "hidden-unicode",
          "high",
          `${hidden.length} invisible/bidi character(s): ${codes.slice(0, 6).join(", ")}${codes.length > 6 ? ", …" : ""}` +
            (decoded ? `; hidden text decodes to "${decoded.slice(0, 120)}"` : ""),
          location,
        );
      }
    }
  }

  return { toolCount: tools.length, score: score(findings), findings };
}

/** Accept a tools array, a `tools/list` result (`{ tools: [...] }`), or a JSON-RPC response wrapping one. */
export function parseTools(value: unknown): ToolDef[] {
  let v: unknown = value;
  if (isObject(v) && isObject(v.result)) v = v.result;
  if (isObject(v) && Array.isArray(v.tools)) v = v.tools;
  if (!Array.isArray(v)) throw new Error('expected an array of tools or an object with a "tools" array');
  v.forEach((t, i) => {
    if (!isObject(t) || typeof t.name !== "string") throw new Error(`tools[${i}] has no string "name"`);
  });
  return v as ToolDef[];
}
