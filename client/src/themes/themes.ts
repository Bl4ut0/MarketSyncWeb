import type { FlavorId } from '@marketsync/shared';

export interface EraThemeMeta {
  id: FlavorId;
  eraBadge: string;
  subtitle: string;
  armoryTitle: string;
  partitionLabel: string;
  accentHex: string;
  surfaceHex: string;
}

export const ERA_THEMES: Record<FlavorId, EraThemeMeta> = {
  forever: {
    id: 'forever',
    eraBadge: 'Armory • Forever Rulesets',
    subtitle: 'Obsidian & Royal Gold Filigree Auction House',
    armoryTitle: 'Forever Ruleset Exchange',
    partitionLabel: 'Ruleset',
    accentHex: '#d4a843',
    surfaceHex: '#141923',
  },
  classicEra: {
    id: 'classicEra',
    eraBadge: 'Armory • 1.15.x Classic Era',
    subtitle: 'Ironwood & Burnished Bronze Vellum Auction House',
    armoryTitle: 'Classic Era Auction House',
    partitionLabel: 'Realm',
    accentHex: '#e0ad63',
    surfaceHex: '#261b12',
  },
  anniversary: {
    id: 'anniversary',
    eraBadge: 'Armory • 20th Anniversary',
    subtitle: 'Fel-Emerald & Arcane Obsidian Auction House',
    armoryTitle: 'Anniversary Realm Exchange',
    partitionLabel: 'Realm',
    accentHex: '#2fd67b',
    surfaceHex: '#0f1f18',
  },
  classic: {
    id: 'classic',
    eraBadge: 'Armory • Mists of Pandaria Classic',
    subtitle: 'Imperial Jade Celadon & Lacquered Ebony Exchange',
    armoryTitle: 'Pandaria Cross-Faction Market',
    partitionLabel: 'Realm',
    accentHex: '#38c99a',
    surfaceHex: '#10201e',
  },
  retail: {
    id: 'retail',
    eraBadge: 'Armory • World of Warcraft: Midnight',
    subtitle: 'Void-Indigo & Starlight Glass Commodities Network',
    armoryTitle: 'Midnight Region Commodities',
    partitionLabel: 'Region',
    accentHex: '#8c6bff',
    surfaceHex: '#101529',
  },
};
