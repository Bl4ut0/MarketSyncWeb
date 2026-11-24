import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../src/workers/snapshotWorker.js';

function makeRawBlock(timestamp: number, itemId: number, price: number) {
  return {
    version: '1',
    flavor: 'forever',
    timestamp,
    isoDate: new Date(timestamp * 1000).toISOString(),
    region: 'us',
    status: 'ok',
    rulesets: {
      pvp: {
        Alliance: {
          [String(itemId)]: {
            minPrice: price,
            maxPrice: price,
            totalQty: 5,
            listings: 2,
          },
        },
      },
    },
  };
}

describe('snapshotWorker cache & history eviction resilience', () => {
  const g = globalThis as unknown as {
    onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
    postMessage: (msg: WorkerResponse) => void;
    fetch: typeof fetch;
  };
  const origFetch = g.fetch;
  const origOnMessage = g.onmessage;
  const origPostMessage = g.postMessage;

  afterEach(() => {
    g.fetch = origFetch;
    g.onmessage = origOnMessage;
    g.postMessage = origPostMessage;
    vi.resetModules();
  });

  it('groups commodity and equipment rows by base ID while preserving variants and pet species', async () => {
    const blockPath = 'datasets/forever/2026-11-23/13-00.json';
    const block = makeRawBlock(1795441228, 647, 200);
    const rows = block.rulesets.pvp.Alliance;
    rows['647:5241'] = { minPrice: 100, maxPrice: 250, totalQty: 1, listings: 1 };
    rows['647:5248'] = { minPrice: 180, maxPrice: 220, totalQty: 3, listings: 3 };
    rows['2099'] = { minPrice: 500, maxPrice: 500, totalQty: 1, listings: 1 };
    rows['82800:40'] = { minPrice: 600, maxPrice: 600, totalQty: 1, listings: 1 };
    rows['82800:41'] = { minPrice: 700, maxPrice: 700, totalQty: 1, listings: 1 };
    g.fetch = (async (url) => String(url).includes('/catalog?')
      ? Response.json({
          version: 1, flavor: 'forever',
          items: {
            647: { name: 'Destiny', itemClass: 2, itemSubclass: 8 },
            2099: { itemClass: 2, itemSubclass: 3 },
          },
        })
      : Response.json(block)) as typeof fetch;
    await import('../src/workers/snapshotWorker.js');
    const send = (data: WorkerRequest): Promise<WorkerResponse> => new Promise((resolve) => {
      g.postMessage = resolve;
      g.onmessage?.({ data } as MessageEvent<WorkerRequest>);
    });
    const query = {
      reqId: 'grouped', type: 'QUERY_ENTRIES', path: blockPath, flavor: 'forever',
      partitionKey: 'pvp', faction: 'Alliance', search: '', quality: 'all',
      sortBy: 'minPrice', sortDir: 'asc', page: 1, pageSize: 25,
    } as const;
    const result = await send(query);
    expect(result).toMatchObject({
      ok: true, totalCount: 4,
      rows: [
        { itemKey: '647', name: 'Destiny', minPrice: 100, maxPrice: 250, totalQty: 9, listings: 6 },
        { itemKey: '2099', ahCategory: 'weapons', isFallback: true },
        { itemKey: '82800:40' },
        { itemKey: '82800:41' },
      ],
    });
    if (result.ok && result.type === 'QUERY_ENTRIES') {
      expect(result.rows[0]?.variants?.map((row) => row.itemKey)).toEqual(['647', '647:5241', '647:5248']);
      expect(result.categoryCounts.weapons).toBe(2);
    }
    const exact = await send({ ...query, search: '"Destiny"' });
    expect(exact).toMatchObject({ ok: true, totalCount: 1, rows: [{ itemKey: '647', totalQty: 9 }] });
    const variant = await send({ ...query, search: '#647:5248' });
    expect(variant).toMatchObject({ ok: true, totalCount: 1, rows: [{ itemKey: '647:5248', totalQty: 3 }] });
    const history = await send({
      reqId: 'grouped_history', type: 'GET_ITEM_HISTORY',
      blocks: [{ path: blockPath, flavor: 'forever' }], partitionKey: 'pvp',
      faction: 'Alliance', itemKey: '647', groupedItemId: 647,
    });
    expect(history).toMatchObject({ ok: true, points: [{ minPrice: 100, maxPrice: 250, totalQty: 9, listings: 6 }] });
  });

  it('keeps active snapshot queryable after GET_ITEM_HISTORY loads 24 blocks and handles cache misses transparently', async () => {
    const blocks = Array.from({ length: 24 }, (_, idx) => {
      const hour = String(23 - idx).padStart(2, '0');
      const path = `datasets/forever/2026-11-22/${hour}-00.json`;
      return {
        path,
        flavor: 'forever' as const,
        raw: makeRawBlock(1795380000 - idx * 3600, 13464, 10000 + idx * 100),
      };
    });

    const blockMap = new Map(blocks.map((b) => [b.path, b.raw]));
    let fetchCount = 0;

    g.fetch = (async (input: RequestInfo | URL) => {
      fetchCount += 1;
      const urlStr = typeof input === 'string' ? input : input.toString();
      const parsed = new URL(urlStr, 'http://localhost');
      const path = parsed.searchParams.get('path') ?? '';
      const data = blockMap.get(path);
      if (!data) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const pending = new Map<string, (msg: WorkerResponse) => void>();
    g.postMessage = (msg: WorkerResponse) => {
      const resolver = pending.get(msg.reqId);
      if (resolver) {
        pending.delete(msg.reqId);
        resolver(msg);
      }
    };

    await import('../src/workers/snapshotWorker.js');

    const send = (req: WorkerRequest): Promise<WorkerResponse> =>
      new Promise((resolve) => {
        pending.set(req.reqId, resolve);
        g.onmessage?.({ data: req } as MessageEvent<WorkerRequest>);
      });

    const activePath = blocks[0]!.path;
    const loadRes = await send({
      reqId: 'req_load',
      type: 'LOAD_SNAPSHOT',
      path: activePath,
      flavor: 'forever',
    });
    expect(loadRes.ok).toBe(true);

    const beforeQuery = await send({
      reqId: 'req_q1',
      type: 'QUERY_ENTRIES',
      path: activePath,
      partitionKey: 'pvp',
      faction: 'Alliance',
      search: '',
      quality: 'all',
      sortBy: 'minPrice',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
    });
    expect(beforeQuery.ok).toBe(true);
    if (beforeQuery.ok && beforeQuery.type === 'QUERY_ENTRIES') {
      expect(beforeQuery.totalCount).toBe(1);
    }

    const histRes = await send({
      reqId: 'req_hist',
      type: 'GET_ITEM_HISTORY',
      blocks: blocks.map((b) => ({ path: b.path, flavor: b.flavor })),
      partitionKey: 'pvp',
      faction: 'Alliance',
      itemKey: '13464',
    });
    expect(histRes.ok).toBe(true);
    if (histRes.ok && histRes.type === 'GET_ITEM_HISTORY') {
      expect(histRes.points).toHaveLength(24);
    }

    const fetchesBeforeQuery2 = fetchCount;
    const afterQuery = await send({
      reqId: 'req_q2',
      type: 'QUERY_ENTRIES',
      path: activePath,
      partitionKey: 'pvp',
      faction: 'Alliance',
      search: '',
      quality: 'all',
      sortBy: 'minPrice',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
    });
    expect(afterQuery.ok).toBe(true);
    if (afterQuery.ok && afterQuery.type === 'QUERY_ENTRIES') {
      expect(afterQuery.totalCount).toBe(1);
      expect(afterQuery.rows[0]?.itemId).toBe(13464);
    }
    // Active block stayed pinned in memCache, so no refetch was even needed
    expect(fetchCount).toBe(fetchesBeforeQuery2);

    // A new item in the same market reuses the cached projections, including
    // captures that were never loaded in the browsing UI.
    const recentMarkets = blocks.slice(-10);
    const fetchesBeforeRepeat = fetchCount;
    const otherHistory = await send({
      reqId: 'req_other_item',
      type: 'GET_ITEM_HISTORY',
      blocks: recentMarkets,
      partitionKey: 'pvp',
      faction: 'Alliance',
      itemKey: '13465',
    });
    expect(otherHistory).toMatchObject({ ok: true, points: [], failedBlocks: 0 });
    expect(fetchCount).toBe(fetchesBeforeRepeat);

    // Querying an unpinned evicted block transparently re-fetches instead of returning 0
    const evictedPath = blocks[1]!.path;
    const missQuery = await send({
      reqId: 'req_q3',
      type: 'QUERY_ENTRIES',
      path: evictedPath,
      partitionKey: 'pvp',
      faction: 'Alliance',
      search: '',
      quality: 'all',
      sortBy: 'minPrice',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
    });
    expect(missQuery.ok).toBe(true);
    if (missQuery.ok && missQuery.type === 'QUERY_ENTRIES') {
      expect(missQuery.totalCount).toBe(1);
    }

    let requestStarted!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => { requestStarted = resolve; });
    g.fetch = (_input, init) => new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('Expected a cancellable fetch'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      requestStarted(signal);
    });
    const pendingHistory = send({
      reqId: 'req_cancel',
      type: 'GET_ITEM_HISTORY',
      blocks: [{ path: 'datasets/forever/2026-11-23/00-00.json', flavor: 'forever' }],
      partitionKey: 'pvp',
      faction: 'Alliance',
      itemKey: '13464',
    });
    const signal = await started;
    g.onmessage?.({
      data: { reqId: 'req_cancel', type: 'CANCEL_ITEM_HISTORY' },
    } as MessageEvent<WorkerRequest>);
    expect(signal.aborted).toBe(true);
    expect(await pendingHistory).toMatchObject({ ok: true, points: [], failedBlocks: 0 });
  });

  it('uses compact market analytics and preserves raw fallback and variant totals', async () => {
    const currentPath = 'datasets/forever/2026-11-23/13-00.json';
    const historicPath = 'datasets/forever/2026-11-23/12-00.json';
    const timestamp = 1795437600;
    const shardPath = `datasets/forever/2026-11-23/analytics-v1/12-${timestamp}/pvp/Alliance.json`;
    const current = makeRawBlock(timestamp + 3600, 647, 200);
    const historical = makeRawBlock(timestamp, 647, 150);
    current.rulesets.pvp.Alliance['647:5241'] = { minPrice: 180, maxPrice: 180, totalQty: 3, listings: 2 };
    historical.rulesets.pvp.Alliance['647:5248'] = { minPrice: 100, maxPrice: 100, totalQty: 2, listings: 1 };
    const requested: string[] = [];
    let shardAvailable = true;
    g.fetch = (async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.searchParams.get('path');
      if (path) requested.push(path);
      if (path === currentPath) return Response.json(current);
      if (path === historicPath) return Response.json(historical);
      if (path === shardPath && shardAvailable) {
        return Response.json({
          version: 1,
          timestamp,
          exact: { 647: [150, 5], '647:5248': [100, 2] },
          grouped: { 647: [100, 7] },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;
    await import('../src/workers/snapshotWorker.js');
    const send = (data: WorkerRequest): Promise<WorkerResponse> => new Promise((resolve) => {
      g.postMessage = resolve;
      g.onmessage?.({ data } as MessageEvent<WorkerRequest>);
    });
    const request = {
      reqId: 'analytics',
      type: 'COMPUTE_MARKET_ANALYTICS',
      currentPath,
      flavor: 'forever',
      blocks: [
        { path: currentPath, flavor: 'forever', timestamp: current.timestamp, analyticsReady: true },
        { path: historicPath, flavor: 'forever', timestamp, analyticsReady: true },
      ],
      partitionKey: 'pvp',
      faction: 'Alliance',
    } satisfies WorkerRequest;
    const compact = await send(request);
    expect(requested).toEqual([currentPath, shardPath]);
    expect(compact).toMatchObject({
      ok: true,
      analytics: {
        macro: { sampledCaptures: 2 },
        gainers: [{ row: { itemKey: '647' }, baselinePrice: 100, baselineQty: 7, observations: 2 }],
      },
    });

    shardAvailable = false;
    requested.length = 0;
    const fallback = await send(request);
    expect(requested).toEqual([shardPath, historicPath]);
    expect(fallback).toEqual(compact);
  });
});
