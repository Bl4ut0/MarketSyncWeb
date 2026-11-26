import type { FlavorId } from '@marketsync/shared';

/**
 * Disenchanting outcome tables, ported from the MarketSync addon
 * (`MarketSync/Processing.lua`, TBC_DISENCHANT_FALLBACK), which mirrors Auctionator v329.
 *
 * Layout per row: [minItemLevel, maxItemLevel, then repeating triples of
 * (probability %, quantity, material itemId)].
 * Keyed by item class (2 = Weapon, 4 = Armor), then quality (2 = Uncommon,
 * 3 = Rare, 4 = Epic).
 */
type DisenchantRow = readonly number[];
type DisenchantTable = Readonly<Record<number, Readonly<Record<number, readonly DisenchantRow[]>>>>;

const SHARED_RARE: readonly DisenchantRow[] = [
  [11, 25, 100, 1, 10978], [26, 30, 100, 1, 11084], [31, 35, 100, 1, 11138],
  [36, 40, 100, 1, 11139], [41, 45, 100, 1, 11177], [46, 50, 100, 1, 11178],
  [51, 55, 100, 1, 14343], [56, 65, 99.5, 1, 14344, 0.5, 1, 20725],
  [66, 99, 99.5, 1, 22448, 0.5, 1, 20725], [100, 164, 99.5, 1, 22449, 0.5, 1, 22450],
];

export const DISENCHANT_TABLE: DisenchantTable = {
  4: { // Armor
    2: [
      [5, 15, 40, 1, 10940, 40, 2, 10940, 10, 1, 10938, 10, 2, 10938],
      [16, 20, 37.5, 2, 10940, 37.5, 3, 10940, 10, 1, 10939, 10, 2, 10939, 5, 1, 10978],
      [21, 25, 25, 4, 10940, 25, 5, 10940, 25, 6, 10940, 7.5, 1, 10998, 7.5, 2, 10998, 10, 1, 10978],
      [26, 30, 37.5, 1, 11083, 37.5, 2, 11083, 10, 1, 11082, 10, 2, 11082, 5, 1, 11084],
      [31, 35, 18.75, 2, 11083, 18.75, 3, 11083, 18.75, 4, 11083, 18.75, 5, 11083, 10, 1, 11134, 10, 2, 11134, 5, 1, 11138],
      [36, 40, 37.5, 1, 11137, 37.5, 2, 11137, 10, 1, 11135, 10, 2, 11135, 5, 1, 11139],
      [41, 45, 18.75, 2, 11137, 18.75, 3, 11137, 18.75, 4, 11137, 18.75, 5, 11137, 10, 1, 11174, 10, 2, 11174, 5, 1, 11177],
      [46, 50, 37.5, 1, 11176, 37.5, 2, 11176, 10, 1, 11175, 10, 2, 11175, 5, 1, 11178],
      [51, 55, 18.75, 2, 11176, 18.75, 3, 11176, 18.75, 4, 11176, 18.75, 5, 11176, 10, 1, 16202, 10, 2, 16202, 5, 1, 14343],
      [56, 60, 37.5, 1, 16204, 37.5, 2, 16204, 10, 1, 16203, 10, 2, 16203, 5, 1, 14344],
      [61, 65, 18.75, 2, 16204, 18.75, 3, 16204, 18.75, 4, 16204, 18.75, 5, 16204, 10, 2, 16203, 10, 3, 16203, 5, 1, 14344],
      [66, 80, 25, 1, 22445, 25, 2, 22445, 25, 3, 22445, 7.3333333333333, 1, 22447, 7.3333333333333, 2, 22447, 7.3333333333333, 3, 22447, 3, 1, 22448],
      [81, 99, 37.5, 2, 22445, 37.5, 3, 22445, 11, 2, 22447, 11, 3, 22447, 3, 1, 22448],
      [100, 164, 18.75, 2, 22445, 18.75, 3, 22445, 18.75, 4, 22445, 18.75, 5, 22445, 11, 1, 22446, 11, 2, 22446, 3, 1, 22449],
    ],
    3: SHARED_RARE,
    4: [
      [40, 45, 33.333333333333, 2, 11177, 33.333333333333, 3, 11177, 33.333333333333, 4, 11177],
      [46, 50, 33.333333333333, 2, 11178, 33.333333333333, 3, 11178, 33.333333333333, 4, 11178],
      [51, 55, 33.333333333333, 2, 14343, 33.333333333333, 3, 14343, 33.333333333333, 4, 14343],
      [56, 60, 100, 1, 20725], [61, 80, 50, 1, 20725, 50, 2, 20725],
      [95, 100, 50, 1, 22450, 50, 2, 22450], [105, 164, 33.3, 1, 22450, 66.6, 2, 22450],
    ],
  },
  2: { // Weapons
    2: [
      [6, 15, 10, 1, 10940, 10, 2, 10940, 40, 1, 10938, 40, 2, 10938],
      [16, 20, 10, 2, 10940, 10, 3, 10940, 37.5, 1, 10939, 37.5, 2, 10939, 5, 1, 10978],
      [21, 25, 5, 4, 10940, 5, 5, 10940, 5, 6, 10940, 37.5, 1, 10939, 37.5, 2, 10939, 10, 1, 10978],
      [26, 30, 10, 1, 11083, 10, 2, 11083, 37.5, 1, 10939, 37.5, 2, 10939, 5, 1, 11084],
      [31, 35, 5, 2, 11083, 5, 3, 11083, 5, 4, 11083, 5, 5, 11083, 37.5, 1, 11134, 37.5, 2, 11134, 5, 1, 11138],
      [36, 40, 10, 1, 11137, 10, 2, 11137, 37.5, 1, 11135, 37.5, 2, 11135, 5, 1, 11139],
      [41, 45, 5, 2, 11137, 5, 3, 11137, 5, 4, 11137, 5, 5, 11137, 37.5, 1, 11174, 37.5, 2, 11174, 5, 1, 11177],
      [46, 50, 10, 1, 11176, 10, 2, 11176, 37.5, 1, 11175, 37.5, 2, 11175, 5, 1, 11178],
      [51, 55, 5.5, 2, 11176, 5.5, 3, 11176, 5.5, 4, 11176, 5.5, 5, 11176, 37.5, 1, 16202, 37.5, 2, 16202, 5, 1, 14343],
      [56, 60, 11, 1, 16204, 11, 2, 16204, 37.5, 1, 16203, 37.5, 2, 16203, 5, 1, 14344],
      [61, 65, 5.5, 2, 16204, 5.5, 3, 16204, 5.5, 4, 16204, 5.5, 5, 16204, 37.5, 2, 16203, 37.5, 3, 16203, 5, 1, 14344],
      [66, 99, 11, 2, 22445, 11, 3, 22445, 37.5, 2, 22447, 37.5, 3, 22447, 3, 1, 22448],
      [100, 164, 5.5, 2, 22445, 5.5, 3, 22445, 5.5, 4, 22445, 5.5, 5, 22445, 37.5, 1, 22446, 37.5, 2, 22446, 3, 1, 22449],
    ],
    3: SHARED_RARE,
    4: [
      [40, 45, 33.333333333333, 2, 11177, 33.333333333333, 3, 11177, 33.333333333333, 4, 11177],
      [46, 50, 33.333333333333, 2, 11178, 33.333333333333, 3, 11178, 33.333333333333, 4, 11178],
      [51, 55, 33.333333333333, 2, 14343, 33.333333333333, 3, 14343, 33.333333333333, 4, 14343],
      [56, 60, 100, 1, 20725], [61, 80, 33.3, 1, 20725, 66.6, 2, 20725],
      [95, 100, 50, 1, 22450, 50, 2, 22450], [105, 164, 33.3, 1, 22450, 66.6, 2, 22450],
    ],
  },
};

export interface DisenchantDrop {
  itemId: number;
  /** Expected quantity per disenchant (probability × quantity, summed). */
  expected: number;
  /** Chance of getting this material at all. */
  chance: number;
}

/** Item classes that can be disenchanted. */
export const DISENCHANTABLE_CLASSES: ReadonlySet<number> = new Set([2, 4]);

/**
 * Vanilla-era editions (Forever, Classic Era) stop at the last Classic bracket,
 * as the addon does: never price Classic gear as TBC dust, essence or shards.
 * Retail is not covered by these tables.
 */
function maxRowLevel(flavor: FlavorId, quality: number): number | null {
  if (flavor === 'retail') return null;
  if (flavor === 'forever' || flavor === 'classicEra') return quality === 4 ? 80 : 65;
  return Infinity;
}

/** Expected disenchant materials for one item, or an empty list when it cannot be disenchanted. */
export function disenchantDrops(
  flavor: FlavorId,
  itemClass: number | undefined,
  quality: number | undefined,
  itemLevel: number | undefined,
): DisenchantDrop[] {
  if (itemClass === undefined || quality === undefined || itemLevel === undefined) return [];
  const cap = maxRowLevel(flavor, quality);
  const rows = DISENCHANT_TABLE[itemClass]?.[quality];
  if (cap === null || !rows) return [];
  const ilvl = Math.floor(itemLevel);
  const row = rows.find((r) => r[1]! <= cap && ilvl >= r[0]! && ilvl <= r[1]!);
  if (!row) return [];
  const byItem = new Map<number, DisenchantDrop>();
  for (let i = 2; i + 2 < row.length; i += 3) {
    const probability = Math.max(0, row[i]!) / 100;
    const quantity = Math.max(0, row[i + 1]!);
    const itemId = row[i + 2]!;
    if (probability <= 0 || quantity <= 0) continue;
    const drop = byItem.get(itemId) ?? { itemId, expected: 0, chance: 0 };
    drop.expected += probability * quantity;
    drop.chance += probability;
    byItem.set(itemId, drop);
  }
  return [...byItem.values()].sort((a, b) => a.itemId - b.itemId);
}
