import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '@marketsync/shared';
import { enrichEntry, groupAuctionVariants } from '../src/lib/auctionRows.js';
import {
  analyzeMarket, describeVolatility, indexMarketObservations, priceVolatilityPct,
  volatilityBand, VOLATILITY_BAND_COLORS, volumeMoverScore, VOLUME_MOVERS_RANKING,
} from '../src/lib/marketAnalytics.js';
import { packAnalyticsReport, unpackAnalyticsView } from '../src/lib/preparedAnalytics.js';

const entry = (price: number, totalQty: number) => ({ minPrice: price, maxPrice: price, totalQty, listings: 3 });

function analyzeSeries(prices: number[], qty = 20) {
  const samples = prices.map((price, i) => {
    const timestamp = 1795485968 + i * 3600;
    const normalized = normalizeSnapshot({
      timestamp, flavor: 'forever', rulesets: { pvp: { Alliance: { '12360': entry(price, qty) } } },
    }, 'forever');
    return { timestamp, entries: normalized.partitions.pvp!.factions.Alliance! };
  });
  const latest = samples.at(-1)!;
  const rows = groupAuctionVariants(Object.values(latest.entries).map((item) =>
    enrichEntry(item, 'forever', { name: 'Arcanite Bar', itemClass: 7, itemSubclass: 0 })));
  const analysis = analyzeMarket(rows, samples.map((s) => indexMarketObservations(s.timestamp, s.entries)), 'forever');
  return { analysis, item: analysis.view('all').blockMapByGold[0]! };
}

describe('price volatility', () => {
  it('uses the addon formula (max − min) ÷ mean × 100', () => {
    // mean 100, range 40 → 40%
    expect(priceVolatilityPct([80, 100, 120])).toBe(40);
    expect(priceVolatilityPct([100, 100, 100, 100])).toBe(0);
    // mean 110, range 20 → 18.18…% → 18.2
    expect(priceVolatilityPct([100, 110, 120])).toBe(18.2);
  });

  it('needs 3 or more data points like the addon', () => {
    expect(priceVolatilityPct([])).toBeNull();
    expect(priceVolatilityPct([100, 200])).toBeNull();
    expect(describeVolatility(null)).toEqual({ text: 'Need 3+ data points', color: '#888888' });
  });

  it('uses the addon colour bands: green ≤10, yellow ≤25, red above', () => {
    expect(volatilityBand(0)).toBe('low');
    expect(volatilityBand(10)).toBe('low');
    expect(volatilityBand(10.1)).toBe('medium');
    expect(volatilityBand(25)).toBe('medium');
    expect(volatilityBand(25.1)).toBe('high');
    expect(describeVolatility(40)).toEqual({ text: '40.0%', color: VOLATILITY_BAND_COLORS.high });
    expect(describeVolatility(5)).toEqual({ text: '5.0%', color: VOLATILITY_BAND_COLORS.low });
  });

  it('is reported on analytics items alongside the CV used for stability', () => {
    const { item } = analyzeSeries([80, 100, 120]);
    expect(item.volatilityPct).toBe(40);
    // CV = stddev / mean = sqrt(800/3) / 100 ≈ 0.163
    expect(item.volatilityCv).toBeCloseTo(0.163, 3);
    expect(item.volatilityPct).toBeGreaterThan(item.volatilityCv * 100);
  });
});

describe('deal percentage', () => {
  it('is the lowest price as a percentage of the window median', () => {
    const { item } = analyzeSeries([100, 120, 80]);
    expect(item.windowMedianPrice).toBe(100);
    expect(item.dealPctOfMedian).toBe(80);
    expect(item).not.toHaveProperty('dealPctOfAvg');
  });

  it('upgrades prepared reports built before the rename', () => {
    const { analysis } = analyzeSeries([100, 120, 80]);
    const report = packAnalyticsReport(1, analysis.categories, analysis.view);
    for (const legacy of report.items as unknown as Record<string, unknown>[]) {
      legacy.dealPctOfAvg = legacy.dealPctOfMedian;
      delete legacy.dealPctOfMedian;
      delete legacy.volatilityPct;
    }
    const view = unpackAnalyticsView(report, 'all');
    expect(view.blockMapByGold[0]!.dealPctOfMedian).toBe(80);
    expect(view.blockMapByGold[0]!.volatilityPct).toBeNull();
  });
});

describe('volume movers', () => {
  it('ranks by listed quantity × log10(lowest price) and says so', () => {
    expect(volumeMoverScore({ row: { totalQty: 50, minPrice: 1000 } } as never)).toBe(150);
    expect(volumeMoverScore({ row: { totalQty: 50, minPrice: 1 } } as never)).toBe(50);
    expect(VOLUME_MOVERS_RANKING).toMatch(/listed quantity × log10 of the lowest unit price/);
    expect(VOLUME_MOVERS_RANKING).toMatch(/not measured sales volume/);
  });
});
