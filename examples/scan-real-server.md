# Scanning a real public MCP server

This walks through `agentcheck mcp-scan` against the official
[`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)
package (version 2.3.0 when this was written). Nothing here is a vulnerability report. The point is to show what a clean-of-poisoning server looks like in the output, and what the hygiene findings mean.

`mcp-scan` runs the command you give it. Only scan servers you would be willing to run.

## Run it

```sh
npx @ydeshpa4/agentcheck mcp-scan --write-pin fs.pin.json -- npx -y @modelcontextprotocol/server-filesystem /tmp
echo $?
```

## What you get

```
secure-filesystem-server@1.0.0: 14 tools, score 0/100, 42 finding(s)
  [medium] read_file: unbounded-string-param: parameter "path" accepts any string; add enum, pattern or maxLength (inputSchema.path)
  [low] read_file: open-additional-properties: inputSchema allows unknown properties; set additionalProperties: false (inputSchema)
  [low] read_file: param-no-description: parameter "path" has no description (inputSchema.path)
  ...
```

The exit code is `0`. The 42 findings are 11 medium and 31 low, with no high-severity ones.

## How to read it

- **No high findings.** There are no injection phrases, no hidden Unicode, and no tool that changed between two listings in the same session. These are the checks that fail the scan by default.
- **`unbounded-string-param` (medium).** Every `path` parameter accepts any string. For a filesystem server this is expected, since the server enforces its allowed directories at runtime. The linter cannot see that, so it reports the schema as written.
- **`open-additional-properties` and `param-no-description` (low).** Schema hygiene. Models do better with described parameters.
- **Score 0/100.** The score is 100 minus 25 per high, 10 per medium and 3 per low finding, floored at 0. Eleven mediums alone reach 110, so a server with only hygiene findings still scores 0. Use the exit code and the severity counts, not the score, to decide pass or fail on a server like this. See the open issue about making the score less blunt.

## Pin the tools and detect a change

The `--write-pin` flag saved a hash of every tool definition. In CI, scan again with the pin:

```sh
npx @ydeshpa4/agentcheck mcp-scan --pin fs.pin.json -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

If the server later adds, removes or edits a tool, the scan exits `1` and reports `changed`, `added` or `removed`. That is how you notice a "rug pull" after you approved a server.

## Compare with a poisoned server

`examples/bad-server.ts` in this repository is a deliberately malicious server. Scanning it exits `1` with high-severity `injection-pattern` and `hidden-unicode` findings. See the main README for that output.
