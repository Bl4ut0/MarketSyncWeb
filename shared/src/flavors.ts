import type {
  FactionPartition,
  FlavorConfig,
  FlavorId,
  RulesetOrRealmMeta,
} from './types.js';

export const FLAVOR_IDS: readonly FlavorId[] = [
  'forever',
  'classicEra',
  'anniversary',
  'classic',
  'retail',
] as const;

export const CANONICAL_FACTIONS: readonly FactionPartition[] = [
  'Alliance',
  'Horde',
  'Neutral',
  'CrossFaction',
  'Commodities',
] as const;

export const BLIZZARD_FALLBACK_LOGO_URL =
  'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt23a35e1d1a7674d9/6a6117de38e97fd2f2769476/wow-logo.png';

export const FLAVORS: Record<FlavorId, FlavorConfig> = {
  forever: {
    id: 'forever',
    label: 'WoW: Forever',
    shortLabel: 'Forever',
    eraTag: 'Forever Ruleset Realms',
    codename: 'camelot',
    apiNamespaces: {
      dynamicPrefix: 'dynamic-forever',
      profilePrefix: 'profile-forever',
    },
    clientInterfaces: [16001],
    partitionType: 'ruleset',
    defaultFactions: ['Alliance', 'Horde', 'Neutral'],
    knownPartitions: [
      { slug: 'pvp', label: 'PvP', rulesetTag: 'PvP' },
      { slug: 'normal', label: 'Normal', rulesetTag: 'Normal' },
      { slug: 'roleplay', label: 'Roleplay', rulesetTag: 'Roleplay' },
      { slug: 'roleplaypvp', label: 'Roleplay PvP', rulesetTag: 'Roleplay PvP' },
    ],
    logoUrl:
      'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/bltc6dba3e7eef81c85/6a9bc2941deff3b5a94390dd/camelot-logo.png',
    localLogoFallback: '/assets/blizzard-trademarks/forever-logo.png',
    fallbackLogoUrl: BLIZZARD_FALLBACK_LOGO_URL,
  },
  classicEra: {
    id: 'classicEra',
    label: 'WoW Classic Era',
    shortLabel: 'Classic Era',
    eraTag: '1.15.x Era',
    codename: 'classic1x',
    apiNamespaces: {
      dynamicPrefix: 'dynamic-classic1x',
      profilePrefix: 'profile-classic1x',
    },
    clientInterfaces: [11509, 11508],
    partitionType: 'realm',
    defaultFactions: ['Alliance', 'Horde', 'Neutral'],
    knownPartitions: [],
    logoUrl:
      'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt8b3f311b12c5b391/6a9222612437ed42f9d486c2/wow-classic.png',
    localLogoFallback: '/assets/blizzard-trademarks/classicEra-logo.png',
    fallbackLogoUrl: BLIZZARD_FALLBACK_LOGO_URL,
  },
  anniversary: {
    id: 'anniversary',
    label: 'WoW Classic Anniversary',
    shortLabel: 'Anniversary',
    eraTag: '20th Anniversary',
    codename: 'classicann',
    apiNamespaces: {
      dynamicPrefix: 'dynamic-classicann',
      profilePrefix: 'profile-classicann',
    },
    clientInterfaces: [20506, 20505, 11509, 11508],
    partitionType: 'realm',
    defaultFactions: ['Alliance', 'Horde', 'Neutral'],
    knownPartitions: [
      { slug: 'dreamscythe', label: 'Dreamscythe', rulesetTag: 'Normal', region: 'us' },
      { slug: 'nightslayer', label: 'Nightslayer', rulesetTag: 'PvP', region: 'us' },
      { slug: 'maladath', label: 'Maladath (AU)', rulesetTag: 'Normal', region: 'us' },
      { slug: 'doomhowl', label: 'Doomhowl (Hardcore)', rulesetTag: 'Hardcore', region: 'us' },
    ],
    logoUrl:
      'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blte4c0e27d03065f99/6a8921ab1deff340d1438f68/classic-bcc-logo.png',
    localLogoFallback: '/assets/blizzard-trademarks/anniversary-logo.png',
    fallbackLogoUrl: BLIZZARD_FALLBACK_LOGO_URL,
  },
  classic: {
    id: 'classic',
    label: 'Mists of Pandaria Classic',
    shortLabel: 'Classic Progression',
    eraTag: 'Progression',
    codename: 'classic',
    apiNamespaces: {
      dynamicPrefix: 'dynamic-classic',
      profilePrefix: 'profile-classic',
    },
    clientInterfaces: [50503, 38000, 20506, 20505],
    partitionType: 'realm',
    defaultFactions: ['CrossFaction'],
    knownPartitions: [],
    logoUrl:
      'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt18ffd520906ba5e0/6a89224a2c0580a337273b2c/classic-mop-logo.png',
    localLogoFallback: '/assets/blizzard-trademarks/classic-logo.png',
    fallbackLogoUrl: BLIZZARD_FALLBACK_LOGO_URL,
  },
  retail: {
    id: 'retail',
    label: 'World of Warcraft: Midnight',
    shortLabel: 'Retail',
    eraTag: 'Modern / Mainline',
    codename: 'mainline',
    apiNamespaces: {
      dynamicPrefix: 'dynamic',
      profilePrefix: 'profile',
    },
    clientInterfaces: [120001, 120000],
    partitionType: 'region',
    defaultFactions: ['Commodities'],
    knownPartitions: [{ slug: 'region', label: 'Region-Wide', rulesetTag: 'Region' }],
    logoUrl:
      'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt72d80cd6c38f4fb6/6a9224dc9b942e1a81f741e5/midnight-logo-homepage.png',
    localLogoFallback: '/assets/blizzard-trademarks/retail-logo.png',
    fallbackLogoUrl: BLIZZARD_FALLBACK_LOGO_URL,
  },
};

const FLAVOR_ALIAS_MAP: Record<string, FlavorId> = {
  forever: 'forever',
  camelot: 'forever',
  classicera: 'classicEra',
  classic1x: 'classicEra',
  era: 'classicEra',
  anniversary: 'anniversary',
  classicann: 'anniversary',
  classicanniversary: 'anniversary',
  bccanniversary: 'anniversary',
  classic: 'classic',
  progression: 'classic',
  classicprogression: 'classic',
  mop: 'classic',
  retail: 'retail',
  mainline: 'retail',
  midnight: 'retail',
};

const FOREVER_RULESET_MAP: Record<string, { key: string; label: string }> = {
  p: { key: 'pvp', label: 'PvP' },
  pvp: { key: 'pvp', label: 'PvP' },
  n: { key: 'normal', label: 'Normal' },
  normal: { key: 'normal', label: 'Normal' },
  pve: { key: 'normal', label: 'Normal' },
  r: { key: 'roleplay', label: 'Roleplay' },
  rp: { key: 'roleplay', label: 'Roleplay' },
  roleplay: { key: 'roleplay', label: 'Roleplay' },
  rppvp: { key: 'roleplaypvp', label: 'Roleplay PvP' },
  roleplaypvp: { key: 'roleplaypvp', label: 'Roleplay PvP' },
  english: { key: 'english', label: 'English' },
};

const FACTION_ALIAS_MAP: Record<string, FactionPartition> = {
  alliance: 'Alliance',
  horde: 'Horde',
  neutral: 'Neutral',
  blackwater: 'Neutral',
  crossfaction: 'CrossFaction',
  cross_faction: 'CrossFaction',
  'cross-faction': 'CrossFaction',
  commodities: 'Commodities',
  commodity: 'Commodities',
};

function titleCaseWord(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseRealmSlug(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return 'Unknown';

  const normalized = trimmed.toLowerCase();
  if (normalized === 'region') return 'Region-Wide';

  const regionMatch = /^(.+)-(au|us|eu|kr|tw)$/i.exec(trimmed);
  if (regionMatch && regionMatch[1] && regionMatch[2]) {
    const baseWords = regionMatch[1]
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return `${baseWords} (${regionMatch[2].toUpperCase()})`;
  }

  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

export function isFlavorId(value: unknown): value is FlavorId {
  return (
    typeof value === 'string' &&
    (FLAVOR_IDS as readonly string[]).includes(value)
  );
}

export function normalizeFlavorId(rawFlavor?: string | null): FlavorId {
  if (rawFlavor == null) return 'forever';
  const trimmed = String(rawFlavor).trim();
  if (trimmed === '') return 'forever';

  if (isFlavorId(trimmed)) return trimmed;

  const compact = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = FLAVOR_ALIAS_MAP[compact];
  if (mapped) return mapped;

  throw new Error(`Unsupported WoW flavor: "${rawFlavor}"`);
}

export function getFlavorConfig(flavor: FlavorId): FlavorConfig {
  return FLAVORS[flavor];
}

export function getExpectedFactions(flavor: FlavorId): readonly FactionPartition[] {
  return FLAVORS[flavor].defaultFactions;
}

export function normalizeFaction(rawFaction: string): FactionPartition {
  const trimmed = rawFaction.trim();
  if (!trimmed) return 'CrossFaction';
  const compact = trimmed.toLowerCase().replace(/\s+/g, '');
  const direct = FACTION_ALIAS_MAP[compact] ?? FACTION_ALIAS_MAP[trimmed.toLowerCase()];
  if (direct) return direct;
  return trimmed;
}

export function normalizeForeverRuleset(rawKey: string): { key: string; label: string } {
  const trimmed = rawKey.trim();
  const cleaned = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = FOREVER_RULESET_MAP[cleaned];
  if (known) {
    return known;
  }

  const fallbackKey = cleaned || trimmed.toLowerCase() || 'unknown';
  return {
    key: fallbackKey,
    label: titleCaseRealmSlug(trimmed),
  };
}

export function normalizePartitionKey(
  flavor: FlavorId,
  rawKey: string,
): { key: string; label: string; meta?: RulesetOrRealmMeta } {
  if (flavor === 'forever') {
    const normalized = normalizeForeverRuleset(rawKey);
    const meta = FLAVORS.forever.knownPartitions.find((p) => p.slug === normalized.key);
    return meta ? { key: normalized.key, label: meta.label, meta } : normalized;
  }

  const trimmed = rawKey.trim();
  const slug = trimmed.toLowerCase().replace(/\s+/g, '-');
  const meta = FLAVORS[flavor].knownPartitions.find((p) => p.slug === slug);
  if (meta) {
    return { key: meta.slug, label: meta.label, meta };
  }

  return {
    key: slug || 'unknown',
    label: titleCaseRealmSlug(trimmed),
  };
}

export function formatPartitionLabel(flavor: FlavorId, rawKey: string): string {
  return normalizePartitionKey(flavor, rawKey).label;
}
