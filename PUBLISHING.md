# Publishing agentcheck

The package is published as `@ydeshpa4/agentcheck`. npm rejected the unscoped name `agentcheck` as too similar to the existing `agent-check` package. A scope that matches your npm username is always available to you. The CLI command is still `agentcheck`.

## 1. Put the code on GitHub

The code lives at [github.com/yashpy/Agentcheck](https://github.com/yashpy/Agentcheck), and `package.json` already has its `repository`, `homepage` and `bugs` fields. npm shows them on the package page, and provenance checks the repository URL against the repo that ran the build. The CI workflow runs typecheck, tests and build on Node 18, 20, 22 and 24 for every push and PR.

## 2. First publish (manual, once)

Trusted publishing can only be set up for a package that already exists, so publish the first version from your machine:

```sh
npm login                      # an npmjs.com account with 2FA turned on
npm run typecheck && npm test && npm run build
npm pack --dry-run             # check that only dist/, README.md, LICENSE and package.json are included
npm publish --access public
```

`prepublishOnly` runs typecheck, tests and build again before publishing.

## 3. Switch to trusted publishing (every later release)

1. On npmjs.com, open the package, go to **Settings → Trusted Publisher → GitHub Actions**, and enter owner `yashpy`, repository `Agentcheck`, and workflow file `release.yml`.
2. Optionally, set **Publishing access** to "Require two-factor authentication and disallow tokens" so that only the workflow can publish.
3. To release:
   ```sh
   npm version patch            # or minor / major; bumps package.json and creates a git tag
   ```
   Then update `VERSION` in `src/util.ts` to the new version and commit it. The `--version` test fails if the two don't match.
   ```sh
   git push --follow-tags
   ```
   `release.yml` checks that the tag matches `package.json` and publishes. Trusted publishing attaches provenance automatically.

## 4. Optional: JSR

To publish on [jsr.io](https://jsr.io) for Deno and Bun users, add a `jsr.json` with `name`, `version` and `exports: "./src/index.ts"`, then run `npx jsr publish`.

## 5. Getting it in front of people

- Fill in the GitHub repo's description and topics: `mcp`, `ai-agents`, `llm-testing`, `security`.
- Open PRs to add it to community lists such as awesome-mcp-servers, awesome-mcp-devtools and awesome-ai-agents.
- Write a short post that runs `mcp-scan` against `examples/bad-server.ts` and shows the hidden-text decode. That output is the most convincing demo the project has.
- Post in the MCP community discussions and the Vercel AI SDK discussions, since `fromAISteps` targets AI SDK users directly.
