/* server.ts: the MCP server, its instructions for the model and its tools. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CosmosPayApi, VERSION, type ApiOptions } from '@/api';
import type { Config } from '@/config';
import { networkLabel } from '@/results';
import { registerAccountTools } from '@/tools/account';
import { registerPaymentTools } from '@/tools/payments';

export function instructions(config: Config): string {
  return [
    'Cosmos Pay is a non-custodial stablecoin payment gateway on Stellar, Solana and Monad (cosmospay.lat; not the Cosmos Network, ATOM).',
    `This server uses one organization's API key, on ${networkLabel(config.network)}.`,
    'A payment is a request the customer pays from their own wallet: create_payment_link returns a link, a QR and a hosted checkout URL, and the money settles on-chain straight to the destination address. Nothing here signs or moves funds.',
    config.readOnly ? 'Read-only mode: only the tools that read are available.' : 'delete_payment cannot be undone: confirm with the user before calling it.',
    'Docs: https://dev.cosmospay.lat/docs/ (index for LLMs: https://dev.cosmospay.lat/docs/llms.txt).',
  ].join('\n');
}

export function createServer(config: Config, apiOptions: ApiOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'cosmos-pay', title: 'Cosmos Pay', version: VERSION, websiteUrl: 'https://cosmospay.lat' },
    { instructions: instructions(config) },
  );
  const api = new CosmosPayApi(config, apiOptions);
  registerPaymentTools(server, api, config);
  registerAccountTools(server, api, config);
  return server;
}
