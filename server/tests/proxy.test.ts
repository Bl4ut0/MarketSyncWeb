import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDatasetIndexContract,
  assertItemsMetadataContract,
  assertSnapshotBlockContract,
} from '../../e2e/src/contracts.mjs';
import {
  startMockDataServer,
  type MockDataServer,
} from '../../e2e/src/mocks/mock-data-server.mjs';
import { createApp } from '../src/app.js';
import { NullEmailAdapter } from '../src/notifications/email.js';
import {
  InvalidSnapshotPathError,
  validateSnapshotPath,
  type EdgeCache,
} from '../src/proxy.js';
import { NullStorageAdapter } from '../src/storage/null.js';

describe('Proxy, SSRF Validation, Raw Streaming & /api/items', () => {
  let mockData: MockDataServer;

  beforeAll(async () => {
    mockData = await startMockDataServer();
  });

  afterAll(async () => {
    await mockData.close();
  });

  beforeEach(() => {
    mockData.reset();
    mockData.clearRequests();
  });

  it('looks up items in the selected Wowhead edition and keeps only item IDs and names', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      results: [
        { type: 3, id: 2725, name: 'Green Hills of Stranglethorn - Page 1', description: 'Not exposed' },
        { type: 5, id: 1, name: 'Quest result' },
      ],
    }));
    const app = createApp({
      mode: 'cloudflare', storage: new NullStorageAdapter(), emailAdapter: new NullEmailAdapter(), fetchImpl,
    });

    const response = await app.request('/api/items/search?flavor=forever&q=green+hills');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: 2725, name: 'Green Hills of Stranglethorn - Page 1' }] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://www.wowhead.com/forever/search/suggestions-template?q=green+hills');
  });

  it('accepts valid dataset paths under datasets/', () => {
    expect(validateSnapshotPath('datasets/2026-11-22/07-00.json')).toBe(
      'datasets/2026-11-22/07-00.json',
    );
    expect(validateSnapshotPath('datasets/forever/2026-11-22/08-00.json')).toBe(
      'datasets/forever/2026-11-22/08-00.json',
    );
    expect(
      validateSnapshotPath('datasets/classicEra/2026-11-22/09-00.json'),
    ).toBe('datasets/classicEra/2026-11-22/09-00.json');
    expect(validateSnapshotPath('datasets/forever/large/00-00.json')).toBe(
      'datasets/forever/large/00-00.json',
    );
  });

  it('rejects SSRF, traversal, schemes, encoded chars, and non-json paths', () => {
    const badPaths = [
      '',
      '../etc/passwd.json',
      'datasets/../secret.json',
      'datasets/forever/../../etc/passwd.json',
      'datasets\\forever\\08-00.json',
      'https://evil.example/datasets/forever/08-00.json',
      'http://127.0.0.1/datasets/08-00.json',
      'file:///etc/passwd.json',
      'datasets/forever/%2e%2e/08-00.json',
      'datasets/forever/08-00.json?token=abc',
      'datasets/forever/08-00.json#hash',
      'datasets/forever//08-00.json',
      '/datasets/forever/08-00.json',
      'datasets/forever/.hidden.json',
      'datasets/forever/08-00.txt',
      'other/forever/08-00.json',
    ];

    for (const bad of badPaths) {
      expect(() => validateSnapshotPath(bad)).toThrow(InvalidSnapshotPathError);
    }
  });

  it('proxies datasets/index.json and normalizes Content-Type to application/json', async () => {
    const cacheableFetch: typeof fetch = async (input, init) => {
      const upstream = await fetch(input, init);
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    };

    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      fetchImpl: cacheableFetch,
      edgeCache: null,
    });

    const res = await app.request('http://localhost/api/datasets/index.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const body = await res.json();
    assertDatasetIndexContract(body);
  });

  it('streams 9.5+ MB snapshot raw WITHOUT calling JSON.parse() on the server', async () => {
    const cacheableFetch: typeof fetch = async (input, init) => {
      const upstream = await fetch(input, init);
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    };

    const parseSpy = vi.spyOn(JSON, 'parse');
    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      fetchImpl: cacheableFetch,
      edgeCache: null,
    });

    const res = await app.request(
      'http://localhost/api/datasets/snapshot?path=datasets/forever/large/00-00.json',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');

    const rawText = await res.text();
    expect(Buffer.byteLength(rawText, 'utf8')).toBeGreaterThanOrEqual(9_500_000);
    // Proxy handler must not invoke JSON.parse() while streaming
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();

    const parsed = JSON.parse(rawText);
    assertSnapshotBlockContract(parsed);
  });

  it('uses Edge Cache (caches.default) on repeat snapshot requests', async () => {
    const cacheStore = new Map<string, Response>();
    const edgeCache: EdgeCache = {
      async match(req) {
        const key = typeof req === 'string' ? req : req.url;
        return cacheStore.get(key)?.clone();
      },
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        cacheStore.set(key, res);
      },
    };

    const cacheableFetch: typeof fetch = async (input, init) => {
      const upstream = await fetch(input, init);
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    };

    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      fetchImpl: cacheableFetch,
      edgeCache,
    });

    const url =
      'http://localhost/api/datasets/snapshot?path=datasets/retail/2026-11-22/09-00.json';
    const r1 = await app.request(url);
    expect(r1.status).toBe(200);
    await r1.text();
    expect(mockData.getRequests().length).toBe(1);

    const r2 = await app.request(url);
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    assertSnapshotBlockContract(body2);
    // Second request served from edge cache without hitting upstream
    expect(mockData.getRequests().length).toBe(1);
  });

  it('does NOT cache upstream responses with Cache-Control: no-store in Edge Cache', async () => {
    const cacheStore = new Map<string, Response>();
    const edgeCache: EdgeCache = {
      async match(req) {
        const key = typeof req === 'string' ? req : req.url;
        return cacheStore.get(key)?.clone();
      },
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        cacheStore.set(key, res);
      },
    };

    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      edgeCache,
    });

    const url =
      'http://localhost/api/datasets/snapshot?path=datasets/retail/2026-11-22/09-00.json';
    const r1 = await app.request(url);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('cache-control')).toBe('no-store');
    await r1.text();
    expect(mockData.getRequests().length).toBe(1);
    expect(cacheStore.size).toBe(0);

    const r2 = await app.request(url);
    expect(r2.status).toBe(200);
    expect(r2.headers.get('cache-control')).toBe('no-store');
    await r2.text();
    expect(mockData.getRequests().length).toBe(2);
  });

  it('preserves Cache-Control: no-store downstream when upstream sends X-Mock-No-Cache: 1', async () => {
    const cacheStore = new Map<string, Response>();
    const edgeCache: EdgeCache = {
      async match() {
        return undefined;
      },
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        cacheStore.set(key, res);
      },
    };

    const noCacheHeaderFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=300',
          'X-Mock-No-Cache': '1',
        },
      });

    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      fetchImpl: noCacheHeaderFetch,
      edgeCache,
    });

    const res = await app.request(
      'http://localhost/api/datasets/snapshot?path=datasets/retail/2026-11-22/09-00.json',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(cacheStore.size).toBe(0);
  });

  it('returns 400 JSON for unsafe snapshot path and 404 JSON for missing upstream file', async () => {
    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      edgeCache: null,
    });

    const badRes = await app.request(
      'http://localhost/api/datasets/snapshot?path=datasets/../secret.json',
    );
    expect(badRes.status).toBe(400);
    const badJson = (await badRes.json()) as { error: string };
    expect(badJson.error).toBe('invalid_snapshot_path');

    const missingRes = await app.request(
      'http://localhost/api/datasets/snapshot?path=datasets/forever/2099-01-01/00-00.json',
    );
    expect(missingRes.status).toBe(404);
    const missingJson = (await missingRes.json()) as { error: string };
    expect(missingJson.error).toBe('dataset_not_found');
  });

  it('resolves item metadata for plain, suffixed, pet cage, i:-prefixed, and fallback IDs', async () => {
    const app = createApp({
      mode: 'cloudflare',
      storage: new NullStorageAdapter(),
      emailAdapter: new NullEmailAdapter(),
      dataBaseUrl: mockData.rawBaseUrl,
      edgeCache: null,
    });

    const res = await app.request(
      'http://localhost/api/items?ids=13464,13005:4512,82800:48213,i:13444,999999',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { name: string; isFallback: boolean }>;
    assertItemsMetadataContract(body);

    expect(body['13464']?.name).toBe('Golden Sansam');
    expect(body['13005:4512']?.name).toContain("Amy's Blanket");
    expect(body['82800:48213']?.name).toBe('Direhorn Runt');
    expect(body['13444']?.name).toBe('Major Mana Potion');
    expect(body['i:13444']?.name).toBe('Major Mana Potion');
    expect(body['999999']?.name).toBe('#999999');
    expect(body['999999']?.isFallback).toBe(true);

    const invalid = await app.request('http://localhost/api/items?ids=not-valid');
    expect(invalid.status).toBe(400);

    const mixed = await app.request(
      'http://localhost/api/items?ids=13464,13464,invalid_id,82800:48213',
    );
    expect(mixed.status).toBe(200);
    const mixedBody = (await mixed.json()) as Record<string, { name: string }>;
    assertItemsMetadataContract(mixedBody);
    expect(mixedBody['13464']?.name).toBe('Golden Sansam');
    expect(mixedBody['82800:48213']?.name).toBe('Direhorn Runt');
    expect(mixedBody['invalid_id']).toBeUndefined();
  });
});
