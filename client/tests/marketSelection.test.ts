import { describe, expect, it } from 'vitest';
import {
  HOME_FACTION_STORAGE_KEY, hasFactionMarkets, initialHomeFaction, loadHomeFaction, marketChoices,
  marketLabel, partitionSelectorLabel, resolveMarket, saveHomeFaction,
} from '../src/lib/marketSelection.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

const FOREVER = ['Alliance', 'Horde', 'Neutral'];

describe('faction memory', () => {
  it('remembers the chosen faction', () => {
    const storage = memoryStorage();
    expect(loadHomeFaction(storage)).toBeNull();
    saveHomeFaction('Horde', storage);
    expect(storage.values.get(HOME_FACTION_STORAGE_KEY)).toBe('Horde');
    expect(loadHomeFaction(storage)).toBe('Horde');
  });

  it('ignores bad stored values and broken storage', () => {
    expect(loadHomeFaction(memoryStorage({ [HOME_FACTION_STORAGE_KEY]: 'Neutral' }))).toBeNull();
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(loadHomeFaction(broken)).toBeNull();
    expect(() => saveHomeFaction('Alliance', broken)).not.toThrow();
  });

  it('starts from a deep-linked faction, then the stored one, then Alliance', () => {
    const storage = memoryStorage({ [HOME_FACTION_STORAGE_KEY]: 'Horde' });
    expect(initialHomeFaction('Alliance', storage)).toBe('Alliance');
    expect(initialHomeFaction('Neutral', storage)).toBe('Horde');
    expect(initialHomeFaction(undefined, storage)).toBe('Horde');
    expect(initialHomeFaction(undefined, memoryStorage())).toBe('Alliance');
  });
});

describe('market choices', () => {
  it('offers the faction AH and Neutral as a separate market on Forever', () => {
    expect(marketChoices(FOREVER, 'Alliance')).toEqual([
      { market: 'Alliance', kind: 'faction', label: 'Alliance AH' },
      { market: 'Neutral', kind: 'shared', label: 'Neutral AH' },
    ]);
    expect(marketChoices(FOREVER, 'Horde').map((c) => c.market)).toEqual(['Horde', 'Neutral']);
    expect(hasFactionMarkets(FOREVER)).toBe(true);
  });

  it('offers shared markets for cross-faction realms and retail regions', () => {
    expect(marketChoices(['CrossFaction'], 'Horde')).toEqual([
      { market: 'CrossFaction', kind: 'shared', label: 'Cross-faction AH' },
    ]);
    expect(marketChoices(['Commodities'], 'Alliance')[0]!.label).toBe('Region commodities');
    expect(hasFactionMarkets(['CrossFaction'])).toBe(false);
    expect(marketLabel('Something')).toBe('Something');
  });

  it('keeps Neutral when the partition changes and moves off the other faction', () => {
    expect(resolveMarket(FOREVER, 'Alliance', 'Neutral')).toBe('Neutral');
    expect(resolveMarket(FOREVER, 'Alliance', 'Horde')).toBe('Alliance');
    expect(resolveMarket(FOREVER, 'Horde', 'CrossFaction')).toBe('Horde');
    expect(resolveMarket(['CrossFaction'], 'Horde', 'Horde')).toBe('CrossFaction');
    expect(resolveMarket([], 'Horde', 'Horde')).toBeUndefined();
  });

  it('labels the partition selector by edition', () => {
    expect(partitionSelectorLabel('ruleset')).toBe('Playstyle');
    expect(partitionSelectorLabel('realm')).toBe('Realm');
    expect(partitionSelectorLabel('region')).toBe('Region');
  });
});
