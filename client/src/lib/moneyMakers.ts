import type { FlavorId } from '@marketsync/shared';
import {
  CRAFT_SALE_FEE,
  createCraftEvaluator,
  type CraftEstimate,
  type CraftQuotes,
  type RecipeCatalog,
} from './craftProfit.js';
import { DISENCHANTABLE_CLASSES, disenchantDrops } from './disenchant.js';
import type { MarketAnalyticsItem, MarketAnalyticsPayload } from './marketAnalytics.js';

/**
 * Money Makers: ways to profit from the current Auction House snapshot.
 *
 * Every figure is per action (one craft, one item bought) and uses the
 * lowest current listing as the buy or sell price. Auction House sales lose
 * the same 5% cut the addon applies (`MAIN_AH_CUT_PERCENT`); vendor sales do
 * not. These are estimates from listed prices, not completed sales.
 */

export type OpportunityKind = 'craft' | 'vendorCraft' | 'vendorFlip' | 'disenchant' | 'buyLow';

export interface OpportunityDrop {
  itemId: number;
  expected: number;
  /** Lowest current listing of the material, or null when it is not listed. */
  price: number | null;
}

export interface Opportunity {
  kind: OpportunityKind;
  /** Unique within its kind. */
  key: string;
  itemId: number;
  name: string;
  /** Wowhead icon slug, when known. */
  icon?: string;
  /** Full icon URL (analytics rows carry one). */
  iconUrl?: string;
  quality?: number;
  /** What one action costs. */
  cost: number;
  /** What one action returns after any Auction House cut. */
  revenue: number;
  profit: number;
  /** Profit as a percentage of cost. */
  roi: number;
  /** Units currently listed of the item you buy (or sell, for crafts). */
  supply?: number;
  profession?: number;
  estimate?: CraftEstimate;
  drops?: OpportunityDrop[];
  analytics?: MarketAnalyticsItem;
}

export function netAfterAhCut(gross: number): number {
  return Math.floor((gross * (100 - CRAFT_SALE_FEE)) / 100);
}

function roiOf(profit: number, cost: number): number {
  return cost > 0 ? (100 * profit) / cost : 0;
}

function byProfit(a: Opportunity, b: Opportunity): number {
  return b.profit - a.profit || b.roi - a.roi || a.name.localeCompare(b.name);
}

/**
 * Evaluates every recipe once, buying each reagent at its lowest listing or
 * from a vendor. Sub-crafting is left out on purpose: cooldown-limited
 * reagents such as Mooncloth or transmutes would otherwise look free to make in
 * any quantity. The Professions tab still offers the craft-everything plan.
 */
export function evaluateAllRecipes(catalog: RecipeCatalog, quotes: CraftQuotes): CraftEstimate[] {
  const evaluate = createCraftEvaluator(catalog, quotes);
  return catalog.recipes.map((recipe) => evaluate(recipe, 1, 'buy'));
}

function craftName(catalog: RecipeCatalog, quotes: CraftQuotes, estimate: CraftEstimate): string {
  const id = estimate.recipe.itemId;
  return catalog.items[id] ?? quotes[id]?.name ?? estimate.recipe.name;
}

/** Crafts that sell on the Auction House for more than their reagents cost. */
export function craftForAuction(
  catalog: RecipeCatalog,
  quotes: CraftQuotes,
  estimates: CraftEstimate[],
): Opportunity[] {
  const out: Opportunity[] = [];
  for (const estimate of estimates) {
    const { cost, netSale, recipe } = estimate;
    if (cost === null || netSale === null || cost <= 0) continue;
    const profit = netSale - cost;
    if (profit <= 0) continue;
    const quote = quotes[recipe.itemId];
    out.push({
      kind: 'craft',
      key: `craft:${recipe.id}`,
      itemId: recipe.itemId,
      name: craftName(catalog, quotes, estimate),
      icon: quote?.icon,
      quality: quote?.quality,
      cost,
      revenue: netSale,
      profit,
      roi: roiOf(profit, cost),
      supply: quote?.quantity,
      profession: recipe.profession,
      estimate,
    });
  }
  return out.sort(byProfit);
}

/** Crafts whose vendor sell price beats their reagent cost (the addon's "Vendor Shuffle"). */
export function vendorCrafts(
  catalog: RecipeCatalog,
  quotes: CraftQuotes,
  estimates: CraftEstimate[],
): Opportunity[] {
  const out: Opportunity[] = [];
  for (const estimate of estimates) {
    const { cost, vendorSale, recipe } = estimate;
    if (cost === null || vendorSale === null || cost <= 0) continue;
    const profit = vendorSale - cost;
    if (profit <= 0) continue;
    const quote = quotes[recipe.itemId];
    out.push({
      kind: 'vendorCraft',
      key: `vendorCraft:${recipe.id}`,
      itemId: recipe.itemId,
      name: craftName(catalog, quotes, estimate),
      icon: quote?.icon,
      quality: quote?.quality,
      cost,
      revenue: vendorSale,
      profit,
      roi: roiOf(profit, cost),
      profession: recipe.profession,
      estimate,
    });
  }
  return out.sort(byProfit);
}

/**
 * Auctions listed below the item's vendor sell price: buy and sell to any
 * merchant. Only items with a known vendor price (those in the recipe
 * catalog) can be checked. Supply counts every listing, and only the lowest is
 * guaranteed to be at the quoted price.
 */
export function auctionToVendorFlips(catalog: RecipeCatalog, quotes: CraftQuotes): Opportunity[] {
  const sellPrices = catalog.sellPrices ?? {};
  const out: Opportunity[] = [];
  for (const [id, quote] of Object.entries(quotes)) {
    const itemId = Number(id);
    const vendor = sellPrices[itemId];
    if (!vendor || vendor <= quote.price) continue;
    const profit = vendor - quote.price;
    out.push({
      kind: 'vendorFlip',
      key: `vendorFlip:${itemId}`,
      itemId,
      name: catalog.items[itemId] ?? quote.name ?? `Item #${itemId}`,
      icon: quote.icon,
      quality: quote.quality,
      cost: quote.price,
      revenue: vendor,
      profit,
      roi: roiOf(profit, quote.price),
      supply: quote.quantity,
    });
  }
  return out.sort(byProfit);
}

/**
 * Weapons and armor whose expected disenchant materials, sold at their lowest
 * current listings after the Auction House cut, are worth more than the item.
 * Materials with no listing count as zero, so the estimate stays conservative.
 */
export function disenchantFlips(flavor: FlavorId, quotes: CraftQuotes): Opportunity[] {
  const out: Opportunity[] = [];
  for (const [id, quote] of Object.entries(quotes)) {
    if (quote.itemClass === undefined || !DISENCHANTABLE_CLASSES.has(quote.itemClass)) continue;
    const drops = disenchantDrops(flavor, quote.itemClass, quote.quality, quote.itemLevel);
    if (drops.length === 0) continue;
    let gross = 0;
    let priced = 0;
    const detailed: OpportunityDrop[] = drops.map((drop) => {
      const price = quotes[drop.itemId]?.price ?? null;
      if (price !== null) {
        gross += drop.expected * price;
        priced += 1;
      }
      return { itemId: drop.itemId, expected: drop.expected, price };
    });
    if (priced === 0) continue;
    const revenue = netAfterAhCut(gross);
    const profit = revenue - quote.price;
    if (profit <= 0) continue;
    const itemId = Number(id);
    out.push({
      kind: 'disenchant',
      key: `disenchant:${itemId}`,
      itemId,
      name: quote.name ?? `Item #${itemId}`,
      icon: quote.icon,
      quality: quote.quality,
      cost: quote.price,
      revenue,
      profit,
      roi: roiOf(profit, quote.price),
      supply: quote.quantity,
      drops: detailed,
    });
  }
  return out.sort(byProfit);
}

/** Every distinct item the analytics payload surfaced, across all of its lists. */
export function analyticsCandidates(analytics: MarketAnalyticsPayload | null): MarketAnalyticsItem[] {
  if (!analytics) return [];
  const seen = new Map<string, MarketAnalyticsItem>();
  for (const list of [analytics.deals, analytics.stableAnchors, analytics.gainers,
    analytics.blockMapByGold, analytics.blockMapByUnits, analytics.volumeMovers]) {
    for (const item of list ?? []) {
      if (!seen.has(item.row.itemKey)) seen.set(item.row.itemKey, item);
    }
  }
  return [...seen.values()];
}

/** Observations needed before a price is compared with its normal (median) price. */
export const MIN_SIGNAL_OBSERVATIONS = 3;
/** "Buy Low" needs the current price at or below this share of the median. */
export const BUY_LOW_MAX_PCT_OF_MEDIAN = 85;
/** Price spread (coefficient of variation) at which an item counts as erratic. */
export const ERRATIC_SPREAD = 0.5;
/** Price spread under which an item counts as steady. */
export const STEADY_SPREAD = 0.35;
/** Market Signals ignore items whose normal price is under this (1 silver). */
export const MIN_SIGNAL_NORMAL_PRICE = 100;

/**
 * Items listed well below their median price over the analytics window, with
 * resale assumed at that median after the Auction House cut. The median is the
 * "market standard" the item has traded around; prices can stay low, so check
 * the history before buying in bulk.
 */
export function buyLowDeals(analytics: MarketAnalyticsPayload | null): Opportunity[] {
  const out: Opportunity[] = [];
  for (const item of analyticsCandidates(analytics)) {
    const { row } = item;
    if (item.observations < MIN_SIGNAL_OBSERVATIONS) continue;
    if (item.dealPctOfMedian > BUY_LOW_MAX_PCT_OF_MEDIAN) continue;
    // An erratic item has no dependable median to resell at.
    if (item.volatilityCv >= ERRATIC_SPREAD) continue;
    if (row.minPrice <= 0 || row.totalQty <= 0) continue;
    const revenue = netAfterAhCut(item.windowMedianPrice);
    const profit = revenue - row.minPrice;
    if (profit <= 0) continue;
    out.push({
      kind: 'buyLow',
      key: `buyLow:${row.itemKey}`,
      itemId: row.itemId,
      name: row.name,
      iconUrl: row.iconUrl,
      quality: row.quality,
      cost: row.minPrice,
      revenue,
      profit,
      roi: roiOf(profit, row.minPrice),
      supply: row.totalQty,
      analytics: item,
    });
  }
  return out.sort(byProfit);
}

export type MarketSignalKind = 'buy' | 'sell' | 'avoid';

export interface MarketSignal {
  kind: MarketSignalKind;
  item: MarketAnalyticsItem;
  /** Median price over the analytics window: the price the item normally trades at. */
  normalPrice: number;
  /** Current lowest price as a percentage of the normal price. */
  pctOfNormal: number;
  /** Change needed to return to the normal price, as a percentage of the current price. */
  moveToNormalPct: number;
  reason: string;
}

/**
 * Trend guidance against each item's normal (median) price:
 *  - buy: a steady item (low spread) priced well under normal, likely to return to it;
 *  - sell: priced well above normal after a recent rise, a good time to list stock;
 *  - avoid: prices swing too much to trust any projection.
 * This is mean reversion to the median, not a forecast of future demand.
 */
export function marketSignals(analytics: MarketAnalyticsPayload | null): MarketSignal[] {
  const out: MarketSignal[] = [];
  for (const item of analyticsCandidates(analytics)) {
    if (item.observations < MIN_SIGNAL_OBSERVATIONS || item.row.minPrice <= 0) continue;
    // Penny items swing by large percentages over a copper or two; skip them.
    if (item.windowMedianPrice < MIN_SIGNAL_NORMAL_PRICE) continue;
    const normal = item.windowMedianPrice;
    const pct = item.dealPctOfMedian;
    const move = ((normal - item.row.minPrice) / item.row.minPrice) * 100;
    let kind: MarketSignalKind | null = null;
    let reason = '';
    if (item.volatilityCv >= ERRATIC_SPREAD) {
      kind = 'avoid';
      reason = 'Prices swing widely; no reliable normal price.';
    } else if (pct <= BUY_LOW_MAX_PCT_OF_MEDIAN && item.volatilityCv < STEADY_SPREAD) {
      kind = 'buy';
      reason = 'Usually steady, now well under its normal price.';
    } else if (pct >= 120 && item.priceChangePct >= 10) {
      kind = 'sell';
      reason = 'Rising and well above its normal price.';
    }
    if (!kind) continue;
    out.push({ kind, item, normalPrice: normal, pctOfNormal: pct, moveToNormalPct: move, reason });
  }
  // Within each kind, the biggest copper gap to the normal price first.
  const order: Record<MarketSignalKind, number> = { buy: 0, sell: 1, avoid: 2 };
  const gap = (s: MarketSignal) => Math.abs(s.normalPrice - s.item.row.minPrice);
  return out.sort((a, b) => order[a.kind] - order[b.kind] || gap(b) - gap(a));
}

/**
 * A craft whose output has fewer listed units than this sells into a "thin"
 * market: one listing sets the price and nobody may buy at it.
 */
export const THIN_MARKET_SUPPLY = 3;

export function isThinMarket(o: Opportunity): boolean {
  return o.kind === 'craft' && (o.supply ?? 0) < THIN_MARKET_SUPPLY;
}

/**
 * The most profitable opportunities across every kind. Crafts selling into a
 * thin market are left out, because a single high listing would otherwise
 * crowd out dependable profits.
 */
export function bestOverall(groups: Opportunity[][], limit = 24): Opportunity[] {
  return groups.flat().filter((o) => !isThinMarket(o)).sort(byProfit).slice(0, limit);
}
