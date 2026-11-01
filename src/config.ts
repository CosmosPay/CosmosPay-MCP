/* config.ts: what the server reads from its environment. The API key comes only from here: it is
   never a tool argument, never logged and never part of a result. Its prefix decides the network,
   as in the Payments API itself (`dv_` test networks, `prod_` mainnet). */

export type Network = 'testnet' | 'mainnet';

export interface Config {
  /** Secret API key from the Cosmos Pay dashboard (Developer Platform > API keys). */
  apiKey: string;
  /** Network the key works on, from its prefix. */
  network: Network;
  /** Payments API root, without the version (`/v1` is added per request). */
  apiUrl: string;
  /** Origin of the hosted checkout, `<checkoutUrl>/<payment id>`. */
  checkoutUrl: string;
  /** Only the tools that read are registered. */
  readOnly: boolean;
}

export const DEFAULT_API_URL = 'https://api.cosmospay.lat/cosmos-api';
export const DEFAULT_CHECKOUT_URL = 'https://payments.cosmospay.lat';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** The network a key works on, from its prefix; null for a value that is not a Cosmos Pay key. */
export function networkOf(apiKey: string): Network | null {
  if (/^dv_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return 'testnet';
  if (/^prod_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return 'mainnet';
  return null;
}

const TRUE = new Set(['1', 'true', 'yes', 'on']);

/* An override must be https, except a local server during development. */
function checkedUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a URL.`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ConfigError(`${name} must use https (http only for localhost).`);
  }
  return value.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = (env.COSMOS_PAY_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new ConfigError(
      'COSMOS_PAY_API_KEY is not set. Create a key in the Cosmos Pay dashboard (https://dev.cosmospay.lat, API keys): a dv_ key works on test networks, a prod_ key on mainnet.',
    );
  }
  const network = networkOf(apiKey);
  if (!network) {
    throw new ConfigError('COSMOS_PAY_API_KEY does not look like a Cosmos Pay secret key (it starts with dv_ or prod_).');
  }
  return {
    apiKey,
    network,
    apiUrl: env.COSMOS_PAY_API_URL ? checkedUrl('COSMOS_PAY_API_URL', env.COSMOS_PAY_API_URL) : DEFAULT_API_URL,
    checkoutUrl: env.COSMOS_PAY_CHECKOUT_URL
      ? checkedUrl('COSMOS_PAY_CHECKOUT_URL', env.COSMOS_PAY_CHECKOUT_URL)
      : DEFAULT_CHECKOUT_URL,
    readOnly: TRUE.has((env.COSMOS_PAY_READ_ONLY ?? '').trim().toLowerCase()),
  };
}
