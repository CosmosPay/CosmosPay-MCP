import { describe, expect, it } from 'vitest';
import { ApiError, CosmosPayApi, NetworkError, VERSION } from '@/api';
import { KEY, fakeFetch } from '@tests/helpers';

const config = { apiKey: KEY, apiUrl: 'https://api.example.test/cosmos-api' };

describe('CosmosPayApi', () => {
  it('calls /v1 with the key as the SDK sends it, and drops empty query values', async () => {
    const { fn, calls } = fakeFetch([[200, { ok: true }]]);
    const api = new CosmosPayApi(config, { fetch: fn });
    await api.request('GET', '/payment-intents', { query: { status: 'PENDING', chain: undefined, take: 20 } });
    expect(calls[0]?.url).toBe('https://api.example.test/cosmos-api/v1/payment-intents?status=PENDING&take=20');
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.headers.apikey).toBe(KEY);
    expect(calls[0]?.headers['User-Agent']).toBe(`@cosmosapp/pay_mcp/${VERSION}`);
  });

  it('sends JSON bodies', async () => {
    const { fn, calls } = fakeFetch([[201, { id: 'x' }]]);
    await new CosmosPayApi(config, { fetch: fn }).request('POST', '/payment-intents/pay', { body: { destination: 'G' } });
    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.body).toEqual({ destination: 'G' });
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const { fn, calls } = fakeFetch([
      [429, { message: 'slow down' }, { 'retry-after': '1' }],
      [503, { message: 'unavailable' }],
      [200, { done: true }],
    ]);
    const waits: Array<[number, string | null]> = [];
    const api = new CosmosPayApi(config, { fetch: fn, delay: (attempt, retryAfter) => (waits.push([attempt, retryAfter]), 0) });
    await expect(api.request('GET', '/summary')).resolves.toEqual({ done: true });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([
      [0, '1'],
      [1, null],
    ]);
  });

  it('turns an error answer into an ApiError with the API code and message', async () => {
    const { fn } = fakeFetch([[400, { code: 'invalid_state_transition', message: ['amount must be positive', 'chain is invalid'] }]]);
    const error = await new CosmosPayApi(config, { fetch: fn }).request('GET', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_state_transition', message: 'amount must be positive; chain is invalid' });
  });

  it('never repeats the key, even when the API echoes it', async () => {
    const { fn } = fakeFetch([[401, { message: `invalid key ${KEY}` }]]);
    const error = await new CosmosPayApi(config, { fetch: fn }).request('GET', '/x').catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('reports a network failure after its retries', async () => {
    let calls = 0;
    const fn = (async () => {
      calls++;
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const error = await new CosmosPayApi(config, { fetch: fn, delay: () => 0 }).request('GET', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(calls).toBe(3);
  });
});
