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
  dealPctOfAvg: number;
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

  const allItems: MarketAnalyticsItem[] = [];
  const byCategory = new Map<string, MarketAnalyticsItem[]>();
  for (const row of groupedRows) {
    const catId =
      row.ahCategory ??
      (row.isFallback && !row.isPetCage ? 'unclassified' : 'miscellaneous');
    const mktVal = row.minPrice * Math.max(1, row.totalQty);

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
    const dealPctOfAvg = Math.round((row.minPrice / windowMedianPrice) * 100);

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
      dealPctOfAvg,
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
    ),
  };
}

function summarizeMarket(
  allItems: MarketAnalyticsItem[],
  sampledCaptures: number,
  categories: MarketAnalyticsCategory[],
  flavor: FlavorId,
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
    .filter((it) => it.observations >= 2 && it.dealPctOfAvg <= 92 && it.priceChangePct < -2)
    .sort(
      (a, b) =>
        a.dealPctOfAvg - b.dealPctOfAvg ||
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

  const volumeMovers = [...allItems]
    .sort(
      (a, b) =>
        b.row.totalQty * Math.log10(Math.max(10, b.row.minPrice)) -
          a.row.totalQty * Math.log10(Math.max(10, a.row.minPrice)) ||
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
  };
}
