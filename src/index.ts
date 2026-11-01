#!/usr/bin/env node
/* The `cosmos-pay-mcp` command: the Cosmos Pay MCP server over stdio. stdout carries the protocol
   only, so every message for a person goes to stderr. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from '@/api';
import { ConfigError, loadConfig } from '@/config';
import { createServer } from '@/server';

const HELP = `cosmos-pay-mcp ${VERSION}: MCP server for the Cosmos Pay Payments API (stdio).

Environment:
  COSMOS_PAY_API_KEY       required: a secret key from https://dev.cosmospay.lat (dv_ test networks, prod_ mainnet)
  COSMOS_PAY_READ_ONLY     "1" to offer only the tools that read
  COSMOS_PAY_API_URL       optional: another Payments API root (default https://api.cosmospay.lat/cosmos-api)
  COSMOS_PAY_CHECKOUT_URL  optional: another hosted checkout origin (default https://payments.cosmospay.lat)

Docs: https://github.com/CosmosPay/CosmosPay-MCP#readme
`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--version' || arg === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(HELP);
    return;
  }
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`cosmos-pay-mcp ${VERSION} ready (${config.network}${config.readOnly ? ', read-only' : ''}).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof ConfigError ? error.message : error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
