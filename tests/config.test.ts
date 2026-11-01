import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_API_URL, DEFAULT_CHECKOUT_URL, loadConfig, networkOf } from '@/config';

describe('networkOf', () => {
  it('reads the network from the key prefix, as the Payments API does', () => {
    expect(networkOf('dv_abcdefgh1234')).toBe('testnet');
    expect(networkOf('prod_abcdefgh1234')).toBe('mainnet');
  });
  it('refuses anything that is not a Cosmos Pay secret key', () => {
    for (const key of ['', 'sk_live_abcdefgh', 'dv_', 'dv_short', 'prod_ spaced key', 'DV_abcdefgh1234']) expect(networkOf(key)).toBeNull();
  });
});

describe('loadConfig', () => {
  it('needs a key and says where to get one', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/dev\.cosmospay\.lat/);
    expect(() => loadConfig({ COSMOS_PAY_API_KEY: 'not-a-key' })).toThrow(/dv_ or prod_/);
  });

  it('never repeats the key in an error', () => {
    try {
      loadConfig({ COSMOS_PAY_API_KEY: 'secret-value-123' });
    } catch (error) {
      expect(String(error)).not.toContain('secret-value-123');
    }
  });

  it('uses the production API and checkout by default', () => {
    const config = loadConfig({ COSMOS_PAY_API_KEY: 'prod_abcdefgh1234' });
    expect(config).toEqual({
      apiKey: 'prod_abcdefgh1234',
      network: 'mainnet',
      apiUrl: DEFAULT_API_URL,
      checkoutUrl: DEFAULT_CHECKOUT_URL,
      readOnly: false,
    });
  });

  it('turns read-only mode on with the usual truthy words', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(loadConfig({ COSMOS_PAY_API_KEY: 'dv_abcdefgh1234', COSMOS_PAY_READ_ONLY: value }).readOnly).toBe(true);
    }
    for (const value of ['', '0', 'false', 'no']) {
      expect(loadConfig({ COSMOS_PAY_API_KEY: 'dv_abcdefgh1234', COSMOS_PAY_READ_ONLY: value }).readOnly).toBe(false);
    }
  });

  it('takes https overrides, and http only for a local server', () => {
    const env = { COSMOS_PAY_API_KEY: 'dv_abcdefgh1234' };
    expect(loadConfig({ ...env, COSMOS_PAY_API_URL: 'https://gateway.example.com/api/' }).apiUrl).toBe('https://gateway.example.com/api');
    expect(loadConfig({ ...env, COSMOS_PAY_API_URL: 'http://localhost:3000' }).apiUrl).toBe('http://localhost:3000');
    expect(() => loadConfig({ ...env, COSMOS_PAY_API_URL: 'http://gateway.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...env, COSMOS_PAY_CHECKOUT_URL: 'not a url' })).toThrow(/not a URL/);
  });
});
