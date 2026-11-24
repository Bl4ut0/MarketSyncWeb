import {
  DEFAULT_ITEM_ICON,
  getCachedWowheadTooltipMeta,
  getEraAuctionCategories,
  getWowheadTooltipApiUrl,
  isFlavorId,
  normalizeSnapshot,
  parseWowheadTooltipPayload,
  registerWowheadTooltipMeta,
  type AhCategoryId,
  type AuctionCatalogItem,
  type ComputedSnapshotStats,
  type FlavorId,
  type ItemQuality,
  type MarketCaptureState,
  type NormalizedAuctionEntry,
  type NormalizedSnapshot,
  type PriceHistoryPoint,
  type SnapshotStats,
  type WowheadTooltipMeta,
  type WowheadItemMatch,
} from '@marketsync/shared';
import {
  getCachedSnapshot,
  loadAllCachedTooltips,
  putCachedSnapshot,
  putCachedTooltips,
} from '../lib/snapshotStore.js';

import { baseItemName, enrichEntry, groupAuctionVariants, sumMarketRows, type EnrichedAuctionRow } from '../lib/auctionRows.js';
import { analyzeMarket, indexMarketObservations, MAX_ANALYTICS_CAPTURES, type MarketAnalyticsPayload, type MarketObservations } from '../lib/marketAnalytics.js';
import type { CraftQuotes } from '../lib/craftProfit.js';

export type { EnrichedAuctionRow } from '../lib/auctionRows.js';
export type { MarketAnalyticsCategory, MarketAnalyticsItem, MarketAnalyticsPayload } from '../lib/marketAnalytics.js';

export type SortField =
  | 'minPrice'
  | 'maxPrice'
  | 'totalQty'
  | 'listings'
  | 'name'
  | 'category'
  | 'quality'
  | 'level';
export type SortDir = 'asc' | 'desc';

export interface PartitionSummary {
  key: string;
  rawKeys: string[];
  label: string;
  factions: string[];
  marketStates?: Record<string, MarketCaptureState>;
  missingExpectedFactions: string[];
  entryCount: number;
  uniqueItemCount: number;
  totalVolume: number;
  totalListings: number;
}

export interface SnapshotSummary {
  path: string;
  version: string;
  flavor: FlavorId;
  timestamp: number;
  isoDate: string;
  region: string;
  simulated: boolean;
  status: string;
  declaredStats: SnapshotStats;
  computedStats: ComputedSnapshotStats;
  partitions: PartitionSummary[];
  fromCache: boolean;
}

export type WorkerRequest =
  | {
      reqId: string;
      type: 'LOAD_SNAPSHOT';
      path: string;
      flavor: FlavorId;
    }
  | {
      reqId: string;
      type: 'QUERY_ENTRIES';
      path: string;
      flavor?: FlavorId;
      partitionKey: string;
      faction: string;
      search: string;
      matchingItems?: WowheadItemMatch[];
      exactMatch?: boolean;
      quality: string;
      ahCategory?: string;
      ahSubcategory?: string;
      minLevel?: number;
      maxLevel?: number;
      sortBy: SortField;
      sortDir: SortDir;
      page: number;
      pageSize: number;
    }
  | {
      reqId: string;
      type: 'GET_CRAFT_QUOTES';
      path: string;
      flavor: FlavorId;
      partitionKey: string;
      faction: string;
    }
  | {
      reqId: string;
      type: 'GET_ITEM_HISTORY';
      blocks: Array<{ path: string; flavor: FlavorId }>;
      partitionKey: string;
      faction: string;
      itemKey: string;
      groupedItemId?: number;
    }
  | {
      reqId: string;
      type: 'COMPUTE_MARKET_ANALYTICS';
      currentPath: string;
      flavor: FlavorId;
      blocks: AnalyticsHistoryBlock[];
      partitionKey: string;
      faction: string;
      ahCategory?: string;
    }
  | { reqId: string; type: 'CANCEL_ITEM_HISTORY' }
  | {
      reqId: string;
      type: 'HYDRATE_WOWHEAD_ITEMS';
      itemIds: number[];
      flavor: FlavorId;
    };

export type WorkerResponse =
  | {
      reqId: string;
      ok: true;
      type: 'LOAD_SNAPSHOT';
      summary: SnapshotSummary;
    }
  | {
      reqId: string;
      ok: true;
      type: 'QUERY_ENTRIES';
      rows: EnrichedAuctionRow[];
      totalCount: number;
      page: number;
      totalPages: number;
      categoryCounts: Record<string, number>;
    }
  | {
      reqId: string;
      ok: true;
      type: 'GET_CRAFT_QUOTES';
      quotes: CraftQuotes;
    }
  | {
      reqId: string;
      ok: true;
      type: 'GET_ITEM_HISTORY';
      points: PriceHistoryPoint[];
      failedBlocks: number;
    }
  | {
      reqId: string;
      ok: true;
      type: 'COMPUTE_MARKET_ANALYTICS';
      analytics: MarketAnalyticsPayload;
    }
  | {
      reqId: string;
      ok: true;
      type: 'HYDRATE_WOWHEAD_ITEMS';
      hydrated: Record<number, WowheadTooltipMeta>;
    }
  | {
      reqId: string;
      ok: false;
      error: string;
    };

const inflightLoads = new Map<string, Promise<{ snapshot: NormalizedSnapshot; fromCache: boolean }>>();
const memCache = new Map<string, NormalizedSnapshot>();
const pathFlavors = new Map<string, FlavorId>();
let activeSnapshotPath: string | null = null;

function inferFlavorFromPath(path: string): FlavorId {
  const candidate = path.split('/')[1];
  return candidate && isFlavorId(candidate) ? candidate : 'forever';
}

function setMemCachedSnapshot(path: string, snapshot: NormalizedSnapshot): void {
  if (memCache.has(path)) {
    memCache.delete(path);
  }
  memCache.set(path, snapshot);
  if (memCache.size > 6) {
    for (const key of memCache.keys()) {
      if (memCache.size <= 6) break;
      if (key === activeSnapshotPath) continue;
      memCache.delete(key);
    }
  }
}

async function fetchSnapshotJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000);
  const url = `/api/datasets/snapshot?path=${encodeURIComponent(path)}`;
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed (${response.status}) for ${path}`);
  }
  return response.json();
}

async function loadAndCacheSnapshot(
  path: string,
  flavor: FlavorId,
): Promise<{ snapshot: NormalizedSnapshot; fromCache: boolean }> {
  pathFlavors.set(path, flavor);

  const memHit = memCache.get(path);
  if (memHit) {
    setMemCachedSnapshot(path, memHit);
    return { snapshot: memHit, fromCache: true };
  }

  const cached = await getCachedSnapshot(path);
  if (cached) {
    setMemCachedSnapshot(path, cached);
    return { snapshot: cached, fromCache: true };
  }

  const existingInflight = inflightLoads.get(path);
  if (existingInflight) {
    return existingInflight;
  }

  const task = (async () => {
    const rawJson = await fetchSnapshotJson(path);
    const normalized = normalizeSnapshot(rawJson, flavor);
    setMemCachedSnapshot(path, normalized);
    await putCachedSnapshot(path, normalized);
    return { snapshot: normalized, fromCache: false };
  })();

  inflightLoads.set(path, task);
  try {
    return await task;
  } finally {
    inflightLoads.delete(path);
  }
}

function summarizeSnapshot(
  path: string,
  snapshot: NormalizedSnapshot,
  fromCache: boolean,
): SnapshotSummary {
  const partitions: PartitionSummary[] = Object.values(snapshot.partitions).map(
    (p) => ({
      key: p.key,
      rawKeys: p.rawKeys,
      label: p.label,
      factions: Object.keys(p.factions),
      marketStates: p.marketStates,
      missingExpectedFactions: p.missingExpectedFactions.map(String),
      entryCount: p.entryCount,
      uniqueItemCount: p.uniqueItemCount,
      totalVolume: p.totalVolume,
      totalListings: p.totalListings,
    }),
  );

  return {
    path,
    version: snapshot.version,
    flavor: snapshot.flavor,
    timestamp: snapshot.timestamp,
    isoDate: snapshot.isoDate,
    region: snapshot.region,
    simulated: snapshot.simulated,
    status: snapshot.status,
    declaredStats: snapshot.declaredStats,
    computedStats: snapshot.computedStats,
    partitions,
    fromCache,
  };
}

let tooltipPreload: Promise<void> | undefined;
const tooltipRequests = new Map<string, Promise<WowheadTooltipMeta | null>>();
const tooltipRetryAfter = new Map<string, number>();

function ensureTooltipsPreloaded(): Promise<void> {
  return tooltipPreload ??= loadAllCachedTooltips().then((cached) => {
    for (const entry of cached) {
      registerWowheadTooltipMeta(entry.itemId, entry.meta, entry.flavor);
    }
  });
}

const itemCatalogs = new Map<FlavorId, { expiresAt: number; items: Promise<Record<string, AuctionCatalogItem>> }>();

function getItemCatalog(flavor: FlavorId): Promise<Record<string, AuctionCatalogItem>> {
  const cached = itemCatalogs.get(flavor);
  if (cached && Date.now() < cached.expiresAt) return cached.items;
  const items = fetch(`/api/datasets/catalog?flavor=${flavor}`, { signal: AbortSignal.timeout(3500) })
    .then(async (response) => {
      if (!response.ok || response.status === 204) return {};
      const catalog = await response.json() as { version?: number; flavor?: string; items?: Record<string, AuctionCatalogItem> } | null;
      return catalog?.version === 1 && catalog.flavor === flavor ? catalog.items ?? {} : {};
    }).catch(() => ({}));
  itemCatalogs.set(flavor, { expiresAt: Date.now() + 5 * 60 * 1000, items });
  return items;
}

function compareBrowseRows(
  a: EnrichedAuctionRow,
  b: EnrichedAuctionRow,
  sortBy: SortField,
  sortDir: SortDir,
): number {
  const dir = sortDir === 'desc' ? -1 : 1;
  switch (sortBy) {
    case 'minPrice': {
      // Blizzard AH list_bid / price sort: primary minPrice, then totalQty desc, name asc, quality asc
      return (
        (a.minPrice - b.minPrice) * dir ||
        b.totalQty - a.totalQty ||
        a.name.localeCompare(b.name) ||
        a.quality - b.quality ||
        a.itemId - b.itemId
      );
    }
    case 'maxPrice': {
      return (
        (a.maxPrice - b.maxPrice) * dir ||
        b.totalQty - a.totalQty ||
        a.name.localeCompare(b.name) ||
        a.itemId - b.itemId
      );
    }
    case 'quality': {
      // Blizzard AH list_quality sort: quality -> level desc -> name asc -> minPrice asc -> totalQty desc
      const aLvl = a.reqLevel ?? a.itemLevel ?? 0;
      const bLvl = b.reqLevel ?? b.itemLevel ?? 0;
      return (
        (a.quality - b.quality) * dir ||
        bLvl - aLvl ||
        a.name.localeCompare(b.name) ||
        a.minPrice - b.minPrice ||
        b.totalQty - a.totalQty ||
        a.itemId - b.itemId
      );
    }
    case 'totalQty': {
      return (
        (a.totalQty - b.totalQty) * dir ||
        a.minPrice - b.minPrice ||
        a.name.localeCompare(b.name) ||
        a.itemId - b.itemId
      );
    }
    case 'listings': {
      return (
        (a.listings - b.listings) * dir ||
        a.minPrice - b.minPrice ||
        a.name.localeCompare(b.name) ||
        a.itemId - b.itemId
      );
    }
    case 'name': {
      return (
        a.name.localeCompare(b.name) * dir ||
        a.minPrice - b.minPrice ||
        a.itemId - b.itemId
      );
    }
    default:
      return 0;
  }
}

async function handleQueryEntries(
  msg: Extract<WorkerRequest, { type: 'QUERY_ENTRIES' }>,
): Promise<Extract<WorkerResponse, { type: 'QUERY_ENTRIES' }>> {
  await ensureTooltipsPreloaded();
  activeSnapshotPath = msg.path;
  const flavor =
    msg.flavor ?? pathFlavors.get(msg.path) ?? inferFlavorFromPath(msg.path);
  const [{ snapshot }, catalog] = await Promise.all([
    loadAndCacheSnapshot(msg.path, flavor),
    getItemCatalog(flavor),
  ]);

  const partition = snapshot.partitions[msg.partitionKey];
  const factionMap = partition?.factions[msg.faction];
  if (!factionMap) {
    return {
      reqId: msg.reqId,
      ok: true,
      type: 'QUERY_ENTRIES',
      rows: [],
      totalCount: 0,
      page: 1,
      totalPages: 1,
      categoryCounts: {},
    };
  }

  let rawSearch = msg.search.trim();
  let exactMatch = Boolean(msg.exactMatch);
  if (
    rawSearch.length >= 2 &&
    ((rawSearch.startsWith('"') && rawSearch.endsWith('"')) ||
      (rawSearch.startsWith('“') && rawSearch.endsWith('”')))
  ) {
    exactMatch = true;
    rawSearch = rawSearch.slice(1, -1).trim();
  }
  const searchClean = rawSearch.toLowerCase().replace(/^#/, '');

  const qualityFilter =
    msg.quality !== 'all' && msg.quality !== '' ? Number(msg.quality) : null;
  const catFilter =
    msg.ahCategory && msg.ahCategory !== 'all' ? msg.ahCategory : null;
  const subCatFilter =
    msg.ahSubcategory && msg.ahSubcategory !== 'all' ? msg.ahSubcategory : null;
  const minLvl =
    typeof msg.minLevel === 'number' && msg.minLevel > 0 ? msg.minLevel : null;
  const maxLvl =
    typeof msg.maxLevel === 'number' && msg.maxLevel > 0 ? msg.maxLevel : null;

  const categoryCounts: Record<string, number> = {};
  const candidates: EnrichedAuctionRow[] = [];
  const matchingItems = new Map(msg.matchingItems?.map((item) => [item.id, item.name]));
  const categories = getEraAuctionCategories(flavor);
  const categoryOrder = new Map<string, number>();
  for (const category of categories) {
    categoryOrder.set(category.id, categoryOrder.size);
    for (const subcategory of category.subCategories ?? []) {
      categoryOrder.set(`${category.id}:${subcategory.id}`, categoryOrder.size);
    }
  }
  const itemCategory = (row: EnrichedAuctionRow) =>
    row.ahCategory ?? (row.isFallback && !row.isPetCage ? 'unclassified' : 'miscellaneous');
  const itemLevel = (row: EnrichedAuctionRow) =>
    flavor === 'retail' ? row.itemLevel : row.reqLevel ?? row.itemLevel;

  for (const entry of Object.values(factionMap)) {
    const enriched = enrichEntry(entry, flavor, catalog[entry.itemId]);

    if (qualityFilter !== null && ((enriched.isFallback && !enriched.isPetCage &&
      catalog[entry.itemId]?.quality === undefined) || enriched.quality !== qualityFilter)) {
      continue;
    }

    if (minLvl !== null || maxLvl !== null) {
      const lvl = itemLevel(enriched);
      if (lvl === undefined || (minLvl !== null && lvl < minLvl) ||
          (maxLvl !== null && lvl > maxLvl)) continue;
    }

    if (searchClean.length > 0) {
      const externalName = matchingItems.get(enriched.itemId);
      const externalMatch = exactMatch
        ? externalName?.toLowerCase() === searchClean
        : externalName?.toLowerCase().includes(searchClean);
      if (externalMatch && externalName && enriched.isFallback && !enriched.isPetCage) {
        enriched.name = enriched.suffixId === 0 ? externalName : `${externalName} (Variant #${enriched.suffixId})`;
      }
      if (exactMatch) {
        const nameExact = enriched.name.toLowerCase() === searchClean ||
          baseItemName(enriched).toLowerCase() === searchClean;
        const idExact = String(enriched.itemId) === searchClean;
        const keyExact = enriched.itemKey.toLowerCase() === searchClean;
        if (!nameExact && !idExact && !keyExact && !externalMatch) continue;
      } else {
        const nameMatch = enriched.name.toLowerCase().includes(searchClean);
        const idMatch = String(enriched.itemId).includes(searchClean);
        const keyMatch = enriched.itemKey.toLowerCase().includes(searchClean);
        const catMatch = enriched.category.toLowerCase().includes(searchClean);
        const speciesMatch =
          enriched.petSpeciesId !== undefined &&
          String(enriched.petSpeciesId).includes(searchClean);
        if (!nameMatch && !idMatch && !keyMatch && !catMatch && !speciesMatch && !externalMatch) {
          continue;
        }
      }
    }

    candidates.push(enriched);
  }
  const matched = groupAuctionVariants(candidates).filter((row) => {
    const catKey = itemCategory(row);
    categoryCounts[catKey] = (categoryCounts[catKey] ?? 0) + 1;
    if (row.ahSubcategory) {
      const subKey = `${catKey}:${row.ahSubcategory}`;
      categoryCounts[subKey] = (categoryCounts[subKey] ?? 0) + 1;
    }

    return (!catFilter || catKey === catFilter) && (!subCatFilter || row.ahSubcategory === subCatFilter);
  });

  const categoryRank = (row: EnrichedAuctionRow) => {
    const category = itemCategory(row);
    return categoryOrder.get(`${category}:${row.ahSubcategory}`) ??
      categoryOrder.get(category) ?? categoryOrder.size;
  };
  const direction = msg.sortDir === 'asc' ? 1 : -1;
  matched.sort((a, b) => {
    if (msg.sortBy === 'category') {
      return (categoryRank(a) - categoryRank(b)) * direction || compareBrowseRows(a, b, 'name', 'asc');
    }
    if (msg.sortBy === 'level') {
      const aLevel = itemLevel(a);
      const bLevel = itemLevel(b);
      if (aLevel === undefined && bLevel !== undefined) return 1;
      if (aLevel !== undefined && bLevel === undefined) return -1;
      return ((aLevel ?? 0) - (bLevel ?? 0)) * direction || compareBrowseRows(a, b, 'quality', 'desc');
    }
    return compareBrowseRows(a, b, msg.sortBy, msg.sortDir);
  });

  const totalCount = matched.length;
  const pageSize = Math.max(1, msg.pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, msg.page), totalPages);
  const start = (safePage - 1) * pageSize;
  const rows = matched.slice(start, start + pageSize);

  return {
    reqId: msg.reqId,
    ok: true,
    type: 'QUERY_ENTRIES',
    rows,
    totalCount,
    page: safePage,
    totalPages,
    categoryCounts,
  };
}

async function handleHydrateWowheadItems(
  msg: Extract<WorkerRequest, { type: 'HYDRATE_WOWHEAD_ITEMS' }>,
): Promise<Extract<WorkerResponse, { type: 'HYDRATE_WOWHEAD_ITEMS' }>> {
  await ensureTooltipsPreloaded();
  const hydrated: Record<number, WowheadTooltipMeta> = {};
  const toPersist: Array<{ itemId: number; meta: WowheadTooltipMeta }> = [];

  const uniqueIds = Array.from(
    new Set(
      msg.itemIds.filter(
        (id) => Number.isSafeInteger(id) && id > 0 && id !== 82800,
      ),
    ),
  ).slice(0, 60);

  const CONCURRENCY = 6;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, uniqueIds.length) },
    async () => {
      while (cursor < uniqueIds.length) {
        const itemId = uniqueIds[cursor++]!;
        const cached = getCachedWowheadTooltipMeta(itemId, msg.flavor);
        if (cached) {
          hydrated[itemId] = cached;
          continue;
        }
        const key = `${msg.flavor}:${itemId}`;
        if ((tooltipRetryAfter.get(key) ?? 0) > Date.now()) continue;
        let pending = tooltipRequests.get(key);
        if (!pending) {
          pending = fetch(getWowheadTooltipApiUrl(itemId, msg.flavor), {
            signal: AbortSignal.timeout(6000),
          }).then(async (response) => {
            if (!response.ok) return null;
            const meta = parseWowheadTooltipPayload(itemId, await response.json(), msg.flavor);
            if (meta) toPersist.push({ itemId, meta });
            return meta;
          }).catch(() => null).then((meta) => {
            tooltipRequests.delete(key);
            if (meta) tooltipRetryAfter.delete(key);
            else tooltipRetryAfter.set(key, Date.now() + 60_000);
            return meta;
          });
          tooltipRequests.set(key, pending);
        }
        const meta = await pending;
        if (meta) hydrated[itemId] = meta;
      }
    },
  );

  await Promise.all(workers);

  if (toPersist.length > 0) {
    await putCachedTooltips(msg.flavor, toPersist);
  }

  return {
    reqId: msg.reqId,
    ok: true,
    type: 'HYDRATE_WOWHEAD_ITEMS',
    hydrated,
  };
}

const activeHistory = new Map<string, AbortController>();
const historyMarkets = new Map<string, {
  timestamp: number;
  isoDate: string;
  entries?: Record<string, NormalizedAuctionEntry>;
}>();
const MAX_HISTORY_MARKETS = 12;

type AnalyticsHistoryBlock = {
  path: string;
  flavor: FlavorId;
  timestamp?: number;
  analyticsReady?: boolean;
};
function isObservationMap(value: unknown): value is MarketObservations['exact'] {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadAnalyticsMarket(
  block: AnalyticsHistoryBlock,
  market: { partitionKey: string; faction: string },
  signal: AbortSignal,
): Promise<MarketObservations | null> {
  const capture = /^(datasets\/[A-Za-z]+\/\d{4}-\d{2}-\d{2})\/(\d{2})-00\.json$/.exec(block.path);
  const marketSegment = /^[A-Za-z0-9_-]+$/;
  if (block.analyticsReady && Number.isSafeInteger(block.timestamp) && capture &&
      marketSegment.test(market.partitionKey) && marketSegment.test(market.faction)) {
    const shard = `${capture[1]}/analytics-v1/${capture[2]}-${block.timestamp}/${market.partitionKey}/${market.faction}.json`;
    try {
      const raw = await fetchSnapshotJson(shard, signal) as Partial<MarketObservations> & { version?: number };
      if (raw?.version === 1 && raw.timestamp === block.timestamp &&
          isObservationMap(raw.exact) && isObservationMap(raw.grouped)) {
        return { timestamp: raw.timestamp!, exact: raw.exact, grouped: raw.grouped };
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  const history = await loadHistoryMarket(block, market, signal);
  return history.entries ? indexMarketObservations(history.timestamp, history.entries) : null;
}

async function loadHistoryMarket(
  block: { path: string; flavor: FlavorId },
  market: { partitionKey: string; faction: string },
  signal: AbortSignal,
) {
  const key = JSON.stringify([block.path, block.flavor, market.partitionKey, market.faction]);
  const hit = historyMarkets.get(key);
  if (hit) {
    historyMarkets.delete(key);
    historyMarkets.set(key, hit);
    return hit;
  }

  // Reuse a full capture if the browsing UI already loaded it. Otherwise only
  // normalize the requested market and keep it out of the browsing snapshot cache.
  const loaded = memCache.get(block.path)
    ?? (await inflightLoads.get(block.path))?.snapshot
    ?? await getCachedSnapshot(block.path);
  signal.throwIfAborted();
  const snapshot = loaded ?? normalizeSnapshot(
    await fetchSnapshotJson(block.path, signal), block.flavor, market,
  );
  signal.throwIfAborted();
  const result = {
    timestamp: snapshot.timestamp,
    isoDate: snapshot.isoDate,
    entries: snapshot.partitions[market.partitionKey]?.factions[market.faction],
  };
  historyMarkets.delete(key);
  historyMarkets.set(key, result);
  if (historyMarkets.size > MAX_HISTORY_MARKETS) {
    const oldest = historyMarkets.keys().next().value;
    if (oldest !== undefined) historyMarkets.delete(oldest);
  }
  return result;
}

async function handleGetItemHistory(
  msg: Extract<WorkerRequest, { type: 'GET_ITEM_HISTORY' }>,
): Promise<Extract<WorkerResponse, { type: 'GET_ITEM_HISTORY' }>> {
  const byTimestamp = new Map<number, PriceHistoryPoint>();
  const controller = new AbortController();
  const { signal } = controller;

  let failedBlocks = 0;
  async function capture(blk: (typeof msg.blocks)[number]) {
    try {
      const snapshot = await loadHistoryMarket(blk, msg, signal);
      let entry = snapshot.entries?.[msg.itemKey];
      if (msg.groupedItemId !== undefined && snapshot.entries) {
        const prefix = `${msg.groupedItemId}:`;
        const variants = Object.keys(snapshot.entries)
          .filter((key) => key === msg.itemKey || key.startsWith(prefix))
          .map((key) => snapshot.entries![key]!);
        if (!variants.length) return;
        entry = { ...variants[0]!, ...sumMarketRows(variants) };
      }
      if (!entry) return;
      if (!byTimestamp.has(snapshot.timestamp)) {
        byTimestamp.set(snapshot.timestamp, {
          timestamp: snapshot.timestamp,
          isoDate: snapshot.isoDate,
          minPrice: entry.minPrice,
          maxPrice: entry.maxPrice,
          totalQty: entry.totalQty,
          listings: entry.listings,
        });
      }
    } catch {
      if (!signal.aborted) failedBlocks += 1;
    }
  }
  activeHistory.set(msg.reqId, controller);
  try {
    for (let index = 0; index < msg.blocks.length && !signal.aborted; index += 2) {
      await Promise.all(msg.blocks.slice(index, index + 2).map(capture));
    }
  } finally {
    activeHistory.delete(msg.reqId);
  }

  const points = Array.from(byTimestamp.values()).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  return {
    reqId: msg.reqId,
    ok: true,
    type: 'GET_ITEM_HISTORY',
    points,
    failedBlocks,
  };
}

async function handleComputeMarketAnalytics(
  msg: Extract<WorkerRequest, { type: 'COMPUTE_MARKET_ANALYTICS' }>,
): Promise<Extract<WorkerResponse, { type: 'COMPUTE_MARKET_ANALYTICS' }>> {
  await ensureTooltipsPreloaded();
  const controller = new AbortController();
  const { signal } = controller;
  activeHistory.set(msg.reqId, controller);

  try {
    const [{ snapshot: currentSnap }, catalog] = await Promise.all([
      loadAndCacheSnapshot(msg.currentPath, msg.flavor),
      getItemCatalog(msg.flavor),
    ]);

    const factionMap = currentSnap.partitions[msg.partitionKey]?.factions[msg.faction];
    const samples: MarketObservations[] = [];
    let rows: EnrichedAuctionRow[] = [];
    if (factionMap) {
      rows = groupAuctionVariants(Object.values(factionMap).map(
        (entry) => enrichEntry(entry, msg.flavor, catalog[entry.itemId]),
      ));
      samples.push(indexMarketObservations(currentSnap.timestamp, factionMap));
      const market = { partitionKey: msg.partitionKey, faction: msg.faction };
      const blocks = msg.blocks.slice(0, MAX_ANALYTICS_CAPTURES)
        .filter((block) => block.path !== msg.currentPath);
      for (let i = 0; i < blocks.length && !signal.aborted; i += 3) {
        const batch = await Promise.all(blocks.slice(i, i + 3).map(
          (block) => loadAnalyticsMarket(block, market, signal).catch(() => null),
        ));
        for (const sample of batch) {
          if (sample) samples.push(sample);
        }
      }
    }

    return {
      reqId: msg.reqId,
      ok: true,
      type: 'COMPUTE_MARKET_ANALYTICS',
      analytics: analyzeMarket(rows, samples, msg.flavor).view(msg.ahCategory),
    };
  } finally {
    activeHistory.delete(msg.reqId);
  }
}

const workerScope = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  void (async () => {
    try {
      if (msg.type === 'LOAD_SNAPSHOT') {
        activeSnapshotPath = msg.path;
        const { snapshot, fromCache } = await loadAndCacheSnapshot(
          msg.path,
          msg.flavor,
        );
        workerScope.postMessage({
          reqId: msg.reqId,
          ok: true,
          type: 'LOAD_SNAPSHOT',
          summary: summarizeSnapshot(msg.path, snapshot, fromCache),
        });
      } else if (msg.type === 'QUERY_ENTRIES') {
        workerScope.postMessage(await handleQueryEntries(msg));
      } else if (msg.type === 'GET_CRAFT_QUOTES') {
        const { snapshot } = await loadAndCacheSnapshot(msg.path, msg.flavor);
        const market = snapshot.partitions[msg.partitionKey]?.factions[msg.faction] ?? {};
        const quotes: CraftQuotes = {};
        for (const { itemId, minPrice, totalQty, isPetCage } of Object.values(market)) {
          if (isPetCage || minPrice <= 0 || totalQty <= 0) continue;
          const quote = quotes[itemId] ??= { price: minPrice, quantity: 0 };
          quote.price = Math.min(quote.price, minPrice);
          quote.quantity += totalQty;
        }
        workerScope.postMessage({ reqId: msg.reqId, ok: true, type: msg.type, quotes });
      } else if (msg.type === 'GET_ITEM_HISTORY') {
        workerScope.postMessage(await handleGetItemHistory(msg));
      } else if (msg.type === 'COMPUTE_MARKET_ANALYTICS') {
        workerScope.postMessage(await handleComputeMarketAnalytics(msg));
      } else if (msg.type === 'CANCEL_ITEM_HISTORY') {
        activeHistory.get(msg.reqId)?.abort();
      } else if (msg.type === 'HYDRATE_WOWHEAD_ITEMS') {
        workerScope.postMessage(await handleHydrateWowheadItems(msg));
      }
    } catch (err) {
      workerScope.postMessage({
        reqId: msg.reqId,
        ok: false,
        error: err instanceof Error ? err.message : 'Worker processing failed',
      });
    }
  })();
};
