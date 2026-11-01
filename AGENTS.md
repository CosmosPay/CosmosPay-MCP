# AGENTS.md

Guidance for coding agents working in this repository: the Cosmos Pay MCP server
(`@cosmosapp/pay_mcp`, stdio).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (tests/**/*.test.ts): config, the API client and every tool over an in-memory MCP client
npm run build       # tsup: one ESM file, dist/index.js (the `cosmos-pay-mcp` bin)
npm run inspect     # MCP Inspector on the build (needs COSMOS_PAY_API_KEY)
```

## Rules

- **Imports use the `@/` alias** (`src/`), tests also `@tests/` (`tests/`). Never relative paths.
  The alias is set in tsconfig.json, vitest.config.ts, and resolved by esbuild in the build.
- **Everything technical is in English**: code, comments, messages, commits, PRs, docs.
- **No em dashes** anywhere (product owner's rule across Cosmos Pay repositories).
- **The API key never leaves the process**: read only from `COSMOS_PAY_API_KEY`, never a tool
  argument, never in a log, an error or a result (`ApiError` strips it). Tests check this.
- **stdout is the protocol.** Anything for a person goes to stderr.
- **Nothing signs or moves funds.** Tools create payment requests and read. A tool that would sign,
  swap, bridge or touch KYC data does not belong here without a product decision.
- **Every tool declares its annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and
  read-only mode (`COSMOS_PAY_READ_ONLY`) registers only `readOnlyHint` tools. A new tool gets a test
  in tests/server.test.ts.
- **Shapes come from the Payments API spec** (https://dev.cosmospay.lat/docs/openapi.json), not
  invented. The SDK's `createPay` types Stellar only, which is why this server calls the REST API.
- **Versions**: package.json is the only place; the build injects it (`__VERSION__`). Releases are
  automatic from Conventional Commits on `main` (scripts/release-version.mjs, git-cliff).

## Branches

`feature -> dev -> main`, as in the other Cosmos Pay repositories. A push to `main` runs Release.
