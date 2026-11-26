import type { DatasetBlockMeta } from '@marketsync/shared';
import type { MarketAnalyticsItem, MarketAnalyticsPayload } from './marketAnalytics.js';
import type { HistoryHours } from './priceHistory.js';

const lists = [
  'blockMapByGold', 'blockMapByUnits', 'gainers', 'deals', 'stableAnchors', 'volumeMovers',
] as const;
type ListName = (typeof lists)[number];
type PackedView = Pick<MarketAnalyticsPayload, 'macro' | 'unhydratedItemIds'> &
  Record<ListName, number[]>;

interface PreparedAnalyticsReport {
  version: 2;
  timestamp: number;
  categories: MarketAnalyticsPayload['categories'];
  items: MarketAnalyticsItem[];
  views: Record<string, PackedView>;
}

export function packAnalyticsReport(
  timestamp: number,
  categories: MarketAnalyticsPayload['categories'],
  view: (category: string) => MarketAnalyticsPayload,
): PreparedAnalyticsReport {
  const items: MarketAnalyticsItem[] = [];
  const index = new Map<string, number>();
  const views: PreparedAnalyticsReport['views'] = {};
  const getIndex = (item: MarketAnalyticsItem) => {
    const existing = index.get(item.row.itemKey);
    if (existing !== undefined) return existing;
    const id = items.length;
    index.set(item.row.itemKey, id);
    items.push(item);
    return id;
  };

  for (const key of ['all', ...categories.map((category) => category.id)]) {
    const payload = view(key);
    const rankedLists = Object.fromEntries(lists.map((name) => [name, payload[name].map(getIndex)]));
    views[key] = {
      macro: payload.macro,
      unhydratedItemIds: payload.unhydratedItemIds,
      ...rankedLists,
    } as PackedView;
  }
  return { version: 2, timestamp, categories, items, views };
}

/**
 * Reports built by an older analytics engine name the deal percentage
 * `dealPctOfAvg` and have no `volatilityPct`. Fill the new fields in place so
 * published reports keep working until they are rebuilt.
 */
function upgradeLegacyItem(item: MarketAnalyticsItem): MarketAnalyticsItem {
  const legacy = item as MarketAnalyticsItem & { dealPctOfAvg?: number };
  if (typeof legacy.dealPctOfMedian !== 'number' && typeof legacy.dealPctOfAvg === 'number') {
    legacy.dealPctOfMedian = legacy.dealPctOfAvg;
  }
  if (legacy.volatilityPct === undefined) legacy.volatilityPct = null;
  return legacy;
}

export function unpackAnalyticsView(report: PreparedAnalyticsReport, category: string): MarketAnalyticsPayload {
  if (report.version !== 2 || !Array.isArray(report.items) || !Array.isArray(report.categories)) {
    throw new Error('Invalid market analytics report');
  }
  const view = report.views?.all;
  if (!view?.macro) throw new Error('Missing market analytics overview');
  const selected = Object.hasOwn(report.views, category) ? report.views[category]! : {
    macro: {
      totalMarketValue: 0, totalUnits: 0, totalListings: 0, uniqueItems: 0,
      sampledCaptures: view.macro.sampledCaptures, risingCount: 0, fallingCount: 0, stableCount: 0,
    },
    unhydratedItemIds: [],
    blockMapByGold: [], blockMapByUnits: [], gainers: [], deals: [], stableAnchors: [], volumeMovers: [],
  };
  const rankedLists = Object.fromEntries(lists.map((name) => [
    name,
    selected[name].map((id) => {
      const item = report.items[id];
      if (!item?.row) throw new Error('Invalid market analytics item reference');
      return upgradeLegacyItem(item);
    }),
  ])) as Record<ListName, MarketAnalyticsItem[]>;
  return {
    ...rankedLists,
    categories: report.categories,
    macro: selected.macro,
    unhydratedItemIds: selected.unhydratedItemIds,
  };
}

const recentReports = new Map<string, PreparedAnalyticsReport>();
const REPORT_CACHE_SIZE = 6;

function reportPath(block: DatasetBlockMeta, partition: string, faction: string, hours: HistoryHours) {
  return `datasets/analytics/v2/${block.flavor}/${block.analytics?.revision}/${partition}/${faction}/${hours}.json`;
}

export function getCachedAnalytics(
  block: DatasetBlockMeta, partition: string, faction: string, hours: HistoryHours, category: string,
): MarketAnalyticsPayload | null {
  if (!block.analytics) return null;
  const report = recentReports.get(reportPath(block, partition, faction, hours));
  try {
    return report?.timestamp === block.timestamp ? unpackAnalyticsView(report, category) : null;
  } catch {
    return null;
  }
}

export async function loadPreparedAnalytics(
  block: DatasetBlockMeta,
  partition: string,
  faction: string,
  hours: HistoryHours,
  category: string,
  signal: AbortSignal,
): Promise<MarketAnalyticsPayload | null> {
  if (!block.analytics) return null;
  if (!block.analytics.partitions.some((p) => p.key === partition && p.factions.includes(faction))) {
    return {
      macro: {
        totalMarketValue: 0, totalUnits: 0, totalListings: 0, uniqueItems: 0,
        sampledCaptures: 0, risingCount: 0, fallingCount: 0, stableCount: 0,
      },
      categories: [], unhydratedItemIds: [],
      blockMapByGold: [], blockMapByUnits: [], gainers: [], deals: [], stableAnchors: [], volumeMovers: [],
    };
  }
  const path = reportPath(block, partition, faction, hours);
  try {
    let report = recentReports.get(path);
    if (!report) {
      const timeout = AbortSignal.timeout(5000);
      const response = await fetch(`/api/datasets/snapshot?path=${encodeURIComponent(path)}`, {
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) return null;
      report = await response.json() as PreparedAnalyticsReport;
    }
    signal.throwIfAborted();
    if (report?.timestamp !== block.timestamp) return null;
    const payload = unpackAnalyticsView(report, category);
    recentReports.delete(path);
    recentReports.set(path, report);
    if (recentReports.size > REPORT_CACHE_SIZE) {
      const oldest = recentReports.keys().next().value;
      if (oldest !== undefined) recentReports.delete(oldest);
    }
    return payload;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}
