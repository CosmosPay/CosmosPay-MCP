/* payments.ts: payment tools. A payment here is a Payments API payment intent of kind `pay`: a
   payment request (link, QR and hosted checkout) that the payer completes from their own wallet.
   Creating one moves no money; the payment settles on-chain straight to `destination`. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CosmosPayApi } from '@/api';
import type { Config } from '@/config';
import { failure, networkLabel, ok, paymentView, qrImage, type PaymentIntent } from '@/results';

const CHAINS = ['stellar', 'solana', 'monad'] as const;
const STATUSES = ['PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;
const THEMES = ['classic', 'split', 'ticket', 'card'] as const;

/* Payment ids are letters, digits, `_` and `-` (cuid or uuid). Anything else is refused before a
   request: `..` survives encodeURIComponent and `new URL` would resolve it to another route. */
const id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'a payment id: letters, digits, "_" and "-"')
  .describe('The payment id, as create_payment_link or list_payments returned it.');

interface Page {
  data: PaymentIntent[];
  total: number;
  take: number;
  skip: number;
}

export function registerPaymentTools(server: McpServer, api: CosmosPayApi, config: Config): void {
  const view = (intent: PaymentIntent) => paymentView(intent, config.checkoutUrl);
  const path = (paymentId: string) => `/payment-intents/${encodeURIComponent(paymentId)}`;

  server.registerTool(
    'get_payment',
    {
      title: 'Get a payment',
      description:
        'Read one payment: its status (PENDING, SUBMITTED, SUCCEEDED, FAILED, CANCELLED, EXPIRED), amount, asset, chain, destination, payment link, hosted checkout URL and, once paid, the transaction hash.',
      inputSchema: { id },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id: paymentId }) => {
      try {
        const intent = await api.request<PaymentIntent>('GET', path(paymentId));
        return ok(`Payment ${intent.id} is ${intent.status} on ${intent.chain} (${intent.network}).`, view(intent));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_payment_history',
    {
      title: 'Get a payment history',
      description: 'The status changes of one payment, oldest first, with when each happened.',
      inputSchema: { id },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id: paymentId }) => {
      try {
        const transitions = await api.request<unknown[]>('GET', `${path(paymentId)}/transitions`);
        return ok(`${transitions.length} status change(s) for payment ${paymentId}.`, { id: paymentId, transitions });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'list_payments',
    {
      title: 'List payments',
      description:
        'List the payments of the API key’s organization, newest first, optionally filtered by status, chain or creation date. Paged: `total` says how many match.',
      inputSchema: {
        status: z.enum(STATUSES).optional().describe('Only payments in this status.'),
        chain: z.enum(CHAINS).optional().describe('Only payments on this chain.'),
        created_from: z.iso.datetime({ offset: true }).optional().describe('Only payments created at or after this instant (ISO 8601).'),
        take: z.number().int().min(1).max(100).optional().describe('How many to return (1 to 100, default 20).'),
        skip: z.number().int().min(0).optional().describe('How many to skip, for the next page.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ status, chain, created_from, take, skip }) => {
      try {
        const page = await api.request<Page>('GET', '/payment-intents', {
          query: { status, chain, createdFrom: created_from, take: take ?? 20, skip: skip ?? 0 },
        });
        const payments = page.data.map(view);
        return ok(`${payments.length} of ${page.total} payment(s) (skip ${page.skip}).`, {
          total: page.total,
          take: page.take,
          skip: page.skip,
          payments,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (config.readOnly) return;

  server.registerTool(
    'create_payment_link',
    {
      title: 'Create a payment link',
      description: [
        'Create a payment request that a customer pays from their own wallet: a payment link (SEP-7 on Stellar, Solana Pay on Solana, EIP-681 on Monad), its QR code and a hosted checkout page.',
        'It moves no money: the payment settles on-chain straight to `destination` once the customer pays.',
        `The network is the API key’s: this server is on ${networkLabel(config.network)}.`,
        'Omit `amount` to let the payer choose it (not on Monad, which needs one). Omit `asset_code` to charge in the chain’s coin (XLM, SOL, MON).',
        'Send the customer `checkoutUrl` (or `paymentUri` for a wallet), then use get_payment to see when it is paid.',
      ].join(' '),
      inputSchema: {
        destination: z
          .string()
          .trim()
          .min(1)
          .describe('The account that receives the payment, on the chosen chain: Stellar G..., Solana base58 address, Monad 0x... address.'),
        chain: z.enum(CHAINS).optional().describe('The chain the payment settles on. Default: stellar.'),
        amount: z
          .string()
          .regex(/^\d+(\.\d+)?$/, 'a positive decimal number, e.g. "25" or "10.50"')
          .optional()
          .describe('Amount the destination receives, in the asset’s own units, as a decimal string ("25", "10.50"). Omit for an open amount.'),
        asset_code: z.string().trim().min(1).max(12).optional().describe('Asset to charge in, e.g. "USDC". Omit for the chain’s coin.'),
        asset_issuer: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Who issues the asset: the Stellar issuer account, the Solana SPL mint or the Monad ERC-20 contract. Needed for a token unless the API has a preset for it.'),
        memo: z
          .string()
          .regex(/^\d{1,20}$/, 'digits only (a uint64)')
          .optional()
          .describe('Numeric MEMO_ID: the idempotency key on every chain and the on-chain match on Stellar. Generated when omitted; reusing one is refused.'),
        message: z.string().max(300).optional().describe('Shown to the payer in their wallet (Stellar and Solana), e.g. an order number.'),
        checkout_theme: z.enum(THEMES).optional().describe('Design of the hosted checkout page. Default: classic.'),
        include_qr: z.boolean().optional().describe('Also return the QR code as an image. Default: false.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const intent = await api.request<PaymentIntent>('POST', '/payment-intents/pay', {
          body: {
            chain: input.chain,
            destination: input.destination,
            amount: input.amount,
            assetCode: input.asset_code,
            assetIssuer: input.asset_issuer,
            memo: input.memo,
            msg: input.message,
            checkoutTheme: input.checkout_theme,
          },
        });
        const data = view(intent);
        const image = input.include_qr ? qrImage(intent.qr) : null;
        const amount = intent.amount ? `${intent.amount} ${intent.asset}` : `an open amount of ${intent.asset}`;
        return ok(
          `Created payment ${intent.id} for ${amount} on ${intent.chain} (${intent.network}). Checkout: ${data.checkoutUrl}`,
          data,
          image ? [image] : [],
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'validate_payment',
    {
      title: 'Validate a payment',
      description:
        'Check a transaction against a payment and settle it if it pays it. Use it when the payer sent the payment but its status has not changed: pass the transaction hash (or Solana signature) the payer has.',
      inputSchema: {
        id,
        tx_hash: z.string().trim().min(1).max(200).describe('The transaction to check, in its chain’s form: a Stellar hash, a Solana signature or a Monad 0x hash.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id: paymentId, tx_hash }) => {
      try {
        const result = await api.request<Record<string, unknown>>('POST', `${path(paymentId)}/validate`, { body: { txHash: tx_hash } });
        return ok(`Validated transaction against payment ${paymentId}.`, { id: paymentId, result });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'delete_payment',
    {
      title: 'Delete a payment',
      description:
        'Delete a payment that is not paid, so its link can no longer be paid. A paid (SUCCEEDED) payment cannot be deleted. This cannot be undone: confirm with the user first.',
      inputSchema: { id },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id: paymentId }) => {
      try {
        const result = await api.request<Record<string, unknown>>('DELETE', path(paymentId));
        return ok(`Deleted payment ${paymentId}.`, { id: paymentId, result });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
