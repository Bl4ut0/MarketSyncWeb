import { DEFAULT_ITEM_ICON, getCachedWowheadTooltipMeta, getEraAuctionCategories, type FlavorId, type NormalizedAuctionEntry } from '@marketsync/shared';
import type { EnrichedAuctionRow } from './auctionRows.js';
import type { HistoryHours } from './priceHistory.js';

export interface MarketAnalyticsItem {
  row: EnrichedAuctionRow;
  marketValueCopper: number;
  windowAvgPrice: number;
  windowMedianPrice: number;
  baselinePrice: number;
  priceChangePct: number;
  /** Current lowest unit price as a percentage of the window median price. */
  dealPctOfMedian: number;
  /**
   * Price Volatility as the MarketSync addon computes it (`UI_Analytics.lua`):
   * (max − min) ÷ mean × 100 over the observed prices. Null until there are
   * at least {@link MIN_VOLATILITY_OBSERVATIONS} observations, matching the
   * addon's "Need 3+ data points" message.
   */
  volatilityPct: number | null;
  /** Coefficient of variation (stddev ÷ mean). Used for the stability score only. */
  volatilityCv: number;
  stabilityScore: number;
  baselineQty: number;
  qtyDelta: number;
  qtyChangePct: number;
  observations: number;
}

export interface MarketAnalyticsCategory {
  id: string;
  label: string;
  itemCount: number;
  totalUnits: number;
  totalMarketValue: number;
  avgChangePct: number;
}

export type ItemAnalyticsDetails = Omit<MarketAnalyticsItem, 'row'> & {
  hours: HistoryHours;
  source: 'block' | 'deals' | 'gainers' | 'stable' | 'volume';
};

export interface MarketAnalyticsPayload {
  macro: {
    totalMarketValue: number;
    totalUnits: number;
    totalListings: number;
    uniqueItems: number;
    sampledCaptures: number;
    risingCount: number;
    fallingCount: number;
    stableCount: number;
  };
  blockMapByGold: MarketAnalyticsItem[];
  blockMapByUnits: MarketAnalyticsItem[];
  gainers: MarketAnalyticsItem[];
  deals: MarketAnalyticsItem[];
  stableAnchors: MarketAnalyticsItem[];
  volumeMovers: MarketAnalyticsItem[];
  categories: MarketAnalyticsCategory[];
  unhydratedItemIds: number[];
  /** Listings left out of every total and list; see {@link findMarketOutliers}. */
  excludedOutliers?: ExcludedOutlier[];
}

/** A listing excluded from market analytics as an outlier. */
export interface ExcludedOutlier {
  itemKey: string;
  itemId: number;
  name: string;
  category: string;
  minPrice: number;
  totalQty: number;
  listings: number;
  marketValueCopper: number;
}

/** An outlier has at most this many listings... */
export const OUTLIER_MAX_LISTINGS = 2;
/** ...is worth more than this share of the whole market... */
export const OUTLIER_MIN_SHARE = 0.1;
/** ...and is worth at least this many times the next most valuable item. */
export const OUTLIER_MIN_RATIO = 5;

/**
 * Finds listings that would dominate the market value on their own, such as a
 * single item listed for millions of gold. Taken from the most valuable item
 * down: an item is an outlier only when it has few listings, a large share of
 * the market that remains, and dwarfs the next item. The first item that fails
 * stops the search, so ordinary expensive goods are never removed.
 */
export function findMarketOutliers<T>(
  entries: readonly T[],
  value: (entry: T) => number,
  listings: (entry: T) => number,
  total: number,
): T[] {
  const sorted = [...entries].sort((a, b) => value(b) - value(a));
  const outliers: T[] = [];
  let remaining = total;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1];
    const worth = value(current);
    if (listings(current) > OUTLIER_MAX_LISTINGS) break;
    if (!(worth > OUTLIER_MIN_SHARE * remaining)) break;
    if (next !== undefined && worth < OUTLIER_MIN_RATIO * value(next)) break;
    outliers.push(current);
    remaining -= worth;
  }
  return outliers;
}

/** The analytics sector an auction row is counted in. */
export function analyticsCategoryOf(row: Pick<EnrichedAuctionRow, 'ahCategory' | 'isFallback' | 'isPetCage'>): string {
  return row.ahCategory ?? (row.isFallback && !row.isPetCage ? 'unclassified' : 'miscellaneous');
}

type PriceAndQuantity = [price: number, quantity: number];
export type MarketObservations = {
  timestamp: number;
  exact: Record<string, PriceAndQuantity>;
  grouped: Record<string, PriceAndQuantity>;
};

export function indexMarketObservations(
  timestamp: number,
  entries: Record<string, NormalizedAuctionEntry>,
): MarketObservations {
  const exact: MarketObservations['exact'] = Object.create(null);
  const grouped: MarketObservations['grouped'] = Object.create(null);
  for (const entry of Object.values(entries)) {
    exact[entry.itemKey] = [entry.minPrice, entry.totalQty];
    if (entry.isPetCage || !entry.suffixId) continue;
    const key = String(entry.itemId);
    const group = grouped[key] ??= [Number.POSITIVE_INFINITY, 0];
    if (entry.minPrice > 0) group[0] = Math.min(group[0], entry.minPrice);
    group[1] += entry.totalQty;
  }
  for (const [key, group] of Object.entries(grouped)) {
    const base = exact[key];
    if (base) {
      if (base[0] > 0) group[0] = Math.min(group[0], base[0]);
      group[1] += base[1];
    }
  }
  return { timestamp, exact, grouped };
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export const MAX_ANALYTICS_CAPTURES = 8;

/** The addon needs 3+ data points before it shows Price Volatility. */
export const MIN_VOLATILITY_OBSERVATIONS = 3;

/** (max − min) ÷ mean × 100, rounded to one decimal, as in the addon. */
export function priceVolatilityPct(prices: readonly number[]): number | null {
  if (prices.length < MIN_VOLATILITY_OBSERVATIONS) return null;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const price of prices) {
    sum += price;
    if (price < min) min = price;
    if (price > max) max = price;
  }
  const mean = sum / prices.length;
  if (!(mean > 0)) return null;
  return Math.round(((max - min) / mean) * 1000) / 10;
}

export type VolatilityBand = 'low' | 'medium' | 'high';

/** Addon colour bands: green ≤ 10%, yellow ≤ 25%, red above. */
export function volatilityBand(pct: number): VolatilityBand {
  if (pct > 25) return 'high';
  if (pct > 10) return 'medium';
  return 'low';
}

export const VOLATILITY_BAND_COLORS: Record<VolatilityBand, string> = {
  low: '#00ff00',
  medium: '#ffd700',
  high: '#ff4444',
};

/** Display text and colour for a volatility value, matching the addon's metrics card. */
export function describeVolatility(pct: number | null | undefined): { text: string; color: string } {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { text: `Need ${MIN_VOLATILITY_OBSERVATIONS}+ data points`, color: '#888888' };
  }
  return { text: `${pct.toFixed(1)}%`, color: VOLATILITY_BAND_COLORS[volatilityBand(pct)] };
}

export function analyzeMarket(
  groupedRows: EnrichedAuctionRow[],
  samples: Iterable<MarketObservations>,
  flavor: FlavorId,
) {
  const uniqueByTs = new Map<number, MarketObservations>();
  for (const sample of samples) {
    if (!uniqueByTs.has(sample.timestamp)) uniqueByTs.set(sample.timestamp, sample);
  }
  const chronological = [...uniqueByTs.values()].sort((a, b) => a.timestamp - b.timestamp);
  const sampledCaptures = chronological.length;
  const eraCats = getEraAuctionCategories(flavor);
  const catLabelMap = new Map<string, string>(
    eraCats.map((c) => [c.id, c.label]),
  );
  catLabelMap.set('miscellaneous', 'Miscellaneous');
  catLabelMap.set('unclassified', 'Unclassified');

  const catAgg = new Map<
    string,
    {
      id: string;
      label: string;
      itemCount: number;
      totalUnits: number;
      totalMarketValue: number;
      weightedChangeSum: number;
      weightedChangeDenom: number;
    }
  >();

  // Listings that would dominate the market on their own (a single item listed
  // for millions of gold) are left out of every total, share and list.
  const rowValue = (row: EnrichedAuctionRow) => row.minPrice * Math.max(1, row.totalQty);
  const outlierRows = findMarketOutliers(
    groupedRows, rowValue, (row) => row.listings,
    groupedRows.reduce((sum, row) => sum + rowValue(row), 0),
  );
  const outlierKeys = new Set(outlierRows.map((row) => row.itemKey));
  const excludedOutliers: ExcludedOutlier[] = outlierRows.map((row) => ({
    itemKey: row.itemKey, itemId: row.itemId, name: row.name, category: analyticsCategoryOf(row),
    minPrice: row.minPrice, totalQty: row.totalQty, listings: row.listings, marketValueCopper: rowValue(row),
  }));

  const allItems: MarketAnalyticsItem[] = [];
  const byCategory = new Map<string, MarketAnalyticsItem[]>();
  for (const row of groupedRows) {
    if (outlierKeys.has(row.itemKey)) continue;
    const catId = analyticsCategoryOf(row);
    const mktVal = rowValue(row);

    // Collect historical price & quantity series across chronological snapshots
    const prices: number[] = [];
    const qtys: number[] = [];
    const grouped = row.variants && row.variants.length > 1;

    for (const sample of chronological) {
      const observation = (grouped ? sample.grouped[row.itemKey] : undefined) ?? sample.exact[row.itemKey];
      if (!observation || observation[0] <= 0 || !Number.isFinite(observation[0])) continue;
      prices.push(observation[0]);
      qtys.push(observation[1]);
    }

    if (prices.length === 0) {
      prices.push(row.minPrice);
      qtys.push(row.totalQty);
    }

    const observations = prices.length;
    const sumP = prices.reduce((acc, v) => acc + v, 0);
    const windowAvgPrice = Math.round(sumP / observations);
    const priorPrices = observations > 1 ? prices.slice(0, -1) : prices;
    const windowMedianPrice = Math.max(1, medianOf(prices));
    const baselinePrice = Math.max(1, medianOf(priorPrices));

    const rawPct =
      observations > 1 && baselinePrice > 0
        ? ((row.minPrice - baselinePrice) / baselinePrice) * 100
        : 0;
    const priceChangePct = Math.round(rawPct * 10) / 10;
    const dealPctOfMedian = Math.round((row.minPrice / windowMedianPrice) * 100);
    const volatilityPct = priceVolatilityPct(prices);

    let variance = 0;
    if (observations > 1 && windowAvgPrice > 0) {
      for (const p of prices) {
        const diff = p - windowAvgPrice;
        variance += diff * diff;
      }
      variance /= observations;
    }
    const volatilityCv =
      windowAvgPrice > 0 ? Math.sqrt(variance) / windowAvgPrice : 0;
    const presenceRatio =
      sampledCaptures > 0 ? observations / sampledCaptures : 1;
    // Stability score (0–100), a web-only heuristic:
    // - 75 points come from price steadiness: 1 − min(1, cv × 2.2). The 2.2
    //   factor makes a CV of about 0.45 (stddev ≈ 45% of the mean) count as
    //   fully unstable, so steadiness drops to 0 there and stays at 0 above.
    // - 25 points come from presence: the share of sampled captures in which
    //   the item was listed at all.
    // Price steadiness is weighted 3:1 over presence because a listed price
    // that swings is the bigger risk for a farming or crafting anchor.
    const stabilityScore = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          (1 - Math.min(1, volatilityCv * 2.2)) * 75 + presenceRatio * 25,
        ),
      ),
    );

    const priorQtys = observations > 1 ? qtys.slice(0, -1) : qtys;
    const baselineQty = Math.max(1, medianOf(priorQtys));
    const qtyDelta = observations > 1 ? row.totalQty - baselineQty : 0;
    const qtyChangePct =
      observations > 1 && baselineQty > 0
        ? Math.round(((row.totalQty - baselineQty) / baselineQty) * 1000) / 10
        : 0;

    // Global category aggregation (unfiltered so sidebar always has all categories)
    let agg = catAgg.get(catId);
    if (!agg) {
      agg = {
        id: catId,
        label: catLabelMap.get(catId) ?? catId,
        itemCount: 0,
        totalUnits: 0,
        totalMarketValue: 0,
        weightedChangeSum: 0,
        weightedChangeDenom: 0,
      };
      catAgg.set(catId, agg);
    }
    agg.itemCount += 1;
    agg.totalUnits += row.totalQty;
    agg.totalMarketValue += mktVal;
    const weight = Math.log10(Math.max(10, mktVal));
    agg.weightedChangeSum += Math.max(-95, Math.min(200, priceChangePct)) * weight;
    agg.weightedChangeDenom += weight;

    const item: MarketAnalyticsItem = {
      row,
      marketValueCopper: mktVal,
      windowAvgPrice,
      windowMedianPrice,
      baselinePrice,
      priceChangePct,
      dealPctOfMedian,
      volatilityPct,
      volatilityCv: Math.round(volatilityCv * 1000) / 1000,
      stabilityScore,
      baselineQty,
      qtyDelta,
      qtyChangePct,
      observations,
    };
    allItems.push(item);
    const categoryItems = byCategory.get(catId);
    if (categoryItems) categoryItems.push(item);
    else byCategory.set(catId, [item]);
  }

  const categories: MarketAnalyticsCategory[] = Array.from(catAgg.values())
    .filter((c) => c.itemCount > 0 && c.id !== 'unclassified')
    .map((c) => ({
      id: c.id,
      label: c.label,
      itemCount: c.itemCount,
      totalUnits: c.totalUnits,
      totalMarketValue: c.totalMarketValue,
      avgChangePct:
        c.weightedChangeDenom > 0
          ? Math.round((c.weightedChangeSum / c.weightedChangeDenom) * 10) / 10
          : 0,
    }))
    .sort((a, b) => b.totalMarketValue - a.totalMarketValue);

  return {
    categories,
    view: (category = 'all') => summarizeMarket(
      category === 'all' ? allItems : (byCategory.get(category) ?? []),
      sampledCaptures,
      categories,
      flavor,
      category === 'all' ? excludedOutliers : excludedOutliers.filter((o) => o.category === category),
    ),
  };
}

/** Plain-language description of how volume movers are ranked, for the UI. */
export const VOLUME_MOVERS_RANKING =
  'Ranked by listed quantity × log10 of the lowest unit price. This is a sort order from the current listings, not measured sales volume.';

export function volumeMoverScore(item: Pick<MarketAnalyticsItem, 'row'>): number {
  return item.row.totalQty * Math.log10(Math.max(10, item.row.minPrice));
}

function summarizeMarket(
  allItems: MarketAnalyticsItem[],
  sampledCaptures: number,
  categories: MarketAnalyticsCategory[],
  flavor: FlavorId,
  excludedOutliers: ExcludedOutlier[] = [],
): MarketAnalyticsPayload {
  let totalMarketValue = 0;
  let totalUnits = 0;
  let totalListings = 0;
  let risingCount = 0;
  let fallingCount = 0;
  let stableCount = 0;

  for (const { row, marketValueCopper, priceChangePct } of allItems) {
    totalMarketValue += marketValueCopper;
    totalUnits += row.totalQty;
    totalListings += row.listings;
    if (priceChangePct > 3.5) risingCount += 1;
    else if (priceChangePct < -3.5) fallingCount += 1;
    else stableCount += 1;
  }

  const blockMapByGold = [...allItems]
    .filter((it) => !it.row.isFallback || allItems.length <= 40)
    .sort((a, b) => b.marketValueCopper - a.marketValueCopper)
    .slice(0, 42);

  const blockMapByUnits = [...allItems]
    .filter((it) => !it.row.isFallback || allItems.length <= 40)
    .sort((a, b) => b.row.totalQty - a.row.totalQty || b.marketValueCopper - a.marketValueCopper)
    .slice(0, 42);

  // Filter meaningful liquid items for Movers / Deals / Stable
  const liquidItems = allItems.filter(
    (it) =>
      (it.row.totalQty >= 2 || it.row.listings >= 2) &&
      it.row.minPrice >= 50,
  );
  const pool = liquidItems.length >= 10 ? liquidItems : allItems;

  const gainers = [...pool]
    .filter((it) => it.observations >= 2 && it.priceChangePct > 2)
    .sort(
      (a, b) =>
        Math.min(500, b.priceChangePct) - Math.min(500, a.priceChangePct) ||
        b.marketValueCopper - a.marketValueCopper,
    )
    .slice(0, 25);

  const deals = [...pool]
    .filter((it) => it.observations >= 2 && it.dealPctOfMedian <= 92 && it.priceChangePct < -2)
    .sort(
      (a, b) =>
        a.dealPctOfMedian - b.dealPctOfMedian ||
        b.marketValueCopper - a.marketValueCopper,
    )
    .slice(0, 25);

  const stableMinObs = Math.max(1, Math.ceil(sampledCaptures * 0.6));
  const stableAnchors = [...pool]
    .filter(
      (it) =>
        it.observations >= stableMinObs &&
        (it.row.totalQty >= 5 || it.row.listings >= 3),
    )
    .sort(
      (a, b) =>
        b.stabilityScore - a.stabilityScore ||
        a.volatilityCv - b.volatilityCv ||
        b.marketValueCopper - a.marketValueCopper,
    )
    .slice(0, 25);

  // Volume movers: a ranking heuristic, not a measured trade volume. Score is
  // listed quantity × log10(lowest unit price in copper, floored at 10), so a
  // large stack ranks high and price only nudges it. See VOLUME_MOVERS_RANKING.
  const volumeMovers = [...allItems]
    .sort(
      (a, b) =>
        volumeMoverScore(b) - volumeMoverScore(a) ||
        b.marketValueCopper - a.marketValueCopper,
    )
    .slice(0, 25);

  const surfaced = new Set<number>();
  for (const list of [
    blockMapByGold,
    blockMapByUnits,
    gainers,
    deals,
    stableAnchors,
    volumeMovers,
  ]) {
    for (const it of list) {
      if (
        it.row.icon === DEFAULT_ITEM_ICON &&
        !it.row.isPetCage &&
        it.row.itemId > 0 &&
        !getCachedWowheadTooltipMeta(it.row.itemId, flavor)
      ) {
        surfaced.add(it.row.itemId);
      }
    }
  }

  return {
    macro: {
      totalMarketValue,
      totalUnits,
      totalListings,
      uniqueItems: allItems.length,
      sampledCaptures,
      risingCount,
      fallingCount,
      stableCount,
    },
    blockMapByGold,
    blockMapByUnits,
    gainers,
    deals,
    stableAnchors,
    volumeMovers,
    categories,
    unhydratedItemIds: Array.from(surfaced).slice(0, 50),
    excludedOutliers,
  };
}
