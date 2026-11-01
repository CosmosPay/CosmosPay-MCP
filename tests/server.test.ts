import { describe, expect, it } from 'vitest';
import { INTENT, KEY, config, connect, fakeFetch } from '@tests/helpers';

const WRITE_TOOLS = ['create_payment_link', 'validate_payment', 'delete_payment'];
const READ_TOOLS = ['get_payment', 'get_payment_history', 'list_payments', 'get_summary', 'get_balances', 'list_stellar_assets'];

type Text = { type: 'text'; text: string };

describe('tools', () => {
  it('offers the payment and read tools, each with the right hints', async () => {
    const client = await connect(config(), fakeFetch([]).fn);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.annotations?.readOnlyHint ?? false, tool.name).toBe(READ_TOOLS.includes(tool.name));
    }
    expect(tools.find((t) => t.name === 'delete_payment')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_payment_link')?.annotations?.destructiveHint).toBe(false);
  });

  it('read-only mode offers only the tools that read', async () => {
    const client = await connect(config({ readOnly: true }), fakeFetch([]).fn);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
  });

  it('tells the model which network it is on, and what the product is', async () => {
    const client = await connect(config(), fakeFetch([]).fn);
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/test networks/);
    expect(instructions).toMatch(/not the Cosmos Network/);
    const live = await connect(config({ network: 'mainnet', apiKey: 'prod_abcdefgh1234' }), fakeFetch([]).fn);
    expect(live.getInstructions()).toMatch(/real funds/);
  });
});

describe('create_payment_link', () => {
  it('maps its arguments to the API body and returns the link and the checkout', async () => {
    const { fn, calls } = fakeFetch([[201, INTENT]]);
    const client = await connect(config(), fn);
    const result = await client.callTool({
      name: 'create_payment_link',
      arguments: { destination: 'GDESTINATION', amount: '25', asset_code: 'USDC', asset_issuer: 'GISSUER', message: 'Order #1001', chain: 'stellar' },
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.test/cosmos-api/v1/payment-intents/pay');
    expect(calls[0]?.body).toEqual({ chain: 'stellar', destination: 'GDESTINATION', amount: '25', assetCode: 'USDC', assetIssuer: 'GISSUER', msg: 'Order #1001' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'pi_123',
      status: 'PENDING',
      paymentUri: INTENT.uri,
      checkoutUrl: 'https://pay.example.test/pi_123',
      network: 'testnet',
    });
    const content = result.content as Array<Text | { type: string }>;
    expect(content).toHaveLength(1);
    expect((content[0] as Text).text).toMatch(/^Created payment pi_123 for 25 USDC on stellar \(testnet\)/);
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('adds the QR as an image only when asked', async () => {
    const { fn } = fakeFetch([[201, INTENT]]);
    const client = await connect(config(), fn);
    const result = await client.callTool({ name: 'create_payment_link', arguments: { destination: 'G', include_qr: true } });
    expect(result.content).toContainEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  });

  it('refuses a malformed amount before calling the API', async () => {
    const { fn, calls } = fakeFetch([]);
    const client = await connect(config(), fn);
    const result = await client.callTool({ name: 'create_payment_link', arguments: { destination: 'G', amount: '-5' } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('returns an API refusal as a tool error with a hint, never the key', async () => {
    const { fn } = fakeFetch([[403, { code: 'forbidden', message: 'missing scope payment_intents:create' }]]);
    const client = await connect(config(), fn);
    const result = await client.callTool({ name: 'create_payment_link', arguments: { destination: 'G' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Text[])[0]?.text ?? '';
    expect(text).toMatch(/403 \(forbidden\): missing scope/);
    expect(text).toMatch(/permission/);
    expect(text).not.toContain(KEY);
  });
});

describe('reading payments', () => {
  it('list_payments passes its filters and pages', async () => {
    const { fn, calls } = fakeFetch([[200, { data: [INTENT], total: 41, take: 20, skip: 20 }]]);
    const client = await connect(config(), fn);
    const result = await client.callTool({ name: 'list_payments', arguments: { status: 'SUCCEEDED', chain: 'solana', skip: 20 } });
    expect(calls[0]?.url).toBe('https://api.example.test/cosmos-api/v1/payment-intents?status=SUCCEEDED&chain=solana&take=20&skip=20');
    expect(result.structuredContent).toMatchObject({ total: 41, skip: 20, payments: [{ id: 'pi_123', checkoutUrl: 'https://pay.example.test/pi_123' }] });
  });

  it('refuses an id that could leave the payment route, before any request', async () => {
    const { fn, calls } = fakeFetch([]);
    const client = await connect(config(), fn);
    for (const bad of ['..', '../summary', 'pi_1/transitions', 'pi 1', '%2e%2e', '']) {
      for (const name of ['get_payment', 'get_payment_history', 'delete_payment']) {
        const result = await client.callTool({ name, arguments: { id: bad } });
        expect(result.isError, `${name} ${bad}`).toBe(true);
      }
      const result = await client.callTool({ name: 'validate_payment', arguments: { id: bad, tx_hash: 'abc' } });
      expect(result.isError, `validate_payment ${bad}`).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });

  it('validate_payment and delete_payment call their routes', async () => {
    const { fn, calls } = fakeFetch([
      [200, { valid: true }],
      [200, { deleted: true }],
    ]);
    const client = await connect(config(), fn);
    await client.callTool({ name: 'validate_payment', arguments: { id: 'pi_123', tx_hash: 'abc' } });
    await client.callTool({ name: 'delete_payment', arguments: { id: 'pi_123' } });
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.example.test/cosmos-api', '')}`)).toEqual([
      'POST /v1/payment-intents/pi_123/validate',
      'DELETE /v1/payment-intents/pi_123',
    ]);
    expect(calls[0]?.body).toEqual({ txHash: 'abc' });
  });

  it('list_stellar_assets defaults to the key’s network', async () => {
    const { fn, calls } = fakeFetch([
      [200, { assets: [] }],
      [200, { assets: [] }],
    ]);
    await (await connect(config(), fn)).callTool({ name: 'list_stellar_assets', arguments: {} });
    await (await connect(config({ network: 'mainnet', apiKey: 'prod_abcdefgh1234' }), fn)).callTool({ name: 'list_stellar_assets', arguments: { verified_only: true } });
    expect(calls[0]?.url).toMatch(/\/v1\/assets\?network=testnet$/);
    expect(calls[1]?.url).toMatch(/\/v1\/assets\?network=public&verified=true$/);
  });
});
