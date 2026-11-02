/* results.ts: how tools answer. Each result carries a short line a person can read, the data as
   JSON text (every client shows text) and the same data as structuredContent (for clients that
   read it). Errors come back as tool errors with the API's own message and a hint, never thrown,
   so the agent can explain or retry. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, NetworkError } from '@/api';
import type { Network } from '@/config';

/** A payment intent as the Payments API answers it (the fields this server reads). */
export interface PaymentIntent {
  id: string;
  kind: 'TX' | 'PAY';
  status: 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  chain: 'stellar' | 'solana' | 'monad';
  network: string;
  destination: string;
  amount: string | null;
  asset: string;
  assetIssuer: string | null;
  memo: string;
  msg: string | null;
  uri: string;
  qr: string;
  txHash: string | null;
  networkFee: unknown;
  merchantFee: unknown;
  checkoutTheme: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a tool shows of a payment: everything but the QR image, plus its hosted checkout. */
export function paymentView(intent: PaymentIntent, checkoutUrl: string) {
  return {
    id: intent.id,
    status: intent.status,
    chain: intent.chain,
    network: intent.network,
    amount: intent.amount,
    asset: intent.asset,
    assetIssuer: intent.assetIssuer,
    destination: intent.destination,
    memo: intent.memo,
    message: intent.msg,
    paymentUri: intent.uri,
    checkoutUrl: `${checkoutUrl}/${encodeURIComponent(intent.id)}`,
    txHash: intent.txHash,
    networkFee: intent.networkFee,
    merchantFee: intent.merchantFee,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

const COINS: Record<PaymentIntent['chain'], string> = { stellar: 'XLM', solana: 'SOL', monad: 'MON' };

/** The asset as a person reads it: the API names a chain's own coin `native`. */
export function assetName(intent: Pick<PaymentIntent, 'asset' | 'chain'>): string {
  return intent.asset === 'native' ? (COINS[intent.chain] ?? intent.asset) : intent.asset;
}

export function networkLabel(network: Network): string {
  return network === 'testnet' ? 'test networks (dv_ key: no real funds)' : 'mainnet (prod_ key: real funds)';
}

export function ok(summary: string, data: Record<string, unknown>, extra: CallToolResult['content'] = []): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }, ...extra],
    structuredContent: data,
  };
}

const HINTS: Record<number, string> = {
  400: 'The API refused the request as written; its message says which field.',
  401: 'The API key was refused: check COSMOS_PAY_API_KEY (it may be revoked or mistyped).',
  403: 'The API key lacks the permission (scope) for this operation; create a key with it in the dashboard.',
  404: 'Nothing with that id exists for this API key (a dv_ key and a prod_ key see different records).',
  409: 'The request conflicts with the current state (for example a memo already used, or a payment that just changed).',
  429: 'Rate limited by the API; wait a moment before trying again.',
};

/** A failed call as a tool error the agent can read. */
export function failure(error: unknown): CallToolResult {
  let text: string;
  if (error instanceof ApiError) {
    const hint = HINTS[error.status] ?? (error.status >= 500 ? 'The Payments API had a problem; try again shortly.' : '');
    text = `Cosmos Pay API error ${error.status}${error.code ? ` (${error.code})` : ''}: ${error.message}${hint ? `\n${hint}` : ''}`;
  } else if (error instanceof NetworkError) {
    text = error.message;
  } else {
    text = `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { isError: true, content: [{ type: 'text', text }] };
}

/** The QR the API returns (a PNG data URL) as MCP image content; null when it is not one. */
export function qrImage(qr: string): CallToolResult['content'][number] | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(qr);
  return match?.[1] ? { type: 'image', data: match[1], mimeType: 'image/png' } : null;
}
