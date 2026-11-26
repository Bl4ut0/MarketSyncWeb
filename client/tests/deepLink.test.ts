import { describe, expect, it } from 'vitest';
import { blockPathForRoute, buildDeepLink, parseDeepLink } from '../src/lib/deepLink.js';
import { initialHomeFaction, resolveMarket } from '../src/lib/marketSelection.js';

describe('deep links', () => {
  it('parses an item link with date and hour', () => {
    expect(parseDeepLink('/item/forever/pvp/alliance/13464/2026-11-25/17')).toEqual({
      action: 'item', flavor: 'forever', ruleset: 'pvp', faction: 'Alliance',
      itemKey: '13464', date: '2026-11-25', hour: '17',
    });
  });

  it('accepts suffix variants and connected-realm slugs', () => {
    expect(parseDeepLink('/item/forever/dreamscythe/Horde/19999:832')).toMatchObject({
      ruleset: 'dreamscythe', faction: 'Horde', itemKey: '19999:832',
    });
  });

  it('parses analytics and market views without an item', () => {
    expect(parseDeepLink('/analytics/forever/normal/neutral/2026-11-24')).toEqual({
      action: 'analytics', flavor: 'forever', ruleset: 'normal', faction: 'Neutral', date: '2026-11-24',
    });
    expect(parseDeepLink('/ah/classicEra/normal/horde')).toEqual({
      action: 'ah', flavor: 'classicEra', ruleset: 'normal', faction: 'Horde',
    });
  });

  it('rejects malformed links', () => {
    expect(parseDeepLink('/')).toBeNull();
    expect(parseDeepLink('/item/mystery/pvp/alliance/13464')).toBeNull();
    expect(parseDeepLink('/item/forever/pvp/gnome/13464')).toBeNull();
    expect(parseDeepLink('/item/forever/pvp/alliance/abc')).toBeNull();
    expect(parseDeepLink('/item/forever/pvp/alliance')).toBeNull();
    expect(parseDeepLink('/ah/forever/pvp/alliance/2026-02-30')).toBeNull();
    expect(parseDeepLink('/ah/forever/pvp/alliance/2026-11-25/25')).toBeNull();
    expect(parseDeepLink('/ah/forever/pvp/alliance/2026-11-25/17/extra')).toBeNull();
    expect(parseDeepLink('/ah/forever/pvp/alliance/%E0%A4%A')).toBeNull();
    expect(parseDeepLink('/nav/forever/pvp/alliance')).toBeNull();
  });

  it('builds the same link it parses', () => {
    const link = '/item/forever/pvp/alliance/19999:832/2026-11-25/17';
    expect(buildDeepLink(parseDeepLink(link)!)).toBe(link);
    expect(buildDeepLink({ action: 'ah', flavor: 'forever', ruleset: 'pvp', faction: 'Neutral' }))
      .toBe('/ah/forever/pvp/neutral');
  });

  it('refuses an item link without an item key', () => {
    expect(() => buildDeepLink({ action: 'item', flavor: 'forever', ruleset: 'pvp', faction: 'Horde' })).toThrow();
  });

  it('drives the faction switch and market from the link', () => {
    const stored = { getItem: () => 'Alliance', setItem: () => undefined };
    const horde = parseDeepLink('/ah/forever/roleplaypvp/horde')!;
    expect(initialHomeFaction(horde.faction, stored)).toBe('Horde');
    expect(resolveMarket(['Alliance', 'Horde', 'Neutral'], 'Horde', horde.faction)).toBe('Horde');

    // A Neutral link opens the Neutral market and keeps the remembered faction.
    const neutral = parseDeepLink('/analytics/forever/pvp/neutral')!;
    expect(initialHomeFaction(neutral.faction, stored)).toBe('Alliance');
    expect(resolveMarket(['Alliance', 'Horde', 'Neutral'], 'Alliance', neutral.faction)).toBe('Neutral');

    // Shared markets on Classic and Retail round-trip too.
    const classic = buildDeepLink({ action: 'ah', flavor: 'classic', ruleset: 'pagle', faction: 'CrossFaction' });
    expect(classic).toBe('/ah/classic/pagle/crossfaction');
    expect(parseDeepLink(classic)).toMatchObject({ faction: 'CrossFaction' });
    expect(parseDeepLink('/item/retail/region/commodities/210796')).toMatchObject({
      ruleset: 'region', faction: 'Commodities', itemKey: '210796',
    });
  });

  it('maps a date and hour to the snapshot block path', () => {
    const route = parseDeepLink('/item/forever/pvp/alliance/13464/2026-11-25/17')!;
    expect(blockPathForRoute(route)).toBe('datasets/forever/2026-11-25/17-00.json');
    expect(blockPathForRoute(parseDeepLink('/ah/forever/pvp/alliance/2026-11-25')!)).toBeUndefined();
  });
});
