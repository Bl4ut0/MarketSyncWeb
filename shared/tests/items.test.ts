import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITEM_ICON,
  PET_CAGE_ICON,
  fromAddonDbKey,
  getBlizzardRenderIconUrl,
  getItemIconUrl,
  getWowheadTooltipApiUrl,
  normalizeItemKey,
  parseWowheadTooltipPayload,
  resolveItemMetadata,
  toAddonDbKey,
} from '@marketsync/shared';

describe('Item key normalization & MarketSync addon DB key parity', () => {
  it('converts plain, suffixed, negative-suffix, 4-tuple, link, and Battle Pet keys', () => {
    expect(normalizeItemKey('13464')).toEqual({
      itemId: 13464,
      suffix: 0,
      canonicalKey: '13464',
      isPetCage: false,
    });
    expect(normalizeItemKey('13464:0').canonicalKey).toBe('13464');
    expect(normalizeItemKey(13464).canonicalKey).toBe('13464');

    expect(normalizeItemKey('13005:4512')).toEqual({
      itemId: 13005,
      suffix: 4512,
      canonicalKey: '13005:4512',
      isPetCage: false,
    });

    expect(toAddonDbKey('13464')).toBe('13464');
    expect(toAddonDbKey('13005:4512')).toBe('p:13005:4512');
    expect(toAddonDbKey({ itemId: 13005, suffix: 4512 })).toBe('p:13005:4512');

    expect(fromAddonDbKey('p:13005:4512').canonicalKey).toBe('13005:4512');
    expect(fromAddonDbKey('p:4471:-41')).toEqual({
      itemId: 4471,
      suffix: -41,
      canonicalKey: '4471:-41',
      isPetCage: false,
    });
    expect(fromAddonDbKey('i:13464').canonicalKey).toBe('13464');
    expect(fromAddonDbKey('g:13464').canonicalKey).toBe('13464');
    expect(fromAddonDbKey('gr:13464').canonicalKey).toBe('13464');

    // WoW item link & hyperlink
    expect(
      fromAddonDbKey('|cffffffff|Hitem:13005:0:0:0:0:0:4512:0:60|h[Amy\'s Blanket]|h|r'),
    ).toEqual({
      itemId: 13005,
      suffix: 4512,
      canonicalKey: '13005:4512',
      isPetCage: false,
    });

    // ForeverProvider 4-tuple <id>:<lvl>:<suf>:<pet>
    expect(fromAddonDbKey('13005:0:4512:0').canonicalKey).toBe('13005:4512');
    expect(fromAddonDbKey('82800:25:0:1125')).toEqual({
      itemId: 82800,
      suffix: 1125,
      canonicalKey: '82800:1125',
      isPetCage: true,
      petSpeciesId: 1125,
    });

    // Battle Pet keys
    expect(normalizeItemKey('82800:48213')).toEqual({
      itemId: 82800,
      suffix: 48213,
      canonicalKey: '82800:48213',
      isPetCage: true,
      petSpeciesId: 48213,
    });
    expect(fromAddonDbKey('battlepet:1125:25:3:150:100:200')).toEqual({
      itemId: 82800,
      suffix: 1125,
      canonicalKey: '82800:1125',
      isPetCage: true,
      petSpeciesId: 1125,
    });
  });

  it('rejects malformed or non-positive item keys', () => {
    expect(() => normalizeItemKey('')).toThrow();
    expect(() => normalizeItemKey(0)).toThrow();
    expect(() => normalizeItemKey(-10)).toThrow();
    expect(() => normalizeItemKey('not-an-item')).toThrow();
  });
});

describe('Item metadata resolution & icon CDN builders', () => {
  it('keeps tooltip icons and levels scoped to the edition that supplied them', () => {
    const id = 982143;
    parseWowheadTooltipPayload(id, {
      name: 'Classic test item', icon: 'inv_misc_herb_17', tooltip: 'Item Level <!--ilvl-->35',
    }, 'classicEra');
    parseWowheadTooltipPayload(id, {
      name: 'Retail test item', icon: 'inv_misc_note_06', tooltip: 'Item Level <!--ilvl-->1',
    }, 'retail');

    expect(resolveItemMetadata(id, 'classicEra')).toMatchObject({ itemLevel: 35, icon: 'inv_misc_herb_17' });
    expect(resolveItemMetadata(id, 'retail')).toMatchObject({ itemLevel: 1, icon: 'inv_misc_note_06' });
    expect(resolveItemMetadata(id, 'forever').isFallback).toBe(true);
    expect(getWowheadTooltipApiUrl(id, 'forever')).toBe(`https://nether.wowhead.com/forever/tooltip/item/${id}`);
  });

  it('resolves curated items across all eras plus Battle Pet cages', () => {
    const sansam = resolveItemMetadata('13464');
    expect(sansam.name).toBe('Golden Sansam');
    expect(sansam.isSeeded).toBe(true);
    expect(sansam.isFallback).toBe(false);
    expect(sansam.iconUrl).toBe(
      'https://wow.zamimg.com/images/wow/icons/large/inv_misc_herb_17.jpg',
    );

    const suffixed = resolveItemMetadata('13005:4512');
    expect(suffixed.name).toBe("Amy's Blanket (Variant #4512)");
    expect(suffixed.isSeeded).toBe(true);

    const direhorn = resolveItemMetadata('82800:48213');
    expect(direhorn.isPetCage).toBe(true);
    expect(direhorn.name).toBe('Direhorn Runt');
    expect(direhorn.iconUrl).toContain('inv_pet_direhorn.jpg');

    const lotus = resolveItemMetadata(13468);
    expect(lotus.name).toBe('Black Lotus');
    expect(lotus.quality).toBe(2);

    const mycobloom = resolveItemMetadata(210796);
    expect(mycobloom.name).toBe('Mycobloom');
  });

  it('provides clean #<itemId> and Pet Cage #<id> fallbacks for uncataloged IDs', () => {
    const unknown = resolveItemMetadata(999999);
    expect(unknown.name).toBe('#999999');
    expect(unknown.quality).toBe(1);
    expect(unknown.isSeeded).toBe(false);
    expect(unknown.isFallback).toBe(true);
    expect(unknown.iconUrl).toBe(getItemIconUrl(DEFAULT_ITEM_ICON));

    const unknownPet = resolveItemMetadata('82800:77777');
    expect(unknownPet.isPetCage).toBe(true);
    expect(unknownPet.name).toBe('Pet Cage #77777');
    expect(unknownPet.iconUrl).toBe(getItemIconUrl(PET_CAGE_ICON));

    expect(getBlizzardRenderIconUrl('inv_misc_herb_17', 'us')).toBe(
      'https://render.worldofwarcraft.com/us/icons/56/inv_misc_herb_17.jpg',
    );
    expect(getBlizzardRenderIconUrl('')).toBeNull();
  });
});
