import {
  getExpectedFactions,
  normalizeFaction,
  normalizeFlavorId,
  normalizePartitionKey,
} from './flavors.js';
import { normalizeItemKey } from './items.js';
import type {
  ComputedSnapshotStats,
  DatasetBlockMeta,
  DatasetIndex,
  FactionPartition,
  FlavorId,
  NormalizedAuctionEntry,
  NormalizedPartition,
  NormalizedSnapshot,
  PriceBucket,
  SnapshotStats,
} from './types.js';

export const MAX_COPPER = 99_999_999_999;

const DATASET_PATH_RE = /^datasets\/[a-zA-Z0-9_/-]+\.json$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_RE = /^\d{2}$/;

export interface CopperParts {
  gold: number;
  silver: number;
  copper: number;
}

export interface FormatCopperOptions {
  compact?: boolean;
}

export interface ParseDatasetIndexOptions {
  includeSimulated?: boolean;
  dedupeByFlavorHour?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function splitCopper(copperValue: number): CopperParts {
  if (!Number.isSafeInteger(copperValue) || copperValue < 0) {
    throw new RangeError(
      `Invalid copper amount: expected non-negative safe integer, received ${copperValue}`,
    );
  }
  const gold = Math.floor(copperValue / 10000);
  const silver = Math.floor(copperValue / 100) % 100;
  const copper = copperValue % 100;
  return { gold, silver, copper };
}

export function formatCopper(
  copperValue: number,
  options?: FormatCopperOptions,
): string {
  const { gold, silver, copper } = splitCopper(copperValue);

  if (options?.compact) {
    const parts: string[] = [];
    if (gold > 0) parts.push(`${gold.toLocaleString('en-US')}g`);
    if (silver > 0) parts.push(`${silver}s`);
    if (copper > 0 || parts.length === 0) parts.push(`${copper}c`);
    return parts.join(' ');
  }

  if (gold > 0) {
    return `${gold.toLocaleString('en-US')}g ${String(silver).padStart(2, '0')}s ${String(copper).padStart(2, '0')}c`;
  }
  if (silver > 0) {
    return `${silver}s ${String(copper).padStart(2, '0')}c`;
  }
  return `${copper}c`;
}

export function parseCopper(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) {
      throw new RangeError(
        `Invalid copper amount: expected non-negative safe integer, received ${input}`,
      );
    }
    return input;
  }

  if (typeof input !== 'string') {
    throw new Error(`Invalid copper input type: ${typeof input}`);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Empty copper string');
  }
  if (trimmed.includes('-')) {
    throw new RangeError(`Negative copper values are not allowed: "${input}"`);
  }

  // Plain integer copper string
  if (/^\d+$/.test(trimmed)) {
    const big = BigInt(trimmed);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`Copper amount exceeds MAX_SAFE_INTEGER: "${input}"`);
    }
    return Number(big);
  }

  // WoW formatted string e.g. "9,999,999g 99s 99c", "1.5g", "25s 50c"
  const compact = trimmed.replace(/\s+/g, '');
  const tokenRe = /^([0-9][0-9,]*(?:\.[0-9]+)?)(g|s|c)/i;
  let rest = compact;
  let totalCopper = 0n;
  const seenUnits = new Set<string>();
  let hasGold = false;
  let hasSilver = false;

  while (rest.length > 0) {
    const match = tokenRe.exec(rest);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Malformed copper string: "${input}"`);
    }
    const rawNum = match[1].replace(/,/g, '');
    const unit = match[2].toLowerCase();
    if (seenUnits.has(unit)) {
      throw new Error(`Duplicate currency unit "${unit}" in "${input}"`);
    }
    seenUnits.add(unit);

    if (rawNum.includes('.')) {
      if (unit === 'c') {
        throw new Error(`Fractional copper is not allowed: "${input}"`);
      }
      const num = Number(rawNum);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`Invalid numeric value in copper string: "${input}"`);
      }
      const mult = unit === 'g' ? 10000 : 100;
      const converted = Math.round(num * mult);
      if (!Number.isSafeInteger(converted)) {
        throw new RangeError(`Copper amount exceeds MAX_SAFE_INTEGER: "${input}"`);
      }
      totalCopper += BigInt(converted);
    } else {
      const value = BigInt(rawNum);
      if (unit === 'g') {
        hasGold = true;
        totalCopper += value * 10000n;
      } else if (unit === 's') {
        if (hasGold && value >= 100n) {
          throw new RangeError(`Silver component must be < 100 when gold is present: "${input}"`);
        }
        hasSilver = true;
        totalCopper += value * 100n;
      } else {
        if ((hasGold || hasSilver) && value >= 100n) {
          throw new RangeError(`Copper component must be < 100 when gold/silver is present: "${input}"`);
        }
        totalCopper += value;
      }
    }

    rest = rest.slice(match[0].length);
  }

  if (totalCopper > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Copper amount exceeds MAX_SAFE_INTEGER: "${input}"`);
  }

  return Number(totalCopper);
}

function validateDatasetPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    throw new Error('Dataset block path must be a string');
  }
  const trimmed = rawPath.trim();
  if (trimmed.includes('..') || !DATASET_PATH_RE.test(trimmed)) {
    throw new Error(`Invalid or unsafe dataset block path: "${rawPath}"`);
  }
  return trimmed;
}

function assertNonNegativeSafeNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}: expected non-negative finite number`);
  }
  return value;
}

function parseAnalyticsManifest(raw: unknown): DatasetBlockMeta['analytics'] {
  if (!isPlainObject(raw) || typeof raw.revision !== 'string' ||
      !/^[a-f0-9]{24}$/.test(raw.revision) || !Array.isArray(raw.partitions)) return;
  const partitions = [];
  for (const partition of raw.partitions) {
    if (!isPlainObject(partition) || typeof partition.key !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(partition.key) || typeof partition.label !== 'string' ||
        typeof partition.entryCount !== 'number' || !Number.isSafeInteger(partition.entryCount) ||
        partition.entryCount < 0 || !Array.isArray(partition.factions) ||
        !partition.factions.every((f) => typeof f === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(f))) {
      return;
    }
    partitions.push({
      key: partition.key,
      label: partition.label,
      entryCount: partition.entryCount,
      factions: partition.factions as string[],
    });
  }
  return { revision: raw.revision, partitions };
}

export function parseDatasetIndex(
  raw: unknown,
  options?: ParseDatasetIndexOptions,
): DatasetIndex {
  if (!isPlainObject(raw) || !Array.isArray(raw.blocks)) {
    throw new Error('Invalid dataset index: expected object with blocks array');
  }

  const lastUpdated =
    raw.lastUpdated === null || raw.lastUpdated === undefined
      ? null
      : typeof raw.lastUpdated === 'string'
        ? raw.lastUpdated
        : (() => {
            throw new Error('Invalid dataset index: lastUpdated must be string or null');
          })();

  const byPath = new Map<string, DatasetBlockMeta>();

  for (const rawBlock of raw.blocks) {
    if (!isPlainObject(rawBlock)) {
      throw new Error('Invalid dataset index block: expected object');
    }

    const path = validateDatasetPath(rawBlock.path);
    const date = typeof rawBlock.date === 'string' ? rawBlock.date.trim() : '';
    const hour = typeof rawBlock.hour === 'string' ? rawBlock.hour.trim() : '';
    if (!ISO_DATE_RE.test(date)) {
      throw new Error(`Invalid dataset block date: "${String(rawBlock.date)}"`);
    }
    if (!HOUR_RE.test(hour)) {
      throw new Error(`Invalid dataset block hour: "${String(rawBlock.hour)}"`);
    }

    const rawFlavor =
      typeof rawBlock.flavor === 'string' ? rawBlock.flavor : undefined;
    const isLegacyPath = !rawFlavor || rawFlavor.trim() === '';
    const flavor = normalizeFlavorId(rawFlavor);

    const items = assertNonNegativeSafeNumber(rawBlock.items, 'items');
    const volume = assertNonNegativeSafeNumber(rawBlock.volume, 'volume');
    const timestamp = assertNonNegativeSafeNumber(rawBlock.timestamp, 'timestamp');
    const simulated = Boolean(rawBlock.simulated);
    const analytics = parseAnalyticsManifest(rawBlock.analytics);

    const normalized: DatasetBlockMeta = {
      flavor,
      date,
      hour,
      path,
      items,
      volume,
      timestamp,
      simulated,
      isLegacyPath,
      ...(rawBlock.analyticsReady === true ? { analyticsReady: true } : {}),
      ...(analytics ? { analytics } : {}),
    };

    const existing = byPath.get(path);
    if (!existing || normalized.timestamp >= existing.timestamp) {
      byPath.set(path, normalized);
    }
  }

  let blocks = Array.from(byPath.values());

  if (options?.includeSimulated === false) {
    blocks = blocks.filter((b) => !b.simulated);
  }

  if (options?.dedupeByFlavorHour) {
    const bySlot = new Map<string, DatasetBlockMeta>();
    for (const block of blocks) {
      const slot = `${block.flavor}|${block.date}|${block.hour}`;
      const existing = bySlot.get(slot);
      if (
        !existing ||
        block.timestamp > existing.timestamp ||
        (block.timestamp === existing.timestamp && existing.isLegacyPath && !block.isLegacyPath)
      ) {
        bySlot.set(slot, block);
      }
    }
    blocks = Array.from(bySlot.values());
  }

  blocks.sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    if (b.hour !== a.hour) return b.hour.localeCompare(a.hour);
    if (a.flavor !== b.flavor) return a.flavor.localeCompare(b.flavor);
    return a.path.localeCompare(b.path);
  });

  const latestByFlavor: Partial<Record<FlavorId, DatasetBlockMeta>> = {};
  const latestLiveByFlavor: Partial<Record<FlavorId, DatasetBlockMeta>> = {};

  for (const block of blocks) {
    if (!latestByFlavor[block.flavor]) {
      latestByFlavor[block.flavor] = block;
    }
    if (!block.simulated && !latestLiveByFlavor[block.flavor]) {
      latestLiveByFlavor[block.flavor] = block;
    }
  }

  return {
    blocks,
    lastUpdated,
    latestByFlavor,
    latestLiveByFlavor,
  };
}

function isValidPriceBucket(value: unknown): value is PriceBucket {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.minPrice === 'number' &&
    Number.isFinite(value.minPrice) &&
    value.minPrice > 0 &&
    typeof value.maxPrice === 'number' &&
    Number.isFinite(value.maxPrice) &&
    value.maxPrice > 0 &&
    typeof value.totalQty === 'number' &&
    Number.isFinite(value.totalQty) &&
    value.totalQty > 0 &&
    typeof value.listings === 'number' &&
    Number.isFinite(value.listings) &&
    value.listings > 0
  );
}

/** A market filter limits normalized entries while preserving the capture metadata. */
export function normalizeSnapshot(
  raw: unknown,
  fallbackFlavor?: FlavorId,
  market?: { partitionKey: string; faction: string },
): NormalizedSnapshot {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid snapshot block: expected JSON object');
  }
  if (!isPlainObject(raw.rulesets)) {
    throw new Error('Invalid snapshot block: missing rulesets object');
  }

  const rawFlavor =
    typeof raw.flavor === 'string' && raw.flavor.trim() !== ''
      ? raw.flavor
      : undefined;
  const flavor: FlavorId = rawFlavor
    ? normalizeFlavorId(rawFlavor)
    : (fallbackFlavor ?? 'forever');

  const version = typeof raw.version === 'string' ? raw.version : '1.0';
  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : 0;
  const isoDate =
    typeof raw.isoDate === 'string'
      ? raw.isoDate
      : new Date(timestamp * 1000).toISOString();
  const region = typeof raw.region === 'string' ? raw.region : 'us';

  const rawStats = isPlainObject(raw.stats) ? raw.stats : {};
  const declaredStatus =
    typeof rawStats.status === 'string' ? rawStats.status : 'live';
  const declaredStats: SnapshotStats = {
    totalItems:
      typeof rawStats.totalItems === 'number' && Number.isFinite(rawStats.totalItems)
        ? rawStats.totalItems
        : 0,
    totalVolume:
      typeof rawStats.totalVolume === 'number' && Number.isFinite(rawStats.totalVolume)
        ? rawStats.totalVolume
        : 0,
    status: declaredStatus,
  };
  const simulated = declaredStatus === 'simulated';

  const expectedFactions = getExpectedFactions(flavor);
  const sourceMarkets = isPlainObject(raw.markets) ? raw.markets : {};
  const partitions: Record<string, NormalizedPartition> = {};
  const snapshotUniqueKeys = new Set<string>();
  let snapshotEntryCount = 0;
  let snapshotTotalVolume = 0;
  let snapshotTotalListings = 0;

  for (const [rawPartitionKey, rawFactionsObj] of Object.entries(raw.rulesets)) {
    if (!isPlainObject(rawFactionsObj)) continue;

    const { key: partitionKey, label } = normalizePartitionKey(
      flavor,
      rawPartitionKey,
    );
    if (market && partitionKey !== market.partitionKey) continue;

    let partition = partitions[partitionKey];
    if (!partition) {
      partition = {
        key: partitionKey,
        rawKeys: [],
        label,
        factions: {},
        missingExpectedFactions: [],
        entryCount: 0,
        uniqueItemCount: 0,
        totalVolume: 0,
        totalListings: 0,
      };
      partitions[partitionKey] = partition;
    }
    if (!partition.rawKeys.includes(rawPartitionKey)) {
      partition.rawKeys.push(rawPartitionKey);
    }

    for (const [rawFaction, rawItemsObj] of Object.entries(rawFactionsObj)) {
      if (!isPlainObject(rawItemsObj)) continue;

      const faction: FactionPartition = normalizeFaction(rawFaction);
      if (market && faction !== market.faction) continue;
      const partitionStates = sourceMarkets[rawPartitionKey];
      const state = isPlainObject(partitionStates) ? partitionStates[rawFaction] : undefined;
      if (isPlainObject(state) && (
        state.status === 'available' || state.status === 'empty' || state.status === 'partial' || state.status === 'unavailable'
      )) {
        partition.marketStates ??= {};
        partition.marketStates[faction] = {
          status: state.status,
          upstreamListings: typeof state.upstreamListings === 'number' && Number.isSafeInteger(state.upstreamListings)
            ? Math.max(0, state.upstreamListings) : 0,
        };
      }
      let factionBucket = partition.factions[faction];
      if (!factionBucket) {
        factionBucket = {};
        partition.factions[faction] = factionBucket;
      }

      for (const [rawItemKey, rawBucket] of Object.entries(rawItemsObj)) {
        if (!isValidPriceBucket(rawBucket)) continue;

        const parsed = normalizeItemKey(rawItemKey);
        const minPrice = Math.trunc(rawBucket.minPrice);
        const maxPrice = Math.max(minPrice, Math.trunc(rawBucket.maxPrice));
        const totalQty = Math.trunc(rawBucket.totalQty);
        const listings = Math.trunc(rawBucket.listings);
        const time =
          typeof rawBucket.time === 'number' && Number.isFinite(rawBucket.time)
            ? Math.trunc(rawBucket.time)
            : Math.trunc(timestamp);

        const existing = factionBucket[parsed.canonicalKey];
        if (existing) {
          existing.minPrice = Math.min(existing.minPrice, minPrice);
          existing.maxPrice = Math.max(existing.maxPrice, maxPrice);
          existing.totalQty += totalQty;
          existing.listings += listings;
          existing.time = Math.max(existing.time, time);
        } else {
          const entry: NormalizedAuctionEntry = {
            itemKey: parsed.canonicalKey,
            itemId: parsed.itemId,
            suffixId: parsed.suffix,
            isPetCage: parsed.isPetCage,
            ...(parsed.petSpeciesId !== undefined
              ? { petSpeciesId: parsed.petSpeciesId }
              : {}),
            minPrice,
            maxPrice,
            totalQty,
            listings,
            time,
          };
          factionBucket[parsed.canonicalKey] = entry;
        }
      }
    }
  }

  for (const partition of Object.values(partitions)) {
    const presentFactions = new Set(Object.keys(partition.factions));
    partition.missingExpectedFactions = expectedFactions.filter(
      (f) => !presentFactions.has(f),
    );

    const partitionUnique = new Set<string>();
    let entryCount = 0;
    let totalVolume = 0;
    let totalListings = 0;

    for (const itemsMap of Object.values(partition.factions)) {
      for (const entry of Object.values(itemsMap)) {
        entryCount += 1;
        partitionUnique.add(entry.itemKey);
        snapshotUniqueKeys.add(entry.itemKey);
        totalVolume += entry.totalQty;
        totalListings += entry.listings;
      }
    }

    partition.entryCount = entryCount;
    partition.uniqueItemCount = partitionUnique.size;
    partition.totalVolume = totalVolume;
    partition.totalListings = totalListings;

    snapshotEntryCount += entryCount;
    snapshotTotalVolume += totalVolume;
    snapshotTotalListings += totalListings;
  }

  const computedStats: ComputedSnapshotStats = {
    partitionCount: Object.keys(partitions).length,
    entryCount: snapshotEntryCount,
    uniqueItemCount: snapshotUniqueKeys.size,
    totalVolume: snapshotTotalVolume,
    totalListings: snapshotTotalListings,
  };

  return {
    version,
    flavor,
    timestamp,
    isoDate,
    region,
    simulated,
    status: declaredStatus,
    partitions,
    declaredStats,
    computedStats,
  };
}
