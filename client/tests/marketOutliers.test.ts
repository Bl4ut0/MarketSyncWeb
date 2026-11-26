import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '@marketsync/shared';
import { enrichEntry, groupAuctionVariants } from '../src/lib/auctionRows.js';
import { analyzeMarket, findMarketOutliers, indexMarketObservations } from '../src/lib/marketAnalytics.js';
import { withoutOutliers } from '../src/lib/preparedAnalytics.js';

type Entry = { key: string; value: number; listings: number };
const find = (entries: Entry[]) => findMarketOutliers(entries, (e) => e.value, (e) => e.listings,
  entries.reduce((sum, e) => sum + e.value, 0)).map((e) => e.key);

describe('findMarketOutliers', () => {
  // Shapes taken from the Forever PvP captures of 26 Nov 2026 (values in gold).
  const market = (extra: Entry[]) => [
    ...extra,
    { key: 'arcanite', value: 9_288, listings: 246 },
    { key: 'salt', value: 9_125, listings: 213 },
    ...Array.from({ length: 200 }, (_, i) => ({ key: `item${i}`, value: 2_500, listings: 20 })),
  ];

  it('drops a single listing that dominates the market (Horde: 4,200,000g sword)', () => {
    expect(find(market([{ key: 'teebu', value: 4_200_000, listings: 1 }]))).toEqual(['teebu']);
  });

  it('keeps a pricey single listing that is a small share of the market (Alliance: 12,000g sword)', () => {
    expect(find(market([{ key: 'teebu', value: 12_000, listings: 1 }]))).toEqual([]);
  });

  it('keeps an item with many listings however valuable it is', () => {
    expect(find(market([{ key: 'bulk', value: 4_200_000, listings: 3 }]))).toEqual([]);
  });

  it('keeps a large single listing that does not dwarf the next item', () => {
    const small = [
      { key: 'a', value: 1_000, listings: 1 },
      { key: 'b', value: 400, listings: 1 },
      { key: 'c', value: 300, listings: 4 },
    ];
    expect(find(small)).toEqual([]);
  });

  it('can drop more than one stacked outlier, stopping at the first ordinary item', () => {
    expect(find(market([
      { key: 'troll1', value: 9_000_000, listings: 1 },
      { key: 'troll2', value: 1_500_000, listings: 2 },
    ]))).toEqual(['troll1', 'troll2']);
  });
});

describe('analyzeMarket outlier exclusion', () => {
  const timestamp = 1795485968;
  const entries = {
    '1728': { minPrice: 42_000_000_000, maxPrice: 42_000_000_000, totalQty: 1, listings: 1 },
    '12360': { minPrice: 360_000, maxPrice: 400_000, totalQty: 258, listings: 246 },
    '15409': { minPrice: 420_000, maxPrice: 450_000, totalQty: 215, listings: 213 },
  };

  it('leaves the outlier out of totals and lists and reports it', () => {
    const normalized = normalizeSnapshot({ timestamp, flavor: 'forever', rulesets: { pvp: { Horde: entries } } }, 'forever');
    const market = normalized.partitions.pvp!.factions.Horde!;
    const rows = groupAuctionVariants(Object.values(market).map((item) =>
      enrichEntry(item, 'forever', { name: `Item ${item.itemId}`, itemClass: 7, itemSubclass: 0 })));
    const view = analyzeMarket(rows, [indexMarketObservations(timestamp, market)], 'forever').view('all');
    expect(view.macro.totalMarketValue).toBe(360_000 * 258 + 420_000 * 215);
    expect(view.macro.uniqueItems).toBe(2);
    expect(view.blockMapByGold.map((it) => it.row.itemKey)).not.toContain('1728');
    expect(view.excludedOutliers).toEqual([expect.objectContaining({ itemKey: '1728', minPrice: 42_000_000_000, listings: 1 })]);
  });
});

describe('withoutOutliers (reports built before exclusion)', () => {
  it('subtracts the outlier from the view totals, sector totals and lists', () => {
    const outlier = {
      row: { itemKey: '1728', itemId: 1728, name: 'Teebu', minPrice: 100, totalQty: 1, listings: 1, ahCategory: 'weapons' },
      marketValueCopper: 100, priceChangePct: 0,
    };
    const other = { row: { itemKey: '2', itemId: 2, name: 'Other', listings: 5, ahCategory: 'armor' }, marketValueCopper: 10 };
    const payload = {
      macro: { totalMarketValue: 110, totalUnits: 6, totalListings: 6, uniqueItems: 2, sampledCaptures: 1,
        risingCount: 0, fallingCount: 0, stableCount: 2 },
      categories: [
        { id: 'weapons', label: 'Weapons', itemCount: 1, totalUnits: 1, totalMarketValue: 100, avgChangePct: 0 },
        { id: 'armor', label: 'Armor', itemCount: 1, totalUnits: 5, totalMarketValue: 10, avgChangePct: 0 },
      ],
      unhydratedItemIds: [],
      blockMapByGold: [outlier, other], blockMapByUnits: [other, outlier],
      gainers: [], deals: [], stableAnchors: [], volumeMovers: [outlier],
    } as never;
    const fixed = withoutOutliers(payload, [outlier as never], 'all');
    expect(fixed.macro).toMatchObject({ totalMarketValue: 10, totalUnits: 5, totalListings: 5, uniqueItems: 1, stableCount: 1 });
    expect(fixed.categories.find((c) => c.id === 'weapons')).toMatchObject({ itemCount: 0, totalMarketValue: 0 });
    expect(fixed.blockMapByGold.map((it) => it.row.itemKey)).toEqual(['2']);
    expect(fixed.volumeMovers).toEqual([]);
    expect(fixed.excludedOutliers?.map((o) => o.itemKey)).toEqual(['1728']);
    // A different sector's view keeps its own totals.
    expect(withoutOutliers(payload, [outlier as never], 'armor').macro.totalMarketValue).toBe(110);
  });
});
