import { describe, expect, it } from 'vitest';
import type { CraftRecipe, RecipeCatalog } from '../src/lib/craftProfit.js';
import { disenchantDrops } from '../src/lib/disenchant.js';
import type { MarketAnalyticsItem, MarketAnalyticsPayload } from '../src/lib/marketAnalytics.js';
import {
  auctionToVendorFlips, bestOverall, buyLowDeals, craftForAuction, disenchantFlips,
  evaluateAllRecipes, marketSignals, netAfterAhCut, vendorCrafts,
} from '../src/lib/moneyMakers.js';

const recipe = (id: number, itemId: number, reagents: [number, number][], profession = 171): CraftRecipe => ({
  id, itemId, yield: 1, reagents, profession, name: `Recipe ${id}`,
});

const catalog = (recipes: CraftRecipe[], extra: Partial<RecipeCatalog> = {}): RecipeCatalog => ({
  version: 1, flavor: 'forever', build: '1.60.1.71037', professions: [],
  items: { 10: 'Potion', 11: 'Elixir' }, recipes, vendorPrices: {}, ...extra,
});

describe('netAfterAhCut', () => {
  it('takes the 5% auction cut and rounds down', () => {
    expect(netAfterAhCut(1000)).toBe(950);
    expect(netAfterAhCut(19)).toBe(18);
  });
});

describe('crafting money makers', () => {
  const potion = recipe(1, 10, [[20, 2]]);
  const elixir = recipe(2, 11, [[20, 1]], 164);
  const cat = catalog([potion, elixir], { sellPrices: { 11: 500 } });
  const quotes = {
    10: { price: 1000, quantity: 4 },
    11: { price: 50, quantity: 9 },
    20: { price: 100, quantity: 50 },
  };
  const estimates = evaluateAllRecipes(cat, quotes);

  it('lists crafts that sell above their reagent cost after the cut', () => {
    const list = craftForAuction(cat, quotes, estimates);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'craft', itemId: 10, name: 'Potion', cost: 200,
      revenue: 950, profit: 750, supply: 4, profession: 171 });
    expect(list[0]!.roi).toBeCloseTo(375);
  });

  it('lists vendor crafts from the vendor sell price with no cut', () => {
    const list = vendorCrafts(cat, quotes, estimates);
    expect(list.map((o) => [o.itemId, o.revenue, o.profit])).toEqual([[11, 500, 400]]);
  });

  it('lists auctions priced under their vendor sell price', () => {
    expect(auctionToVendorFlips(cat, quotes).map((o) => [o.itemId, o.cost, o.profit]))
      .toEqual([[11, 50, 450]]);
  });

  it('ranks the best opportunities across kinds by profit', () => {
    const best = bestOverall([craftForAuction(cat, quotes, estimates), vendorCrafts(cat, quotes, estimates),
      auctionToVendorFlips(cat, quotes)], 2);
    expect(best.map((o) => o.kind)).toEqual(['craft', 'vendorFlip']);
  });

  it('keeps crafts that sell into a thin market out of Best Overall', () => {
    const thin = { ...quotes, 10: { price: 1000, quantity: 1 } };
    const thinEstimates = evaluateAllRecipes(cat, thin);
    const crafts = craftForAuction(cat, thin, thinEstimates);
    expect(crafts.map((o) => o.itemId)).toEqual([10]);
    expect(bestOverall([crafts, auctionToVendorFlips(cat, thin)]).map((o) => o.kind)).toEqual(['vendorFlip']);
  });
});

describe('disenchanting', () => {
  it('reads the addon table and caps Classic-era editions at the Classic brackets', () => {
    // Uncommon armor, item level 30: Soul Dust / Lesser Mystic Essence / Small Glimmering Shard.
    expect(disenchantDrops('forever', 4, 2, 30)).toEqual([
      { itemId: 11082, expected: 0.3, chance: 0.2 },
      { itemId: 11083, expected: 1.125, chance: 0.75 },
      { itemId: 11084, expected: 0.05, chance: 0.05 },
    ].map((d) => ({ ...d, expected: expect.closeTo(d.expected, 6), chance: expect.closeTo(d.chance, 6) })));
    // Outland gear (item level 100) has no Classic row and no Retail table.
    expect(disenchantDrops('forever', 4, 2, 100)).toEqual([]);
    expect(disenchantDrops('anniversary', 4, 2, 100).length).toBeGreaterThan(0);
    expect(disenchantDrops('retail', 4, 2, 30)).toEqual([]);
    // Trade goods cannot be disenchanted.
    expect(disenchantDrops('forever', 7, 2, 30)).toEqual([]);
  });

  it('values gear by its expected materials after the cut and skips unpriced results', () => {
    const quotes = {
      // Rare armor, item level 40: always one Small Brilliant Shard (11139).
      500: { price: 1000, quantity: 1, itemClass: 4, quality: 3, itemLevel: 40, name: 'Bracers' },
      501: { price: 3000, quantity: 1, itemClass: 4, quality: 3, itemLevel: 40, name: 'Pricey' },
      502: { price: 10, quantity: 1, itemClass: 2, quality: 3, itemLevel: 30, name: 'No mats listed' },
      11139: { price: 2000, quantity: 20 },
    };
    const list = disenchantFlips('forever', quotes);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemId: 500, name: 'Bracers', cost: 1000, revenue: 1900, profit: 900,
      drops: [{ itemId: 11139, expected: 1, price: 2000 }] });
  });
});

const analyticsItem = (key: string, overrides: Partial<MarketAnalyticsItem> & { price: number; qty?: number }) => ({
  row: { itemKey: key, itemId: Number(key), name: `Item ${key}`, minPrice: overrides.price,
    totalQty: overrides.qty ?? 5, quality: 1, iconUrl: 'x' },
  windowMedianPrice: 1000, dealPctOfMedian: Math.round((overrides.price / 1000) * 100),
  observations: 6, volatilityCv: 0.1, priceChangePct: 0, ...overrides,
}) as unknown as MarketAnalyticsItem;

const payload = (items: MarketAnalyticsItem[]) => ({
  deals: items, stableAnchors: [], gainers: [], blockMapByGold: [], blockMapByUnits: [], volumeMovers: [],
}) as unknown as MarketAnalyticsPayload;

describe('analytics money makers', () => {
  const cheap = analyticsItem('1', { price: 600 });
  const nearNormal = analyticsItem('2', { price: 900 });
  const fewObs = analyticsItem('3', { price: 300, observations: 2 });
  const spiky = analyticsItem('4', { price: 500, volatilityCv: 0.7 });
  const rising = analyticsItem('5', { price: 1400, priceChangePct: 25 });

  it('buys steady items well under their median and resells at the median after the cut', () => {
    const list = buyLowDeals(payload([cheap, nearNormal, fewObs, spiky]));
    // nearNormal is not cheap enough, fewObs lacks history, spiky has no dependable median.
    expect(list.map((o) => [o.itemId, o.cost, o.revenue, o.profit])).toEqual([[1, 600, 950, 350]]);
  });

  it('signals buy, sell and avoid against the normal price', () => {
    const signals = marketSignals(payload([cheap, nearNormal, fewObs, spiky, rising]));
    expect(signals.map((s) => [s.item.row.itemId, s.kind])).toEqual([[1, 'buy'], [5, 'sell'], [4, 'avoid']]);
    expect(signals[0]!.moveToNormalPct).toBeCloseTo(66.67, 1);
  });

  it('ranks signals by copper gap and skips penny items', () => {
    const penny = analyticsItem('6', { price: 1, windowMedianPrice: 2, dealPctOfMedian: 50 });
    const bigGap = analyticsItem('7', { price: 30000, windowMedianPrice: 60000, dealPctOfMedian: 50 });
    const signals = marketSignals(payload([cheap, penny, bigGap]));
    expect(signals.map((s) => s.item.row.itemId)).toEqual([7, 1]);
  });
});
