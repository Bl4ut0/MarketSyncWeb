import {
  getWowheadEnvForFlavor,
  resolveItemMetadata,
  type FlavorId,
  type ItemMetadata,
  type WowheadItemMatch,
} from '@marketsync/shared';

export const DEFAULT_DATA_BASE_URL =
  'https://raw.githubusercontent.com/Bl4ut0/MarketSyncData/master';

const ALLOWED_PATH_CHARS_RE = /^datasets\/[a-zA-Z0-9._/-]+\.json$/;
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface EdgeCache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

export interface CfExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface ProxyOptions {
  dataBaseUrl?: string;
  fetchImpl?: typeof fetch;
  edgeCache?: EdgeCache | null;
  executionCtx?: CfExecutionContext | null;
  requestUrl?: string;
}

export class InvalidSnapshotPathError extends Error {
  readonly status = 400;
  readonly code = 'invalid_snapshot_path';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidSnapshotPathError';
  }
}

export function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_DATA_BASE_URL).trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Strict SSRF-safe validation for snapshot paths under `datasets/`.
 * Rejects traversal (`..`), backslashes, URL schemes, query/fragments, encoded chars (`%`), and empty segments.
 */
export function validateSnapshotPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new InvalidSnapshotPathError('Missing required "path" query parameter.');
  }
  if (rawPath.length > 256) {
    throw new InvalidSnapshotPathError('Snapshot path exceeds maximum length.');
  }
  if (
    rawPath.includes('..') ||
    rawPath.includes('\\') ||
    rawPath.includes('%') ||
    rawPath.includes('?') ||
    rawPath.includes('#') ||
    rawPath.includes(':') ||
    rawPath.includes('@') ||
    rawPath.includes('//') ||
    !ALLOWED_PATH_CHARS_RE.test(rawPath)
  ) {
    throw new InvalidSnapshotPathError(
      `Invalid or unsafe snapshot path: "${rawPath}"`,
    );
  }

  const segments = rawPath.split('/');
  if (segments.length < 2 || segments[0] !== 'datasets') {
    throw new InvalidSnapshotPathError(
      'Snapshot path must reside under "datasets/".',
    );
  }
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !SAFE_SEGMENT_RE.test(seg)) {
      throw new InvalidSnapshotPathError(
        `Invalid segment "${seg}" in snapshot path.`,
      );
    }
  }

  return rawPath;
}

export function resolveEdgeCache(
  explicit?: EdgeCache | null,
): EdgeCache | null {
  if (explicit !== undefined) return explicit;
  const globalCaches = (globalThis as { caches?: { default?: EdgeCache } })
    .caches;
  return globalCaches?.default ?? null;
}

async function fetchAndStreamJson(
  upstreamUrl: string,
  cacheControl: string,
  options: ProxyOptions,
): Promise<Response> {
  const fetchFn = options.fetchImpl ?? fetch;
  const edgeCache = resolveEdgeCache(options.edgeCache);
  const cacheKeyUrl = options.requestUrl ?? upstreamUrl;

  if (edgeCache) {
    const cached = await edgeCache.match(cacheKeyUrl);
    if (cached) {
      return cached;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Upstream fetch failed';
    return new Response(
      JSON.stringify({
        error: 'upstream_unreachable',
        message: `Failed to reach MarketSync data source: ${message}`,
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (!upstream.ok) {
    const status =
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    // Drain body cleanly to avoid leaking sockets in Node/CF
    try {
      await upstream.body?.cancel();
    } catch {
      // ignore
    }
    return new Response(
      JSON.stringify({
        error: status === 404 ? 'dataset_not_found' : 'upstream_error',
        status,
        message: `Upstream dataset returned HTTP ${upstream.status}`,
      }),
      {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const upstreamCacheControl =
    upstream.headers.get('cache-control')?.toLowerCase() ?? '';
  const bypassEdgeCache =
    upstreamCacheControl.includes('no-store') ||
    upstream.headers.get('x-mock-no-cache') === '1';

  // Stream raw body directly WITHOUT calling JSON.parse() or text() on 9-12 MB blocks
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', bypassEdgeCache ? 'no-store' : cacheControl);
  const etag = upstream.headers.get('etag');
  if (etag) headers.set('ETag', etag);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  const response = new Response(upstream.body, {
    status: 200,
    headers,
  });

  if (edgeCache && response.body && !bypassEdgeCache) {
    const cachePut = edgeCache.put(cacheKeyUrl, response.clone());
    if (options.executionCtx?.waitUntil) {
      options.executionCtx.waitUntil(cachePut);
    } else {
      await cachePut;
    }
  }

  return response;
}

export async function proxyDatasetIndex(
  options: ProxyOptions = {},
): Promise<Response> {
  const baseUrl = normalizeBaseUrl(options.dataBaseUrl);
  const upstreamUrl = `${baseUrl}/datasets/index.json`;
  return fetchAndStreamJson(
    upstreamUrl,
    'public, max-age=60, s-maxage=60',
    options,
  );
}

export async function proxySnapshotBlock(
  rawPath: unknown,
  options: ProxyOptions = {},
): Promise<Response> {
  const validPath = validateSnapshotPath(rawPath);
  const baseUrl = normalizeBaseUrl(options.dataBaseUrl);
  const upstreamUrl = `${baseUrl}/${validPath}`;
  return fetchAndStreamJson(
    upstreamUrl,
    'public, max-age=3600, s-maxage=3600',
    options,
  );
}

export async function proxyDatasetCatalog(flavor: FlavorId, options: ProxyOptions = {}): Promise<Response> {
  const baseUrl = normalizeBaseUrl(options.dataBaseUrl);
  const response = await fetchAndStreamJson(
    `${baseUrl}/datasets/${flavor}/catalog.json`,
    'public, max-age=300, s-maxage=300',
    options,
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=60' } });
  }
  return response;
}

export async function searchWowheadItems(
  name: string,
  flavor: FlavorId,
  fetchImpl: typeof fetch = fetch,
): Promise<WowheadItemMatch[]> {
  const { domainPath } = getWowheadEnvForFlavor(flavor);
  const url = new URL(`https://www.wowhead.com/${domainPath}search/suggestions-template`);
  url.searchParams.set('q', name);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Wowhead item search is unavailable.');
  const payload = await response.json() as {
    results?: Array<{ type?: number; id?: number; name?: string }>;
  } | null;
  if (!Array.isArray(payload?.results)) throw new Error('Invalid Wowhead item results.');

  const items = new Map<number, WowheadItemMatch>();
  for (const result of payload.results.slice(0, 50)) {
    if (result?.type !== 3 || typeof result.id !== 'number' ||
        !Number.isSafeInteger(result.id) || result.id <= 0 || typeof result.name !== 'string') {
      continue;
    }
    items.set(result.id, { id: result.id, name: result.name.slice(0, 200) });
  }
  return Array.from(items.values());
}

export function resolveItemsFromQuery(
  rawIds: string | string[] | undefined,
): Record<string, ItemMetadata> {
  const parts: string[] = [];
  if (Array.isArray(rawIds)) {
    for (const chunk of rawIds) {
      for (const token of chunk.split(',')) {
        const trimmed = token.trim();
        if (trimmed) parts.push(trimmed);
      }
    }
  } else if (typeof rawIds === 'string') {
    for (const token of rawIds.split(',')) {
      const trimmed = token.trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  if (parts.length > 500) {
    throw new Error('Too many item IDs requested (maximum 500 per request).');
  }

  const out: Record<string, ItemMetadata> = {};
  let firstError: unknown = null;
  for (const key of parts) {
    try {
      const meta = resolveItemMetadata(key);
      out[meta.itemKey] = meta;
      if (key !== meta.itemKey) {
        out[key] = meta;
      }
    } catch (err) {
      if (firstError === null) {
        firstError = err;
      }
    }
  }
  if (parts.length > 0 && Object.keys(out).length === 0 && firstError !== null) {
    throw firstError;
  }
  return out;
}
