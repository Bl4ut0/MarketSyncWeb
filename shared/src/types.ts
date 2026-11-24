export type FlavorId = 'forever' | 'classicEra' | 'anniversary' | 'classic' | 'retail';

export type FactionPartition =
  | 'Alliance'
  | 'Horde'
  | 'Neutral'
  | 'CrossFaction'
  | 'Commodities'
  | (string & {});

export type PartitionKind = 'ruleset' | 'realm' | 'region';

export interface RulesetOrRealmMeta {
  readonly slug: string;
  readonly label: string;
  readonly rulesetTag?:
    | 'PvP'
    | 'Normal'
    | 'Roleplay'
    | 'Roleplay PvP'
    | 'Hardcore'
    | 'Seasonal'
    | 'Region';
  readonly region?: string;
}

export interface FlavorConfig {
  readonly id: FlavorId;
  readonly label: string;
  readonly shortLabel: string;
  readonly eraTag: string;
  readonly codename: string;
  readonly apiNamespaces: {
    readonly dynamicPrefix: string;
    readonly profilePrefix: string;
  };
  readonly clientInterfaces: readonly number[];
  readonly partitionType: PartitionKind;
  readonly defaultFactions: readonly FactionPartition[];
  readonly knownPartitions: readonly RulesetOrRealmMeta[];
  readonly logoUrl: string;
  readonly localLogoFallback: string;
  readonly fallbackLogoUrl: string;
}

export interface PriceBucket {
  minPrice: number;
  maxPrice: number;
  totalQty: number;
  listings: number;
  time: number;
}

export type RawItemEntry = PriceBucket;

export type MarketCaptureStatus = 'available' | 'empty' | 'partial' | 'unavailable';

export interface MarketCaptureState {
  status: MarketCaptureStatus;
  upstreamListings: number;
}

export interface RawDatasetBlockMeta {
  flavor?: string;
  date: string;
  hour: string;
  path: string;
  items: number;
  volume: number;
  timestamp: number;
  simulated?: boolean;
}

export type RawSnapshotIndexEntry = RawDatasetBlockMeta;

export interface RawDatasetIndex {
  blocks: RawDatasetBlockMeta[];
  lastUpdated: string | null;
}

export type RawSnapshotIndex = RawDatasetIndex;

export interface AnalyticsManifest {
  revision: string;
  partitions: Array<{
    key: string;
    label: string;
    entryCount: number;
    factions: string[];
  }>;
}

export interface DatasetBlockMeta {
  flavor: FlavorId;
  date: string;
  hour: string;
  path: string;
  items: number;
  volume: number;
  timestamp: number;
  simulated: boolean;
  isLegacyPath: boolean;
  analyticsReady?: boolean;
  analytics?: AnalyticsManifest;
}

export type NormalizedIndexBlock = DatasetBlockMeta;

export interface DatasetIndex {
  blocks: DatasetBlockMeta[];
  lastUpdated: string | null;
  latestByFlavor: Partial<Record<FlavorId, DatasetBlockMeta>>;
  latestLiveByFlavor: Partial<Record<FlavorId, DatasetBlockMeta>>;
}

export interface SnapshotStats {
  totalItems: number;
  totalVolume: number;
  status: 'live' | 'simulated' | string;
}

export interface SnapshotBlock {
  version: string;
  flavor?: string;
  timestamp: number;
  isoDate: string;
  region: string;
  rulesets: Record<string, Record<string, Record<string, PriceBucket>>>;
  stats: SnapshotStats;
}

export type RawSnapshotBlock = SnapshotBlock;

export interface NormalizedAuctionEntry {
  itemKey: string;
  itemId: number;
  suffixId: number;
  isPetCage: boolean;
  petSpeciesId?: number;
  minPrice: number;
  maxPrice: number;
  totalQty: number;
  listings: number;
  time: number;
}

export interface NormalizedPartition {
  key: string;
  rawKeys: string[];
  label: string;
  factions: Record<string, Record<string, NormalizedAuctionEntry>>;
  marketStates?: Record<string, MarketCaptureState>;
  missingExpectedFactions: FactionPartition[];
  entryCount: number;
  uniqueItemCount: number;
  totalVolume: number;
  totalListings: number;
}

export interface ComputedSnapshotStats {
  partitionCount: number;
  entryCount: number;
  uniqueItemCount: number;
  totalVolume: number;
  totalListings: number;
}

export interface NormalizedSnapshot {
  version: string;
  flavor: FlavorId;
  timestamp: number;
  isoDate: string;
  region: string;
  simulated: boolean;
  status: string;
  partitions: Record<string, NormalizedPartition>;
  declaredStats: SnapshotStats;
  computedStats: ComputedSnapshotStats;
}

export type NormalizedSnapshotBlock = NormalizedSnapshot;

export interface PriceHistoryPoint {
  timestamp: number;
  isoDate: string;
  minPrice: number;
  maxPrice: number;
  totalQty: number;
  listings: number;
}

export type ItemQuality = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AhCategoryId =
  | 'weapons'
  | 'armor'
  | 'containers'
  | 'consumables'
  | 'glyphs'
  | 'trade-goods'
  | 'projectile'
  | 'quiver'
  | 'recipes'
  | 'reagent'
  | 'gems'
  | 'item-enhancement'
  | 'profession-equipment'
  | 'housing'
  | 'battle-pets'
  | 'quest-items'
  | 'miscellaneous'
  | 'wow-token';

export interface AhSubcategoryNode {
  readonly id: string;
  readonly label: string;
}

export interface AhCategoryNode {
  readonly id: AhCategoryId;
  readonly label: string;
  readonly subCategories?: readonly AhSubcategoryNode[];
}

export interface ItemMetadata {
  itemKey: string;
  itemId: number;
  suffix: number;
  isPetCage: boolean;
  petSpeciesId?: number;
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
  stackSize?: number;
  isSeeded: boolean;
  isFallback: boolean;
}

export type ItemMeta = ItemMetadata;

export interface ShoppingListItem {
  id: number;
  s?: number;
  q: number;
  m?: number;
  nm?: string;
  nt?: string;
  d?: 0 | 1;
  a?: 0 | 1;
}

export interface ShoppingList {
  v: 1;
  n: string;
  f?: FlavorId;
  r?: string;
  fa?: FactionPartition;
  i: ShoppingListItem[];
}

export interface ShoppingListItemInput {
  id: number;
  s?: number | null;
  q?: number | null;
  m?: number | null;
  nm?: string | null;
  nt?: string | null;
  d?: 0 | 1 | boolean | null;
  a?: 0 | 1 | boolean | null;
}

export interface ShoppingListInput {
  v?: 1;
  n: string;
  f?: FlavorId | string | null;
  r?: string | null;
  fa?: FactionPartition | null;
  i: readonly ShoppingListItemInput[];
}

export type CodecErrorCode =
  | 'INVALID_PREFIX'
  | 'INVALID_FORMAT'
  | 'INVALID_BASE64URL'
  | 'CHECKSUM_MISMATCH'
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_SCHEMA';

export type CodecDecodeResult =
  | { ok: true; list: ShoppingList; crc32: string }
  | { ok: false; code: CodecErrorCode; message: string };

export interface LinkedCharacter {
  id: string;
  userId: string;
  region: string;
  flavor: FlavorId;
  namespace: string;
  name: string;
  surname?: string;
  realmSlug?: string;
  ruleset?: string;
  faction?: FactionPartition;
  level?: number;
  className?: string;
}

export type AlertCondition = 'below' | 'above';

export interface AlertRule {
  id: string;
  userId: string;
  characterId?: string;
  listId?: string;
  flavor: FlavorId;
  partitionKey: string;
  faction: FactionPartition;
  itemKey: string;
  condition: AlertCondition;
  maxPriceCopper: number;
  thresholdCopper: number;
  enabled: boolean;
  notifyOnsite: boolean;
  emailEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  alertRuleId?: string;
  flavor: FlavorId;
  partitionKey: string;
  faction: FactionPartition;
  itemKey: string;
  itemName: string;
  observedPriceCopper: number;
  thresholdPriceCopper: number;
  snapshotTimestamp: number;
  read: boolean;
  emailed: boolean;
  createdAt: string;
}

export interface ApiHealth {
  ok: true;
  mode: 'cloudflare' | 'selfhosted';
  version: string;
}

export interface Capabilities {
  mode: 'cloudflare' | 'selfhosted';
  persistence: boolean;
  oauth: boolean;
  email: boolean;
  flavors: FlavorId[];
}

export type ApiCapabilities = Capabilities;
