/* account.ts: read-only tools about the organization and the assets it can charge in. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CosmosPayApi } from '@/api';
import type { Config } from '@/config';
import { failure, ok } from '@/results';

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };

export function registerAccountTools(server: McpServer, api: CosmosPayApi, config: Config): void {
  server.registerTool(
    'get_summary',
    {
      title: 'Get the account summary',
      description: 'Overview of the API key’s organization: payment totals, settled volume, webhook health and a 30-day series.',
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const summary = asObject(await api.request<unknown>('GET', '/summary'));
        return ok(`Summary for this organization (${config.network}).`, summary);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_balances',
    {
      title: 'Get settled balances',
      description: 'Settled and pending amounts per asset for the API key’s organization (what its payments brought in, not a wallet balance).',
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const balances = asObject(await api.request<unknown>('GET', '/balances'));
        return ok(`Balances per asset (${config.network}).`, balances);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'list_stellar_assets',
    {
      title: 'List Stellar assets',
      description:
        'The Stellar asset catalog: codes and issuers to charge in (for example USDC and EURC by Circle). Use an entry’s code and issuer as create_payment_link’s asset_code and asset_issuer.',
      inputSchema: {
        network: z
          .enum(['public', 'testnet'])
          .optional()
          .describe(`Which Stellar network. Default: the API key’s (${config.network === 'testnet' ? 'testnet' : 'public'}).`),
        verified_only: z.boolean().optional().describe('Only issuer-verified assets. Default: false.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ network, verified_only }) => {
      try {
        const assets = asObject(
          await api.request<unknown>('GET', '/assets', {
            query: {
              network: network ?? (config.network === 'testnet' ? 'testnet' : 'public'),
              verified: verified_only ? 'true' : undefined,
            },
          }),
        );
        return ok('Stellar asset catalog.', assets);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
