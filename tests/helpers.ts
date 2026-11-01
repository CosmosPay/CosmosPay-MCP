import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from '@/config';
import { createServer } from '@/server';

export const KEY = 'dv_test_0123456789abcdef';

export function config(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: KEY,
    network: 'testnet',
    apiUrl: 'https://api.example.test/cosmos-api',
    checkoutUrl: 'https://pay.example.test',
    readOnly: false,
    ...overrides,
  };
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from a queue of [status, body, headers?] and records every call. */
export function fakeFetch(answers: Array<[number, unknown, Record<string, string>?]>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    const [status, body, headers] = next;
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    });
  }) as typeof fetch;
  return { fn, calls };
}

/** An MCP client connected to the server in memory. */
export async function connect(cfg: Config, fetchFn: typeof fetch) {
  const server = createServer(cfg, { fetch: fetchFn, delay: () => 0 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export const INTENT = {
  id: 'pi_123',
  kind: 'PAY',
  status: 'PENDING',
  chain: 'stellar',
  network: 'testnet',
  source: null,
  destination: 'GDESTINATION',
  amount: '25',
  asset: 'USDC',
  assetIssuer: 'GISSUER',
  memo: '1001',
  chainReference: null,
  networkFee: null,
  merchantFee: null,
  msg: 'Order #1001',
  callback: null,
  xdr: null,
  uri: 'web+stellar:pay?destination=GDESTINATION&amount=25',
  qr: 'data:image/png;base64,iVBORw0KGgo=',
  txHash: null,
  reference: null,
  checkoutTheme: 'classic',
  expiresAt: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
};
