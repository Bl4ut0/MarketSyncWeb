import {
  getCatalogAuctionCategory,
  resolveItemMetadata,
  type AhCategoryId,
  type AuctionCatalogItem,
  type FlavorId,
  type ItemQuality,
  type NormalizedAuctionEntry,
} from '@marketsync/shared';

export interface EnrichedAuctionRow extends NormalizedAuctionEntry {
  name: string;
  quality: ItemQuality;
  category: string;
  subCategory?: string;
  ahCategory?: AhCategoryId;
  ahSubcategory?: string;
  itemLevel?: number;
  reqLevel?: number;
  slot?: string;
  icon: string;
  iconUrl: string;
  tooltipHtml?: string;
  isFallback: boolean;
  variants?: EnrichedAuctionRow[];
}

export function enrichEntry(entry: NormalizedAuctionEntry, flavor: FlavorId, catalogItem?: AuctionCatalogItem): EnrichedAuctionRow {
  const meta = resolveItemMetadata(entry.itemKey, flavor);
  const row: EnrichedAuctionRow = {
    ...entry,
    name: meta.name,
    quality: meta.quality,
    category: meta.category,
    ...(meta.subCategory ? { subCategory: meta.subCategory } : {}),
    ...(meta.ahCategory && !meta.isFallback ? { ahCategory: meta.ahCategory } : {}),
    ...(meta.ahSubcategory ? { ahSubcategory: meta.ahSubcategory } : {}),
    ...(meta.itemLevel !== undefined ? { itemLevel: meta.itemLevel } : {}),
    ...(meta.reqLevel !== undefined ? { reqLevel: meta.reqLevel } : {}),
    ...(meta.slot ? { slot: meta.slot } : {}),
    icon: meta.icon,
    iconUrl: meta.iconUrl,
    ...(meta.tooltipHtml ? { tooltipHtml: meta.tooltipHtml } : {}),
    isFallback: meta.isFallback,
  };
  if (!catalogItem || entry.isPetCage ||
    !Number.isInteger(catalogItem.itemClass) || !Number.isInteger(catalogItem.itemSubclass)) return row;

  const classification = getCatalogAuctionCategory(catalogItem, flavor);
  return {
    ...row,
    ...classification,
    ahSubcategory: classification.ahSubcategory,
    subCategory: catalogItem.subclassName ?? row.subCategory,
    name: catalogItem.name
      ? (entry.suffixId ? `${catalogItem.name} (Variant #${entry.suffixId})` : catalogItem.name)
      : row.name,
    quality: catalogItem.quality ?? row.quality,
    itemLevel: catalogItem.itemLevel ?? row.itemLevel,
    reqLevel: catalogItem.reqLevel ?? row.reqLevel,
    isFallback: row.isFallback && !catalogItem.name,
  };
}

export function baseItemName(row: EnrichedAuctionRow): string {
  return row.name.replace(/ \(Variant #-?\d+\)$/, '');
}

export function sumMarketRows(rows: NormalizedAuctionEntry[]) {
  const totals = { minPrice: Infinity, maxPrice: 0, totalQty: 0, listings: 0 };
  for (const row of rows) {
    totals.minPrice = Math.min(totals.minPrice, row.minPrice);
    totals.maxPrice = Math.max(totals.maxPrice, row.maxPrice);
    totals.totalQty += row.totalQty;
    totals.listings += row.listings;
  }
  return totals;
}

export function groupAuctionVariants(rows: EnrichedAuctionRow[]): EnrichedAuctionRow[] {
  const groups = new Map<string, EnrichedAuctionRow[]>();
  for (const row of rows) {
    const key = row.isPetCage ? row.itemKey : String(row.itemId);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    group.sort((a, b) => a.suffixId - b.suffixId);
    const base = group.find((row) => row.suffixId === 0) ?? group[0]!;
    return {
      ...base,
      ...sumMarketRows(group),
      itemKey: String(base.itemId),
      suffixId: 0,
      name: baseItemName(base),
      variants: group,
    };
  });
}
