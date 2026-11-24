import { describe, expect, it } from 'vitest';
import {
  BLIZZARD_FALLBACK_LOGO_URL,
  FLAVORS,
  FLAVOR_IDS,
  MAX_COPPER,
  formatCopper,
  formatPartitionLabel,
  getExpectedFactions,
  getFlavorConfig,
  isFlavorId,
  normalizeFaction,
  normalizeFlavorId,
  normalizeForeverRuleset,
  normalizePartitionKey,
  parseCopper,
  splitCopper,
} from '@marketsync/shared';

describe('5-Flavor metadata & normalization', () => {
  it('exposes all 5 release candidates with Blizzard Contentstack CDN logos and local fallbacks', () => {
    expect(FLAVOR_IDS).toEqual([
      'forever',
      'classicEra',
      'anniversary',
      'classic',
      'retail',
    ]);

    for (const id of FLAVOR_IDS) {
      const cfg = getFlavorConfig(id);
      expect(cfg).toBe(FLAVORS[id]);
      expect(cfg.logoUrl).toMatch(/^https:\/\/blz-contentstack-images\.akamaized\.net\//);
      expect(cfg.fallbackLogoUrl).toBe(BLIZZARD_FALLBACK_LOGO_URL);
      expect(cfg.localLogoFallback).toMatch(/^\/assets\/blizzard-trademarks\/.+\.png$/);
      expect(cfg.defaultFactions.length).toBeGreaterThan(0);
    }
  });

  it('normalizes missing/empty flavors to forever and resolves aliases case-insensitively', () => {
    expect(normalizeFlavorId(undefined)).toBe('forever');
    expect(normalizeFlavorId(null)).toBe('forever');
    expect(normalizeFlavorId('')).toBe('forever');
    expect(normalizeFlavorId('   ')).toBe('forever');
    expect(normalizeFlavorId('camelot')).toBe('forever');
    expect(normalizeFlavorId('classic_era')).toBe('classicEra');
    expect(normalizeFlavorId('classic-era')).toBe('classicEra');
    expect(normalizeFlavorId('classic1x')).toBe('classicEra');
    expect(normalizeFlavorId('classicann')).toBe('anniversary');
    expect(normalizeFlavorId('Anniversary')).toBe('anniversary');
    expect(normalizeFlavorId('progression')).toBe('classic');
    expect(normalizeFlavorId('mainline')).toBe('retail');

    expect(isFlavorId('anniversary')).toBe(true);
    expect(isFlavorId('bogus')).toBe(false);
    expect(() => normalizeFlavorId('sod')).toThrow(/Unsupported WoW flavor/);
  });

  it('normalizes Forever legacy single-letter and canonical ruleset keys identically', () => {
    expect(normalizeForeverRuleset('p')).toEqual({ key: 'pvp', label: 'PvP' });
    expect(normalizeForeverRuleset('pvp')).toEqual({ key: 'pvp', label: 'PvP' });
    expect(normalizeForeverRuleset('n')).toEqual({ key: 'normal', label: 'Normal' });
    expect(normalizeForeverRuleset('normal')).toEqual({ key: 'normal', label: 'Normal' });
    expect(normalizeForeverRuleset('r')).toEqual({ key: 'roleplay', label: 'Roleplay' });
    expect(normalizeForeverRuleset('rp')).toEqual({ key: 'roleplay', label: 'Roleplay' });
    expect(normalizeForeverRuleset('roleplay')).toEqual({ key: 'roleplay', label: 'Roleplay' });
    expect(normalizeForeverRuleset('rppvp')).toEqual({
      key: 'roleplaypvp',
      label: 'Roleplay PvP',
    });
    expect(normalizeForeverRuleset('roleplaypvp')).toEqual({
      key: 'roleplaypvp',
      label: 'Roleplay PvP',
    });
    expect(normalizeForeverRuleset('english')).toEqual({
      key: 'english',
      label: 'English',
    });
    expect(normalizeForeverRuleset('English 52')).toEqual({
      key: 'english52',
      label: 'English 52',
    });
  });

  it('provides explicit Anniversary realms including doomhowl and formats arbitrary realm slugs', () => {
    const annRealms = getFlavorConfig('anniversary').knownPartitions.map((p) => p.slug);
    expect(annRealms).toEqual(['dreamscythe', 'nightslayer', 'maladath', 'doomhowl']);

    expect(formatPartitionLabel('anniversary', 'doomhowl')).toBe('Doomhowl (Hardcore)');
    expect(formatPartitionLabel('anniversary', 'maladath')).toBe('Maladath (AU)');
    expect(formatPartitionLabel('anniversary', 'thunderstrike')).toBe('Thunderstrike');
    expect(formatPartitionLabel('classic', 'bloodsail-buccaneers')).toBe(
      'Bloodsail Buccaneers',
    );
    expect(formatPartitionLabel('classic', 'remulos-au')).toBe('Remulos (AU)');
    expect(formatPartitionLabel('retail', 'region')).toBe('Region-Wide');
    expect(normalizePartitionKey('forever', 'r').label).toBe('Roleplay');
  });

  it('normalizes factions and returns expected factions per flavor', () => {
    expect(normalizeFaction('alliance')).toBe('Alliance');
    expect(normalizeFaction('Horde')).toBe('Horde');
    expect(normalizeFaction('blackwater')).toBe('Neutral');
    expect(normalizeFaction('cross-faction')).toBe('CrossFaction');
    expect(normalizeFaction('commodities')).toBe('Commodities');

    expect(getExpectedFactions('forever')).toEqual(['Alliance', 'Horde', 'Neutral']);
    expect(getExpectedFactions('anniversary')).toEqual(['Alliance', 'Horde', 'Neutral']);
    expect(getExpectedFactions('classic')).toEqual(['CrossFaction']);
    expect(getExpectedFactions('retail')).toEqual(['Commodities']);
  });
});

describe('64-bit safe copper arithmetic & formatting', () => {
  it('splits, formats, and parses boundary values including 99,999,999,999 copper', () => {
    expect(splitCopper(0)).toEqual({ gold: 0, silver: 0, copper: 0 });
    expect(formatCopper(0)).toBe('0c');
    expect(formatCopper(1)).toBe('1c');
    expect(formatCopper(100)).toBe('1s 00c');
    expect(formatCopper(100, { compact: true })).toBe('1s');
    expect(formatCopper(10000)).toBe('1g 00s 00c');
    expect(formatCopper(10000, { compact: true })).toBe('1g');
    expect(formatCopper(12345)).toBe('1g 23s 45c');

    // Exceeds 32-bit signed (2,147,483,647) and unsigned (4,294,967,295)
    expect(formatCopper(2_147_483_648)).toBe('214,748g 36s 48c');
    expect(formatCopper(MAX_COPPER)).toBe('9,999,999g 99s 99c');
    expect(parseCopper('9,999,999g 99s 99c')).toBe(MAX_COPPER);
    expect(parseCopper('99999999999')).toBe(MAX_COPPER);
    expect(parseCopper(MAX_COPPER)).toBe(MAX_COPPER);
    expect(parseCopper('1g 23s 45c')).toBe(12345);
    expect(parseCopper('1.5g')).toBe(15000);
    expect(parseCopper('25s')).toBe(2500);
    expect(parseCopper('50c')).toBe(50);
  });

  it('rejects negative, non-finite, malformed, or overflowing copper amounts', () => {
    expect(() => splitCopper(-1)).toThrow(RangeError);
    expect(() => splitCopper(Number.NaN)).toThrow(RangeError);
    expect(() => splitCopper(1.5)).toThrow(RangeError);
    expect(() => parseCopper(-5)).toThrow(RangeError);
    expect(() => parseCopper('-10g')).toThrow(RangeError);
    expect(() => parseCopper('')).toThrow();
    expect(() => parseCopper('1g 150s')).toThrow(RangeError);
    expect(() => parseCopper('9007199254740992')).toThrow(RangeError);
    expect(() => parseCopper('abc')).toThrow();
  });
});
