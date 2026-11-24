import { afterEach, expect, it, vi } from 'vitest';
import { normalizeSnapshot, parseDatasetIndex } from '@marketsync/shared';
import { enrichEntry, groupAuctionVariants } from '../src/lib/auctionRows.js';
import { analyzeMarket, indexMarketObservations } from '../src/lib/marketAnalytics.js';
import {
  getCachedAnalytics, loadPreparedAnalytics, packAnalyticsReport,
} from '../src/lib/preparedAnalytics.js';

afterEach(() => vi.unstubAllGlobals());

it('loads a full report for each faction and switches sectors from the cached report', async () => {
  const timestamp = 1795485968;
  const entry = (price: number, totalQty: number) => ({
    minPrice: price, maxPrice: price, totalQty, listings: 2,
  });
  const raw = {
    timestamp, flavor: 'forever', rulesets: {
      pvp: {
        Alliance: { '647': entry(800, 3), '12360': entry(62, 43) },
        Horde: { '647': entry(950, 11), '12360': entry(74, 60) },
        Neutral: { '647': entry(410, 1), '12360': entry(52, 22) },
      },
    },
  };
  const normalized = normalizeSnapshot(raw, 'forever');
  const manifest = {
    revision: '241ca88fdd338835650b9248',
    partitions: [{ key: 'pvp', label: 'PvP', entryCount: 6, factions: ['Alliance', 'Horde', 'Neutral'] }],
  };
  const { latestLiveByFlavor } = parseDatasetIndex({ blocks: [{
    path: 'datasets/forever/2026-11-24/02-00.json', date: '2026-11-24', hour: '02',
    timestamp, flavor: 'forever', items: 6, volume: 140, analytics: manifest,
  }] });
  const block = latestLiveByFlavor.forever!;
  const reports = new Map();
  for (const [faction, entries] of Object.entries(normalized.partitions.pvp!.factions)) {
    const catalog = {
      647: { name: 'Destiny', itemClass: 2, itemSubclass: 8 },
      12360: { name: 'Arcanite Bar', itemClass: 7, itemSubclass: 0 },
    };
    const rows = groupAuctionVariants(Object.values(entries).map((item) =>
      enrichEntry(item, 'forever', catalog[item.itemId as keyof typeof catalog])));
    const analysis = analyzeMarket(rows, [indexMarketObservations(timestamp, entries)], 'forever');
    reports.set(faction, packAnalyticsReport(timestamp, analysis.categories, analysis.view));
  }
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'https://marketsync.test');
    const path = url.searchParams.get('path')!.split('/');
    return Response.json(reports.get(path.at(-2)));
  });
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  for (const [faction, totalUnits] of [['Alliance', 46], ['Horde', 71], ['Neutral', 23]] as const) {
    const all = await loadPreparedAnalytics(block, 'pvp', faction, 24, 'all', signal);
    expect(all?.macro.totalUnits).toBe(totalUnits);
    const weapons = getCachedAnalytics(block, 'pvp', faction, 24, 'weapons');
    expect(weapons?.blockMapByGold.map(({ row }) => row.itemKey)).toEqual(['647']);
    const trade = getCachedAnalytics(block, 'pvp', faction, 24, 'trade-goods');
    expect(trade?.blockMapByGold.map(({ row }) => row.itemKey)).toEqual(['12360']);
    expect(trade?.macro.uniqueItems).toBe(1);
  }
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(String(fetch.mock.calls[0]![0])).toContain(encodeURIComponent(
    `datasets/analytics/v2/forever/${manifest.revision}/pvp/Alliance/24.json`,
  ));
});
