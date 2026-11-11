# Contributing to agentcheck

Thanks for helping. agentcheck is small on purpose: one package, one runtime dependency, a CLI that fits in CI. Contributions that keep it that way are the easiest to merge.

## Setup

Requires Node 18 or newer.

```sh
git clone https://github.com/yashpy/Agentcheck.git
cd Agentcheck
npm ci
npm run typecheck
npm test
npm run build
```

CI runs the same three commands on Node 18, 20, 22 and 24. A pull request needs all of them green.

## Where things live

| Path | What it does |
|---|---|
| `src/recorder.ts`, `src/assert.ts`, `src/replay.ts`, `src/diff.ts` | Agent trace recording, assertions, offline replay, baseline diff |
| `src/mcp/lint.ts` | Lint rules for MCP tool definitions |
| `src/mcp/scan.ts`, `src/mcp/pin.ts` | Live stdio scan and tool-hash pinning |
| `src/cli.ts` | CLI. Exit `1` on failure, `2` on usage errors |
| `tests/` | `node:test` run through `tsx`. Includes end-to-end scans of `examples/bad-server.ts` |

## Adding a lint rule

1. Add the check in `src/mcp/lint.ts` and give it a short kebab-case rule id.
2. Pick a severity. High is for things that are almost never legitimate (hidden characters, instructions aimed at the model). Medium and low are hygiene.
3. Add a test in `tests/lint.test.ts` with one input that triggers the rule and one similar input that must not.
4. Add a row to the rules table in `README.md`.

Detection rules are regexes, so false positives matter. If a rule flags legitimate text in a real public server, say so in the pull request and attach the tool definition.

## Pull requests

- Keep each pull request to one change.
- Add or update tests for behavior you change. Do not change a test just to make it pass.
- Update `README.md` when you change a flag, a rule, or a public function.
- Do not add runtime dependencies without opening an issue first.
- Use a short imperative commit message, for example `Add rule for tool names with path separators`.

## Reporting security problems

agentcheck executes the server command you give to `mcp-scan`. If you find a way for a scanned server to affect the host beyond that, please do not open a public issue. Use GitHub's private vulnerability reporting on this repository.

## Licence

By contributing you agree that your contribution is released under the MIT licence in `LICENSE`.
