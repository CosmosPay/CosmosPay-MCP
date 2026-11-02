/* api.ts: a small client for the Cosmos Pay Payments API (https://dev.cosmospay.lat/docs/api/).
   The SDK (@cosmosapp/pay_sdk) types payment intents for Stellar only, while the REST API takes
   `chain` on every route this server uses, so the server talks to the API directly. Same headers,
   retries and error shape as the SDK. */
import type { Config } from '@/config';

declare const __VERSION__: string;
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
}

/** An answer of the API other than 2xx. Its message never holds the API key. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** The API could not be reached (network, DNS, timeout). */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface ApiOptions {
  fetch?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
  /** Milliseconds to wait before retry `attempt` (0-based), given the Retry-After header. */
  delay?: (attempt: number, retryAfter: string | null) => number;
}

function defaultDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 4_000);
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(status: number, body: unknown): { code: string | undefined; message: string } {
  if (body && typeof body === 'object') {
    const b = body as { code?: unknown; message?: unknown; error?: unknown };
    const raw = b.message ?? b.error;
    const message = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : `HTTP ${status}`;
    return { code: typeof b.code === 'string' ? b.code : undefined, message };
  }
  return { code: undefined, message: typeof body === 'string' && body ? body.slice(0, 300) : `HTTP ${status}` };
}

export class CosmosPayApi {
  private readonly fetchFn: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly delay: (attempt: number, retryAfter: string | null) => number;

  constructor(
    private readonly config: Pick<Config, 'apiKey' | 'apiUrl'>,
    options: ApiOptions = {},
  ) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.retries = options.retries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.delay = options.delay ?? defaultDelay;
  }

  url(path: string, query?: Query): string {
    const url = new URL(`${this.config.apiUrl}/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      apikey: this.config.apiKey,
      'User-Agent': `@cosmosapp/pay_mcp/${VERSION}`,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    const url = this.url(path, options.query);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (error) {
        if (attempt < this.retries) {
          await sleep(this.delay(attempt, null));
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new NetworkError(`Could not reach the Cosmos Pay API (${reason}).`);
      }
      if (response.ok) return (await parse(response)) as T;
      if (RETRYABLE.has(response.status) && attempt < this.retries) {
        await sleep(this.delay(attempt, response.headers.get('retry-after')));
        continue;
      }
      const { code, message } = messageOf(response.status, await parse(response));
      throw new ApiError(response.status, code, message.split(this.config.apiKey).join('[api key]'));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
