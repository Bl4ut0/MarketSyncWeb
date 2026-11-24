import type {
  AhCategoryId,
  AhCategoryNode,
  FlavorId,
  ItemMetadata,
  ItemQuality,
} from './types.js';

export const PET_CAGE_ITEM_ID = 82800;
export const WOWHEAD_ICON_CDN = 'https://wow.zamimg.com/images/wow/icons';
export const WOWHEAD_TOOLTIP_API = 'https://nether.wowhead.com';
export const DEFAULT_ITEM_ICON = 'inv_misc_questionmark';
export const PET_CAGE_ICON = 'inv_box_petcarrier_01';

export interface WowheadItemMatch {
  id: number;
  name: string;
}

export interface AuctionCatalogItem {
  name?: string;
  itemClass: number;
  itemSubclass: number;
  className?: string;
  subclassName?: string;
  quality?: ItemQuality;
  itemLevel?: number;
  reqLevel?: number;
}

export type IconSize = 'small' | 'medium' | 'large';

export interface WowheadTooltipMeta {
  name?: string;
  quality?: ItemQuality;
  icon?: string;
  category?: string;
  subCategory?: string;
  ahCategory?: AhCategoryId;
  ahSubcategory?: string;
  itemLevel?: number;
  reqLevel?: number;
  slot?: string;
  stackSize?: number;
  tooltipHtml?: string;
}

const dynamicTooltipCache = new Map<string, WowheadTooltipMeta>();

export interface ParsedItemKey {
  itemId: number;
  suffix: number;
  canonicalKey: string;
  isPetCage: boolean;
  petSpeciesId?: number;
}

export interface SeedItemEntry {
  readonly name: string;
  readonly quality: ItemQuality;
  readonly category: string;
  readonly icon: string;
  readonly stackSize?: number;
}

export interface SeedPetEntry {
  readonly name: string;
  readonly quality?: ItemQuality;
  readonly icon?: string;
}

export const SEED_ITEM_CATALOG: Readonly<Record<number, SeedItemEntry>> = {
  // 07-00.json simulated & shared classic/retail items
  11382: { name: 'Blood of the Mountain', quality: 2, category: 'Trade Goods', icon: 'inv_stone_obsidian_02', stackSize: 20 },
  13463: { name: 'Dreamfoil', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_19', stackSize: 20 },
  13464: { name: 'Golden Sansam', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_17', stackSize: 20 },
  14343: { name: 'Small Brilliant Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardbrilliantsmall', stackSize: 20 },
  14344: { name: 'Large Brilliant Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardbrilliantlarge', stackSize: 20 },
  17011: { name: 'Lava Core', quality: 3, category: 'Trade Goods', icon: 'inv_elemental_primal_fire', stackSize: 20 },

  // Classic / Forever / Anniversary Herbs
  765: { name: 'Silverleaf', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_10', stackSize: 20 },
  785: { name: 'Mageroyal', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_01', stackSize: 20 },
  2447: { name: 'Peacebloom', quality: 1, category: 'Herbs', icon: 'inv_misc_flower_02', stackSize: 20 },
  2449: { name: 'Earthroot', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_07', stackSize: 20 },
  2450: { name: 'Briarthorn', quality: 1, category: 'Herbs', icon: 'inv_misc_root_01', stackSize: 20 },
  2452: { name: 'Swiftthistle', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_04', stackSize: 20 },
  2453: { name: 'Bruiseweed', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_01', stackSize: 20 },
  3355: { name: 'Wild Steelbloom', quality: 1, category: 'Herbs', icon: 'inv_misc_flower_01', stackSize: 20 },
  3356: { name: 'Kingsblood', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_03', stackSize: 20 },
  3357: { name: 'Liferoot', quality: 1, category: 'Herbs', icon: 'inv_misc_root_02', stackSize: 20 },
  3358: { name: "Khadgar's Whisker", quality: 1, category: 'Herbs', icon: 'inv_misc_herb_08', stackSize: 20 },
  3818: { name: 'Fadeleaf', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_12', stackSize: 20 },
  3820: { name: 'Stranglekelp', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_11', stackSize: 20 },
  3821: { name: 'Goldthorn', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_15', stackSize: 20 },
  4625: { name: 'Firebloom', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_19', stackSize: 20 },
  8831: { name: 'Purple Lotus', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_17', stackSize: 20 },
  8836: { name: "Arthas' Tears", quality: 1, category: 'Herbs', icon: 'inv_misc_herb_13', stackSize: 20 },
  8838: { name: 'Sungrass', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_18', stackSize: 20 },
  8839: { name: 'Blindweed', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_14', stackSize: 20 },
  8845: { name: 'Ghost Mushroom', quality: 1, category: 'Herbs', icon: 'inv_mushroom_08', stackSize: 20 },
  8846: { name: 'Gromsblood', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_16', stackSize: 20 },
  13465: { name: 'Mountain Silversage', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_mountainsilversage', stackSize: 20 },
  13466: { name: 'Plaguebloom', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_plaguebloom', stackSize: 20 },
  13467: { name: 'Icecap', quality: 1, category: 'Herbs', icon: 'inv_misc_herb_icecap', stackSize: 20 },
  13468: { name: 'Black Lotus', quality: 2, category: 'Herbs', icon: 'inv_misc_herb_blacklotus', stackSize: 20 },

  // Potions, Elixirs & Flasks
  118: { name: 'Minor Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_49', stackSize: 5 },
  858: { name: 'Lesser Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_50', stackSize: 5 },
  929: { name: 'Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_51', stackSize: 5 },
  1710: { name: 'Greater Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_52', stackSize: 5 },
  3928: { name: 'Superior Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_53', stackSize: 5 },
  13446: { name: 'Major Healing Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_54', stackSize: 5 },
  2455: { name: 'Minor Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_70', stackSize: 5 },
  3385: { name: 'Lesser Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_71', stackSize: 5 },
  3827: { name: 'Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_72', stackSize: 5 },
  6149: { name: 'Greater Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_73', stackSize: 5 },
  13443: { name: 'Superior Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_74', stackSize: 5 },
  13444: { name: 'Major Mana Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_76', stackSize: 5 },
  13442: { name: 'Mighty Rage Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_41', stackSize: 5 },
  13452: { name: 'Elixir of the Mongoose', quality: 1, category: 'Consumables', icon: 'inv_potion_32', stackSize: 5 },
  13454: { name: 'Greater Arcane Elixir', quality: 1, category: 'Consumables', icon: 'inv_potion_25', stackSize: 5 },
  13457: { name: 'Greater Fire Protection Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_24', stackSize: 5 },
  13510: { name: 'Flask of the Titans', quality: 1, category: 'Consumables', icon: 'inv_potion_62', stackSize: 5 },
  13511: { name: 'Flask of Distilled Wisdom', quality: 1, category: 'Consumables', icon: 'inv_potion_97', stackSize: 5 },
  13512: { name: 'Flask of Supreme Power', quality: 1, category: 'Consumables', icon: 'inv_potion_41', stackSize: 5 },
  18253: { name: 'Major Rejuvenation Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_47', stackSize: 5 },

  // Ores, Bars, Stones & Elementals
  2770: { name: 'Copper Ore', quality: 1, category: 'Mining', icon: 'inv_ore_copper_01', stackSize: 20 },
  2771: { name: 'Tin Ore', quality: 1, category: 'Mining', icon: 'inv_ore_tin_01', stackSize: 20 },
  2772: { name: 'Iron Ore', quality: 1, category: 'Mining', icon: 'inv_ore_iron_01', stackSize: 20 },
  2775: { name: 'Silver Ore', quality: 2, category: 'Mining', icon: 'inv_stone_16', stackSize: 20 },
  2776: { name: 'Gold Ore', quality: 2, category: 'Mining', icon: 'inv_ore_copper_01', stackSize: 20 },
  3858: { name: 'Mithril Ore', quality: 1, category: 'Mining', icon: 'inv_ore_mithril_02', stackSize: 20 },
  10620: { name: 'Thorium Ore', quality: 1, category: 'Mining', icon: 'inv_ore_thorium_02', stackSize: 20 },
  11370: { name: 'Dark Iron Ore', quality: 1, category: 'Mining', icon: 'inv_ore_mithril_01', stackSize: 20 },
  2835: { name: 'Rough Stone', quality: 1, category: 'Mining', icon: 'inv_stone_06', stackSize: 20 },
  2836: { name: 'Coarse Stone', quality: 1, category: 'Mining', icon: 'inv_stone_09', stackSize: 20 },
  2838: { name: 'Heavy Stone', quality: 1, category: 'Mining', icon: 'inv_stone_12', stackSize: 20 },
  7912: { name: 'Solid Stone', quality: 1, category: 'Mining', icon: 'inv_stone_10', stackSize: 20 },
  12365: { name: 'Dense Stone', quality: 1, category: 'Mining', icon: 'inv_stone_15', stackSize: 20 },
  2840: { name: 'Copper Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_02', stackSize: 20 },
  2841: { name: 'Bronze Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_bronze', stackSize: 20 },
  2842: { name: 'Silver Bar', quality: 2, category: 'Mining', icon: 'inv_ingot_01', stackSize: 20 },
  3575: { name: 'Iron Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_iron', stackSize: 20 },
  3576: { name: 'Tin Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_05', stackSize: 20 },
  3577: { name: 'Gold Bar', quality: 2, category: 'Mining', icon: 'inv_ingot_03', stackSize: 20 },
  3859: { name: 'Steel Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_steel', stackSize: 20 },
  3860: { name: 'Mithril Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_06', stackSize: 20 },
  12359: { name: 'Thorium Bar', quality: 1, category: 'Mining', icon: 'inv_ingot_07', stackSize: 20 },
  12360: { name: 'Arcanite Bar', quality: 2, category: 'Trade Goods', icon: 'inv_misc_stonetablet_05', stackSize: 20 },
  12361: { name: 'Blue Sapphire', quality: 2, category: 'Gems', icon: 'inv_misc_gem_sapphire_02', stackSize: 20 },
  12363: { name: 'Arcane Crystal', quality: 2, category: 'Gems', icon: 'inv_misc_gem_topaz_01', stackSize: 20 },
  12364: { name: 'Huge Emerald', quality: 2, category: 'Gems', icon: 'inv_misc_gem_emerald_01', stackSize: 20 },
  12803: { name: 'Living Essence', quality: 2, category: 'Trade Goods', icon: 'inv_misc_orb_01', stackSize: 20 },
  12808: { name: 'Essence of Undeath', quality: 2, category: 'Trade Goods', icon: 'inv_enchant_shardbrilliantsmall', stackSize: 20 },
  12811: { name: 'Righteous Orb', quality: 2, category: 'Trade Goods', icon: 'inv_misc_gem_pearl_03', stackSize: 20 },
  7075: { name: 'Core of Earth', quality: 1, category: 'Trade Goods', icon: 'inv_stone_05', stackSize: 20 },
  7076: { name: 'Essence of Earth', quality: 2, category: 'Trade Goods', icon: 'inv_elemental_earth_01', stackSize: 20 },
  7077: { name: 'Heart of Fire', quality: 1, category: 'Trade Goods', icon: 'inv_misc_gem_bloodstone_02', stackSize: 20 },
  7078: { name: 'Essence of Fire', quality: 2, category: 'Trade Goods', icon: 'inv_elemental_fire_01', stackSize: 20 },
  7079: { name: 'Globe of Water', quality: 1, category: 'Trade Goods', icon: 'inv_misc_orb_01', stackSize: 20 },
  7080: { name: 'Essence of Water', quality: 2, category: 'Trade Goods', icon: 'inv_elemental_water_01', stackSize: 20 },
  7081: { name: 'Breath of Wind', quality: 1, category: 'Trade Goods', icon: 'inv_elemental_mote_air01', stackSize: 20 },
  7082: { name: 'Essence of Air', quality: 2, category: 'Trade Goods', icon: 'inv_elemental_air_01', stackSize: 20 },

  // Cloth, Leather & Enchanting
  2589: { name: 'Linen Cloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_linen_01', stackSize: 20 },
  2592: { name: 'Wool Cloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_wool_01', stackSize: 20 },
  4306: { name: 'Silk Cloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_silk_01', stackSize: 20 },
  4338: { name: 'Mageweave Cloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_mageweave_01', stackSize: 20 },
  14047: { name: 'Runecloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_purplefire_01', stackSize: 20 },
  14256: { name: 'Felcloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_felrag', stackSize: 20 },
  2318: { name: 'Light Leather', quality: 1, category: 'Leather', icon: 'inv_misc_leatherscrap_03', stackSize: 20 },
  2319: { name: 'Medium Leather', quality: 1, category: 'Leather', icon: 'inv_misc_leatherscrap_05', stackSize: 20 },
  4234: { name: 'Heavy Leather', quality: 1, category: 'Leather', icon: 'inv_misc_leatherscrap_07', stackSize: 20 },
  4304: { name: 'Thick Leather', quality: 1, category: 'Leather', icon: 'inv_misc_leatherscrap_08', stackSize: 20 },
  8170: { name: 'Rugged Leather', quality: 1, category: 'Leather', icon: 'inv_misc_leatherscrap_02', stackSize: 20 },
  15407: { name: 'Cured Rugged Hide', quality: 1, category: 'Leather', icon: 'inv_misc_pelt_bear_ruin_05', stackSize: 20 },
  15415: { name: 'Blue Dragonscale', quality: 1, category: 'Leather', icon: 'inv_misc_monsterscales_09', stackSize: 20 },
  15416: { name: 'Black Dragonscale', quality: 1, category: 'Leather', icon: 'inv_misc_monsterscales_07', stackSize: 20 },
  15417: { name: 'Devilsaur Leather', quality: 1, category: 'Leather', icon: 'inv_misc_pelt_03', stackSize: 20 },
  10938: { name: 'Lesser Magic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencemagicsmall', stackSize: 20 },
  10939: { name: 'Greater Magic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencemagiclarge', stackSize: 20 },
  10940: { name: 'Strange Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_duststrange', stackSize: 20 },
  10978: { name: 'Small Glimmering Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardglimmeringsmall', stackSize: 20 },
  10998: { name: 'Lesser Astral Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essenceastralsmall', stackSize: 20 },
  11082: { name: 'Greater Astral Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essenceastrallarge', stackSize: 20 },
  11083: { name: 'Soul Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dustsoul', stackSize: 20 },
  11084: { name: 'Large Glimmering Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardglimmeringlarge', stackSize: 20 },
  11134: { name: 'Lesser Mystic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencemysticsmall', stackSize: 20 },
  11135: { name: 'Greater Mystic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencemysticlarge', stackSize: 20 },
  11137: { name: 'Vision Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dustvision', stackSize: 20 },
  11138: { name: 'Small Glowing Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardglowingsmall', stackSize: 20 },
  11139: { name: 'Large Glowing Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardglowinglarge', stackSize: 20 },
  11174: { name: 'Lesser Nether Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencenethersmall', stackSize: 20 },
  11175: { name: 'Greater Nether Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencenetherlarge', stackSize: 20 },
  11176: { name: 'Dream Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dustdream', stackSize: 20 },
  11177: { name: 'Small Radiant Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardradinatsmall', stackSize: 20 },
  11178: { name: 'Large Radiant Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardradiantlarge', stackSize: 20 },
  16202: { name: 'Lesser Eternal Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essenceeternalsmall', stackSize: 20 },
  16203: { name: 'Greater Eternal Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essenceeternallarge', stackSize: 20 },
  16204: { name: 'Illusion Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dustillusion', stackSize: 20 },
  20725: { name: 'Nexus Crystal', quality: 4, category: 'Enchanting', icon: 'inv_enchant_shardnexuslarge', stackSize: 20 },

  // Iconic Classic / Forever gear & consumables
  2512: { name: 'Rough Arrow', quality: 1, category: 'Projectile', icon: 'inv_ammo_arrow_02', stackSize: 200 },
  2515: { name: 'Sharp Arrow', quality: 1, category: 'Projectile', icon: 'inv_ammo_arrow_02', stackSize: 200 },
  2516: { name: 'Light Shot', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_02', stackSize: 200 },
  2519: { name: 'Heavy Shot', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_01', stackSize: 200 },
  3033: { name: 'Solid Shot', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_01', stackSize: 200 },
  3464: { name: 'Feathered Arrow', quality: 1, category: 'Projectile', icon: 'inv_ammo_arrow_02', stackSize: 200 },
  3465: { name: 'Exploding Shot', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_03', stackSize: 200 },
  10512: { name: 'Mithril Gyro-Shot', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_03', stackSize: 200 },
  10513: { name: 'Mithril Tube', quality: 1, category: 'Trade Goods', icon: 'inv_gizmo_pipe_01', stackSize: 20 },
  15997: { name: 'Thorium Shells', quality: 1, category: 'Projectile', icon: 'inv_ammo_bullet_03', stackSize: 200 },
  13005: { name: "Amy's Blanket", quality: 2, category: 'Armor', icon: 'inv_misc_cape_18', stackSize: 1 },
  14551: { name: "Edgemaster's Handguards", quality: 4, category: 'Armor', icon: 'inv_gauntlets_30', stackSize: 1 },
  2244: { name: 'Krol Blade', quality: 4, category: 'Weapons', icon: 'inv_sword_18', stackSize: 1 },
  1982: { name: 'Nightblade', quality: 4, category: 'Weapons', icon: 'inv_sword_29', stackSize: 1 },
  2824: { name: 'Staff of Horrors', quality: 3, category: 'Weapons', icon: 'inv_staff_13', stackSize: 1 },

  // TBC / Wrath / Cata / MoP Classic Progression items
  21841: { name: 'Netherweave Bag', quality: 2, category: 'Bags', icon: 'inv_misc_bag_23_netherweave', stackSize: 1 },
  21843: { name: 'Imbued Netherweave Bag', quality: 3, category: 'Bags', icon: 'inv_misc_bag_24_netherweave_imbued', stackSize: 1 },
  21853: { name: 'Netherweave Boots', quality: 2, category: 'Armor', icon: 'inv_boots_cloth_05', stackSize: 1 },
  21877: { name: 'Netherweave Cloth', quality: 1, category: 'Cloth', icon: 'inv_fabric_netherweave', stackSize: 20 },
  22445: { name: 'Arcane Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dustarcane', stackSize: 20 },
  22446: { name: 'Greater Planar Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencearcanelarge', stackSize: 20 },
  22447: { name: 'Lesser Planar Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencearcanesmall', stackSize: 20 },
  22448: { name: 'Small Prismatic Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardprismatic_small', stackSize: 20 },
  22449: { name: 'Large Prismatic Shard', quality: 3, category: 'Enchanting', icon: 'inv_enchant_shardprismatic_large', stackSize: 20 },
  22450: { name: 'Void Crystal', quality: 4, category: 'Enchanting', icon: 'inv_enchant_voidcrystal', stackSize: 20 },
  34052: { name: 'Dream Shard', quality: 3, category: 'Enchanting', icon: 'inv_misc_enchantedpearla', stackSize: 20 },
  34053: { name: 'Small Dream Shard', quality: 3, category: 'Enchanting', icon: 'inv_misc_enchantedpearlb', stackSize: 20 },
  34054: { name: 'Infinite Dust', quality: 1, category: 'Enchanting', icon: 'inv_misc_dust_infinite', stackSize: 20 },
  34055: { name: 'Greater Cosmic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencecosmicgreater', stackSize: 20 },
  34056: { name: 'Lesser Cosmic Essence', quality: 2, category: 'Enchanting', icon: 'inv_enchant_essencecosmiclesser', stackSize: 20 },
  34057: { name: 'Abyss Crystal', quality: 4, category: 'Enchanting', icon: 'inv_enchant_abysscrystal', stackSize: 20 },
  52555: { name: 'Hypnotic Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchant_dusthypnotic', stackSize: 20 },
  72092: { name: 'Ghost Iron Ore', quality: 1, category: 'Mining', icon: 'inv_ore_ghostiron', stackSize: 200 },
  72093: { name: 'Kyparite', quality: 1, category: 'Mining', icon: 'inv_ore_kyparite', stackSize: 200 },
  72094: { name: 'Black Trillium Ore', quality: 2, category: 'Mining', icon: 'inv_ore_trilliumblack', stackSize: 200 },
  74247: { name: 'Ethereal Shard', quality: 3, category: 'Enchanting', icon: 'inv_misc_etherealshard', stackSize: 20 },
  74248: { name: 'Sha Crystal', quality: 4, category: 'Enchanting', icon: 'inv_misc_shacrystal', stackSize: 20 },
  74249: { name: 'Spirit Dust', quality: 1, category: 'Enchanting', icon: 'inv_misc_dust_spirit', stackSize: 20 },
  74250: { name: 'Mysterious Essence', quality: 2, category: 'Enchanting', icon: 'inv_misc_essence_mysterious', stackSize: 20 },
  79330: { name: 'Relic of Chi-Ji', quality: 4, category: 'Armor', icon: 'inv_inscription_tarot_chiji', stackSize: 1 },
  79331: { name: "Relic of Yu'lon", quality: 4, category: 'Armor', icon: 'inv_inscription_tarot_yulon', stackSize: 1 },
  82800: { name: 'Pet Cage', quality: 3, category: 'Battle Pets', icon: PET_CAGE_ICON, stackSize: 1 },
  85830: { name: 'Raiment of Blood and Bone', quality: 4, category: 'Armor', icon: 'inv_chest_cloth_raidmage_l_01', stackSize: 1 },
  98603: { name: 'Leggings of the Night Sky', quality: 4, category: 'Armor', icon: 'inv_pant_mail_raidhunter_l_01', stackSize: 1 },

  // Retail Commodities (verified in retail/2026-11-22/09-00.json)
  3371: { name: 'Crystal Vial', quality: 1, category: 'Trade Goods', icon: 'inv_alchemy_crystalvial', stackSize: 200 },
  17202: { name: 'Snowball', quality: 1, category: 'Consumables', icon: 'inv_ammo_snowball', stackSize: 20 },
  94288: { name: 'Giant Dinosaur Bone', quality: 1, category: 'Trade Goods', icon: 'inv_misc_bone_09', stackSize: 1000 },
  109118: { name: 'Blackrock Ore', quality: 1, category: 'Mining', icon: 'inv_ore_blackrock_ore', stackSize: 1000 },
  123918: { name: 'Leystone Ore', quality: 1, category: 'Mining', icon: 'inv_leystone', stackSize: 1000 },
  123919: { name: 'Felslate', quality: 1, category: 'Mining', icon: 'inv_felslate', stackSize: 1000 },
  152512: { name: 'Monelite Ore', quality: 1, category: 'Mining', icon: 'inv_ore_monelite', stackSize: 1000 },
  172094: { name: 'Callous Hide', quality: 1, category: 'Leather', icon: 'inv_misc_leather_shadowlands_01', stackSize: 1000 },
  172230: { name: 'Soul Dust', quality: 1, category: 'Enchanting', icon: 'inv_enchanting_shadowlands_dust', stackSize: 1000 },
  210796: { name: 'Mycobloom', quality: 1, category: 'Herbs', icon: 'inv_herbalism_mycobloom', stackSize: 1000 },
  212265: { name: 'Tempered Potion', quality: 1, category: 'Consumables', icon: 'inv_potion_red', stackSize: 200 },
};

export const PET_SPECIES_CATALOG: Readonly<Record<number, SeedPetEntry>> = {
  200: { name: 'Spring Rabbit', quality: 3, icon: 'inv_misc_rabbit' },
  328: { name: 'Feline Familiar', quality: 3, icon: 'inv_pet_cat' },
  1125: { name: 'Anubisath Idol', quality: 3, icon: 'inv_qirajidol_strife' },
  15436: { name: 'Disgusting Oozeling', quality: 3, icon: 'inv_misc_slime_01' },
  48212: { name: 'Zandalari Anklerender', quality: 3, icon: 'inv_pet_raptor_black' },
  48213: { name: 'Direhorn Runt', quality: 3, icon: 'inv_pet_direhorn' },
  51268: { name: 'Blackfuse Bombling', quality: 3, icon: 'inv_pet_bombling' },
};

function assertPositiveSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: expected positive safe integer, received ${value}`);
  }
  return value;
}

function assertSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${label}: expected safe integer, received ${value}`);
  }
  return value;
}

function buildParsedKey(itemId: number, suffix: number): ParsedItemKey {
  const safeId = assertPositiveSafeInt(itemId, 'itemId');
  const safeSuffix = assertSafeInt(suffix, 'suffix');
  const canonicalKey = safeSuffix !== 0 ? `${safeId}:${safeSuffix}` : String(safeId);
  if (safeId === PET_CAGE_ITEM_ID && safeSuffix > 0) {
    return {
      itemId: safeId,
      suffix: safeSuffix,
      canonicalKey,
      isPetCage: true,
      petSpeciesId: safeSuffix,
    };
  }
  return {
    itemId: safeId,
    suffix: safeSuffix,
    canonicalKey,
    isPetCage: false,
  };
}

export function fromAddonDbKey(dbKey: string | number): ParsedItemKey {
  if (typeof dbKey === 'number') {
    return buildParsedKey(dbKey, 0);
  }
  if (typeof dbKey !== 'string') {
    throw new Error(`Invalid item key type: ${typeof dbKey}`);
  }

  let trimmed = dbKey.trim();
  if (!trimmed) {
    throw new Error('Empty item key');
  }

  // Extract from WoW hyperlink if wrapped in |H...|h
  const hyperlinkMatch = /\|H([^|]+)\|h/i.exec(trimmed);
  if (hyperlinkMatch && hyperlinkMatch[1]) {
    trimmed = hyperlinkMatch[1];
  }

  // Plain integer string e.g. "13464"
  if (/^\d+$/.test(trimmed)) {
    return buildParsedKey(Number(trimmed), 0);
  }

  // Addon suffix key: p:<itemId>:<suffixId>
  const addonSuffixMatch = /^p:(\d+):(-?\d+)$/.exec(trimmed);
  if (addonSuffixMatch) {
    return buildParsedKey(Number(addonSuffixMatch[1]), Number(addonSuffixMatch[2]));
  }

  // Prefixed plain keys: p:<id>, i:<id>, g:<id>, gr:<id>
  const prefixedMatch = /^(?:p|i|g|gr):(\d+)$/.exec(trimmed);
  if (prefixedMatch) {
    return buildParsedKey(Number(prefixedMatch[1]), 0);
  }

  // Battle pet link: battlepet:<speciesId>[:...]
  const battlePetMatch = /^battlepet:(\d+)(?::.*)?$/i.exec(trimmed);
  if (battlePetMatch) {
    const speciesId = assertPositiveSafeInt(Number(battlePetMatch[1]), 'petSpeciesId');
    return buildParsedKey(PET_CAGE_ITEM_ID, speciesId);
  }

  // WoW item link: item:<itemId>:<enchant>:<g1>:<g2>:<g3>:<g4>:<suffix>:...
  if (/^item:/i.test(trimmed)) {
    const parts = trimmed.split(':');
    const itemId = Number(parts[1]);
    const suffix = parts.length > 7 && parts[7] !== '' ? Number(parts[7]) : 0;
    return buildParsedKey(itemId, Number.isNaN(suffix) ? 0 : suffix);
  }

  // Snapshot key: <itemId>:<suffixId>
  const pairMatch = /^(\d+):(-?\d+)$/.exec(trimmed);
  if (pairMatch) {
    return buildParsedKey(Number(pairMatch[1]), Number(pairMatch[2]));
  }

  // ForeverProvider 4-tuple: <itemId>:<itemLevel>:<itemSuffix>:<battlePetSpeciesId>
  const tupleMatch = /^(\d+):(-?\d+):(-?\d+):(\d+)$/.exec(trimmed);
  if (tupleMatch) {
    const itemId = Number(tupleMatch[1]);
    const itemSuffix = Number(tupleMatch[3]);
    const petSpeciesId = Number(tupleMatch[4]);
    if (petSpeciesId > 0) {
      return buildParsedKey(PET_CAGE_ITEM_ID, petSpeciesId);
    }
    return buildParsedKey(itemId, itemSuffix);
  }

  throw new Error(`Unrecognized item key format: "${dbKey}"`);
}

export function normalizeItemKey(
  input: string | number | { itemId: number; suffix?: number },
): ParsedItemKey {
  if (typeof input === 'object' && input !== null) {
    return buildParsedKey(input.itemId, input.suffix ?? 0);
  }
  return fromAddonDbKey(input);
}

export function toAddonDbKey(
  input: string | number | { itemId: number; suffix?: number },
): string {
  const parsed = normalizeItemKey(input);
  if (parsed.suffix !== 0) {
    return `p:${parsed.itemId}:${parsed.suffix}`;
  }
  return String(parsed.itemId);
}

export function getItemIconUrl(
  iconSlug: string = DEFAULT_ITEM_ICON,
  size: IconSize = 'large',
): string {
  const clean = iconSlug.trim().toLowerCase() || DEFAULT_ITEM_ICON;
  return `${WOWHEAD_ICON_CDN}/${size}/${clean}.jpg`;
}

export function getBlizzardRenderIconUrl(
  fileDataIdOrPath: string | number,
  region = 'us',
): string | null {
  const raw = String(fileDataIdOrPath).trim();
  if (!raw) return null;
  const normalizedRegion = region.trim().toLowerCase() || 'us';
  const clean = raw.replace(/^\/+/, '').replace(/\.(jpg|png)$/i, '');
  if (!clean) return null;
  return `https://render.worldofwarcraft.com/${normalizedRegion}/icons/56/${clean}.jpg`;
}

// ---------------------------------------------------------------------------
// Era-Specific Blizzard Auction House Category Trees
// (Mirroring Blizzard_AuctionUI Classic/TBC/MoP & Blizzard_AuctionHouseUI Mainline)
// ---------------------------------------------------------------------------

const CLASSIC_VANILLA_CATEGORIES: readonly AhCategoryNode[] = [
  {
    id: 'weapons',
    label: 'Weapons',
    subCategories: [
      { id: 'one-handed', label: 'One-Handed' },
      { id: 'two-handed', label: 'Two-Handed' },
      { id: 'ranged', label: 'Ranged' },
    ],
  },
  {
    id: 'armor',
    label: 'Armor',
    subCategories: [
      { id: 'misc-armor', label: 'Miscellaneous' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'mail', label: 'Mail' },
      { id: 'plate', label: 'Plate' },
      { id: 'shields', label: 'Shields' },
    ],
  },
  { id: 'containers', label: 'Containers' },
  {
    id: 'consumables',
    label: 'Consumables',
    subCategories: [
      { id: 'potions', label: 'Potions & Elixirs' },
      { id: 'food-drink', label: 'Food & Drink' },
    ],
  },
  {
    id: 'trade-goods',
    label: 'Trade Goods',
    subCategories: [
      { id: 'herbs', label: 'Herbs' },
      { id: 'mining', label: 'Metal & Stone' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'enchanting', label: 'Enchanting' },
      { id: 'elemental', label: 'Elemental' },
      { id: 'parts', label: 'Parts & Devices' },
    ],
  },
  { id: 'projectile', label: 'Projectile' },
  { id: 'quiver', label: 'Quiver' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'reagent', label: 'Reagent' },
  { id: 'miscellaneous', label: 'Miscellaneous' },
];

const ANNIVERSARY_TBC_CATEGORIES: readonly AhCategoryNode[] = [
  {
    id: 'weapons',
    label: 'Weapons',
    subCategories: [
      { id: 'one-handed', label: 'One-Handed' },
      { id: 'two-handed', label: 'Two-Handed' },
      { id: 'ranged', label: 'Ranged' },
    ],
  },
  {
    id: 'armor',
    label: 'Armor',
    subCategories: [
      { id: 'misc-armor', label: 'Miscellaneous' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'mail', label: 'Mail' },
      { id: 'plate', label: 'Plate' },
      { id: 'shields', label: 'Shields' },
    ],
  },
  { id: 'containers', label: 'Containers' },
  {
    id: 'consumables',
    label: 'Consumables',
    subCategories: [
      { id: 'potions', label: 'Potions, Elixirs & Flasks' },
      { id: 'food-drink', label: 'Food & Drink' },
      { id: 'scrolls', label: 'Scrolls & Bandages' },
    ],
  },
  {
    id: 'trade-goods',
    label: 'Trade Goods',
    subCategories: [
      { id: 'herbs', label: 'Herbs' },
      { id: 'mining', label: 'Metal & Stone' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'enchanting', label: 'Enchanting' },
      { id: 'elemental', label: 'Elemental' },
      { id: 'parts', label: 'Parts & Devices' },
    ],
  },
  { id: 'projectile', label: 'Projectile' },
  { id: 'quiver', label: 'Quiver' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'gems', label: 'Gems' },
  { id: 'miscellaneous', label: 'Miscellaneous' },
  { id: 'quest-items', label: 'Quest Items' },
];

const MOP_CLASSIC_CATEGORIES: readonly AhCategoryNode[] = [
  {
    id: 'weapons',
    label: 'Weapons',
    subCategories: [
      { id: 'one-handed', label: 'One-Handed' },
      { id: 'two-handed', label: 'Two-Handed' },
      { id: 'ranged', label: 'Ranged' },
    ],
  },
  {
    id: 'armor',
    label: 'Armor',
    subCategories: [
      { id: 'misc-armor', label: 'Miscellaneous' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'mail', label: 'Mail' },
      { id: 'plate', label: 'Plate' },
      { id: 'shields', label: 'Shields' },
    ],
  },
  { id: 'containers', label: 'Containers' },
  {
    id: 'consumables',
    label: 'Consumables',
    subCategories: [
      { id: 'potions', label: 'Potions, Elixirs & Flasks' },
      { id: 'food-drink', label: 'Food & Drink' },
    ],
  },
  { id: 'glyphs', label: 'Glyphs' },
  {
    id: 'trade-goods',
    label: 'Trade Goods',
    subCategories: [
      { id: 'herbs', label: 'Herbs' },
      { id: 'mining', label: 'Metal & Stone' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'enchanting', label: 'Enchanting' },
      { id: 'elemental', label: 'Elemental' },
      { id: 'parts', label: 'Parts & Devices' },
    ],
  },
  { id: 'recipes', label: 'Recipes' },
  { id: 'gems', label: 'Gems' },
  { id: 'miscellaneous', label: 'Miscellaneous' },
  { id: 'quest-items', label: 'Quest Items' },
  { id: 'battle-pets', label: 'Battle Pets' },
];

const RETAIL_MAINLINE_CATEGORIES: readonly AhCategoryNode[] = [
  {
    id: 'weapons',
    label: 'Weapons',
    subCategories: [
      { id: 'one-handed', label: 'One-Handed' },
      { id: 'two-handed', label: 'Two-Handed' },
      { id: 'ranged', label: 'Ranged' },
    ],
  },
  {
    id: 'armor',
    label: 'Armor',
    subCategories: [
      { id: 'plate', label: 'Plate' },
      { id: 'mail', label: 'Mail' },
      { id: 'leather', label: 'Leather' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'misc-armor', label: 'Miscellaneous' },
    ],
  },
  { id: 'containers', label: 'Containers' },
  { id: 'gems', label: 'Gems' },
  { id: 'item-enhancement', label: 'Item Enhancement' },
  {
    id: 'consumables',
    label: 'Consumables',
    subCategories: [
      { id: 'potions', label: 'Potions, Phials & Flasks' },
      { id: 'food-drink', label: 'Food & Drink' },
    ],
  },
  { id: 'glyphs', label: 'Glyphs' },
  {
    id: 'trade-goods',
    label: 'Trade Goods',
    subCategories: [
      { id: 'herbs', label: 'Herbs' },
      { id: 'mining', label: 'Metal & Stone' },
      { id: 'cloth', label: 'Cloth' },
      { id: 'leather', label: 'Leather' },
      { id: 'enchanting', label: 'Enchanting' },
      { id: 'elemental', label: 'Elemental' },
      { id: 'parts', label: 'Parts & Reagents' },
    ],
  },
  { id: 'recipes', label: 'Recipes' },
  { id: 'profession-equipment', label: 'Profession Equipment' },
  { id: 'battle-pets', label: 'Battle Pets' },
  { id: 'quest-items', label: 'Quest Items' },
  { id: 'miscellaneous', label: 'Miscellaneous' },
];

export function getEraAuctionCategories(flavor: FlavorId): readonly AhCategoryNode[] {
  switch (flavor) {
    case 'forever':
    case 'classicEra':
      return CLASSIC_VANILLA_CATEGORIES;
    case 'anniversary':
      return ANNIVERSARY_TBC_CATEGORIES;
    case 'classic':
      return MOP_CLASSIC_CATEGORIES;
    case 'retail':
      return RETAIL_MAINLINE_CATEGORIES;
    default:
      return CLASSIC_VANILLA_CATEGORIES;
  }
}

const AH_ITEM_CLASSES: Partial<Record<number, AhCategoryId>> = {
  0: 'consumables', 1: 'containers', 2: 'weapons', 3: 'gems', 4: 'armor',
  5: 'reagent', 6: 'projectile', 7: 'trade-goods', 8: 'item-enhancement',
  9: 'recipes', 11: 'quiver', 12: 'quest-items', 15: 'miscellaneous',
  16: 'glyphs', 17: 'battle-pets', 19: 'profession-equipment',
};

function catalogSubcategory(item: AuctionCatalogItem): string | undefined {
  const { itemClass, itemSubclass } = item;
  if (itemClass === 2) {
    if ([2, 3, 16, 18, 19].includes(itemSubclass)) return 'ranged';
    if ([1, 5, 6, 8, 10, 17, 20].includes(itemSubclass)) return 'two-handed';
    return 'one-handed';
  }
  if (itemClass === 4) {
    return ['misc-armor', 'cloth', 'leather', 'mail', 'plate', 'misc-armor', 'shields'][itemSubclass];
  }
  if (itemClass === 7) {
    const materials: Partial<Record<number, string>> = {
      1: 'parts', 2: 'parts', 3: 'parts', 5: 'cloth', 6: 'leather', 7: 'mining',
      9: 'herbs', 10: 'elemental', 12: 'enchanting',
    };
    return materials[itemSubclass];
  }
  if (itemClass === 0) {
    if ([1, 2, 3].includes(itemSubclass)) return 'potions';
    if (itemSubclass === 5) return 'food-drink';
    if ([4, 7].includes(itemSubclass)) return 'scrolls';
  }
  return undefined;
}

export function getCatalogAuctionCategory(
  item: AuctionCatalogItem,
  flavor: FlavorId,
): { category: string; ahCategory: AhCategoryId; ahSubcategory?: string } {
  const categoryId = AH_ITEM_CLASSES[item.itemClass];
  const node = getEraAuctionCategories(flavor).find((category) => category.id === categoryId);
  const subcategory = catalogSubcategory(item);
  return {
    category: node?.label ?? item.className ?? 'Miscellaneous',
    ahCategory: node?.id ?? 'miscellaneous',
    ...(node?.subCategories?.some((entry) => entry.id === subcategory) ? { ahSubcategory: subcategory } : {}),
  };
}

export function getWowheadEnvForFlavor(flavor: FlavorId): { domainPath: string } {
  switch (flavor) {
    case 'forever':
      return { domainPath: 'forever/' };
    case 'classicEra':
      return { domainPath: 'classic/' };
    case 'anniversary':
      return { domainPath: 'tbc/' };
    case 'classic':
      return { domainPath: 'mop-classic/' };
    case 'retail':
    default:
      return { domainPath: '' };
  }
}

export function getWowheadTooltipApiUrl(
  itemId: number,
  flavor: FlavorId = 'forever',
  suffixId?: number,
): string {
  const env = getWowheadEnvForFlavor(flavor);
  const randParam = suffixId && suffixId !== 0 ? `?rand=${suffixId}` : '';
  return `${WOWHEAD_TOOLTIP_API}/${env.domainPath}tooltip/item/${itemId}${randParam}`;
}

export function getWowheadItemUrl(
  itemId: number,
  flavor: FlavorId,
  petSpeciesId?: number,
  suffixId?: number,
): string {
  const { domainPath } = getWowheadEnvForFlavor(flavor);
  const randParam = !petSpeciesId && suffixId && suffixId !== 0 ? `&rand=${suffixId}` : '';
  const itemPath = petSpeciesId ? `battle-pet/${petSpeciesId}` : `item=${itemId}${randParam}`;
  return `https://www.wowhead.com/${domainPath}${itemPath}`;
}

export const ITEM_SUFFIX_NAMES: Readonly<Record<number, string>> = {
  5: 'of the Monkey',
  6: 'of the Eagle',
  7: 'of the Bear',
  8: 'of the Whale',
  9: 'of the Owl',
  10: 'of the Gorilla',
  11: 'of the Falcon',
  12: 'of the Boar',
  13: 'of the Wolf',
  14: 'of the Tiger',
  15: 'of Spirit',
  16: 'of Stamina',
  17: 'of Strength',
  18: 'of Agility',
  19: 'of Intellect',
  20: 'of Power',
  21: 'of Spell Power',
  22: 'of Defense',
  23: 'of Regeneration',
  24: 'of Eluding',
  25: 'of Concentration',
  26: 'of Arcane Resistance',
  27: 'of Fire Resistance',
  28: 'of Frost Resistance',
  29: 'of Nature Resistance',
  30: 'of Shadow Resistance',
  31: 'of Healing',
  32: 'of Frost Wrath',
  33: 'of Fire Wrath',
  34: 'of Arcane Wrath',
  35: "of Nature's Wrath",
  36: 'of Shadow Wrath',
  37: 'of Holy Wrath',
  38: 'of Blocking',
  [-5]: 'of the Monkey',
  [-6]: 'of the Eagle',
  [-7]: 'of the Bear',
  [-8]: 'of the Whale',
  [-9]: 'of the Owl',
  [-10]: 'of the Gorilla',
  [-11]: 'of the Falcon',
  [-12]: 'of the Boar',
  [-13]: 'of the Wolf',
  [-14]: 'of the Tiger',
  [-15]: 'of Spirit',
  [-16]: 'of Stamina',
  [-17]: 'of Strength',
  [-18]: 'of Agility',
  [-19]: 'of Intellect',
  [-20]: 'of Power',
  [-21]: 'of Spell Power',
  [-22]: 'of Defense',
  [-23]: 'of Regeneration',
  [-31]: 'of Healing',
  [-36]: 'of Shadow Wrath',
};

export function resolveSuffixName(suffixId: number): string | null {
  if (!suffixId || suffixId === 0) return null;
  return ITEM_SUFFIX_NAMES[suffixId] ?? null;
}

export function mapSeedCategoryToAh(
  category: string,
  icon: string = '',
  name: string = '',
): { ahCategory: AhCategoryId; ahSubcategory?: string } {
  const cat = category.trim().toLowerCase();
  const ic = icon.trim().toLowerCase();
  const nm = name.trim().toLowerCase();

  if (cat === 'weapons' || ic.startsWith('inv_sword') || ic.startsWith('inv_axe') || ic.startsWith('inv_mace') || ic.startsWith('inv_staff') || ic.startsWith('inv_weapon') || ic.startsWith('inv_wand') || ic.startsWith('inv_hammer') || ic.startsWith('inv_spear')) {
    if (ic.startsWith('inv_staff') || ic.startsWith('inv_spear') || nm.includes('staff') || nm.includes('claymore') || nm.includes('polearm')) {
      return { ahCategory: 'weapons', ahSubcategory: 'two-handed' };
    }
    if (ic.startsWith('inv_weapon_bow') || ic.startsWith('inv_weapon_rifle') || ic.startsWith('inv_weapon_crossbow') || ic.startsWith('inv_wand')) {
      return { ahCategory: 'weapons', ahSubcategory: 'ranged' };
    }
    return { ahCategory: 'weapons', ahSubcategory: 'one-handed' };
  }
  if (cat === 'armor' || ic.startsWith('inv_helmet') || ic.startsWith('inv_chest') || ic.startsWith('inv_boots') || ic.startsWith('inv_gauntlets') || ic.startsWith('inv_pants') || ic.startsWith('inv_pant') || ic.startsWith('inv_shoulder') || ic.startsWith('inv_belt') || ic.startsWith('inv_bracer') || ic.startsWith('inv_misc_cape') || ic.startsWith('inv_shield') || ic.startsWith('inv_jewelry')) {
    if (ic.includes('plate')) return { ahCategory: 'armor', ahSubcategory: 'plate' };
    if (ic.includes('mail') || nm.includes('handguards')) return { ahCategory: 'armor', ahSubcategory: 'mail' };
    if (ic.includes('leather')) return { ahCategory: 'armor', ahSubcategory: 'leather' };
    if (ic.includes('cloth') || ic.startsWith('inv_misc_cape')) return { ahCategory: 'armor', ahSubcategory: 'cloth' };
    if (ic.startsWith('inv_shield')) return { ahCategory: 'armor', ahSubcategory: 'shields' };
    return { ahCategory: 'armor', ahSubcategory: 'misc-armor' };
  }
  if (cat === 'bags' || cat === 'containers' || ic.startsWith('inv_misc_bag')) {
    return { ahCategory: 'containers' };
  }
  if (cat === 'consumables' || ic.startsWith('inv_potion') || ic.startsWith('inv_misc_food') || ic.startsWith('inv_drink') || ic.startsWith('inv_scroll')) {
    if (ic.startsWith('inv_misc_food') || ic.startsWith('inv_drink')) {
      return { ahCategory: 'consumables', ahSubcategory: 'food-drink' };
    }
    if (ic.startsWith('inv_scroll')) {
      return { ahCategory: 'consumables', ahSubcategory: 'scrolls' };
    }
    return { ahCategory: 'consumables', ahSubcategory: 'potions' };
  }
  if (cat === 'glyphs' || ic.startsWith('inv_glyph')) {
    return { ahCategory: 'glyphs' };
  }
  if (cat === 'herbs' || ic.startsWith('inv_misc_herb') || ic.startsWith('inv_herbalism') || ic.startsWith('inv_misc_flower') || ic.startsWith('inv_misc_root') || ic.startsWith('inv_mushroom')) {
    return { ahCategory: 'trade-goods', ahSubcategory: 'herbs' };
  }
  if (cat === 'mining' || ic.startsWith('inv_ore') || ic.startsWith('inv_ingot') || ic.startsWith('inv_stone')) {
    return { ahCategory: 'trade-goods', ahSubcategory: 'mining' };
  }
  if (cat === 'cloth' || ic.startsWith('inv_fabric')) {
    return { ahCategory: 'trade-goods', ahSubcategory: 'cloth' };
  }
  if (cat === 'leather' || ic.startsWith('inv_misc_leatherscrap') || ic.startsWith('inv_misc_pelt') || ic.startsWith('inv_misc_monsterscales') || ic.startsWith('inv_misc_leather')) {
    return { ahCategory: 'trade-goods', ahSubcategory: 'leather' };
  }
  if (cat === 'enchanting' || ic.startsWith('inv_enchant') || ic.startsWith('inv_misc_dust') || ic.startsWith('inv_misc_essence') || ic.startsWith('inv_misc_etherealshard') || ic.startsWith('inv_misc_shacrystal')) {
    return { ahCategory: 'trade-goods', ahSubcategory: 'enchanting' };
  }
  if (cat === 'gems' || ic.startsWith('inv_misc_gem') || ic.startsWith('inv_jewelcrafting')) {
    return { ahCategory: 'gems' };
  }
  if (cat === 'projectile' || ic.startsWith('inv_ammo')) {
    return { ahCategory: 'projectile' };
  }
  if (cat === 'quiver' || ic.startsWith('inv_misc_quiver')) {
    return { ahCategory: 'quiver' };
  }
  if (cat === 'recipes' || nm.startsWith('recipe:') || nm.startsWith('pattern:') || nm.startsWith('plans:') || nm.startsWith('schematic:') || nm.startsWith('formula:') || nm.startsWith('manual:')) {
    return { ahCategory: 'recipes' };
  }
  if (cat === 'battle pets' || ic.startsWith('inv_pet') || ic.startsWith('inv_box_petcarrier')) {
    return { ahCategory: 'battle-pets' };
  }
  if (cat === 'trade goods' || ic.startsWith('inv_elemental') || ic.startsWith('inv_gizmo') || ic.startsWith('inv_alchemy')) {
    if (ic.startsWith('inv_elemental') || nm.includes('essence of') || nm.includes('core of') || nm.includes('heart of') || nm.includes('globe of') || nm.includes('breath of')) {
      return { ahCategory: 'trade-goods', ahSubcategory: 'elemental' };
    }
    return { ahCategory: 'trade-goods', ahSubcategory: 'parts' };
  }
  return { ahCategory: 'miscellaneous' };
}

export function parseWowheadTooltipPayload(
  itemId: number,
  raw: {
    name?: string;
    quality?: number;
    icon?: string;
    tooltip?: string;
  },
  flavor: FlavorId = 'forever',
): WowheadTooltipMeta | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) {
    return null;
  }
  const name = raw.name.trim();
  const quality = (
    typeof raw.quality === 'number' && raw.quality >= 0 && raw.quality <= 7
      ? raw.quality
      : 1
  ) as ItemQuality;
  const icon =
    typeof raw.icon === 'string' && raw.icon.trim()
      ? raw.icon.trim().toLowerCase()
      : DEFAULT_ITEM_ICON;
  const tooltip = typeof raw.tooltip === 'string' ? raw.tooltip : '';

  const ilvlMatch = /Item Level <!--ilvl-->(\d+)/i.exec(tooltip);
  const itemLevel = ilvlMatch ? Number(ilvlMatch[1]) : undefined;

  const rlvlMatch = /Requires Level <!--rlvl-->(\d+)/i.exec(tooltip);
  const reqLevel = rlvlMatch ? Number(rlvlMatch[1]) : undefined;

  const stackMatch = /Max Stack:\s*(\d+)/i.exec(tooltip);
  const stackSize = stackMatch ? Number(stackMatch[1]) : undefined;

  const scMatch = /<!--scstart(\d+):(-?\d+)--><span[^>]*>([^<]+)<\/span><!--scend-->/i.exec(tooltip);
  const classId = scMatch ? Number(scMatch[1]) : undefined;
  const subClassLabel = scMatch && scMatch[3] ? scMatch[3].trim() : undefined;

  const slotMatch = /<table width="100%"><tr><td>([^<]+)<\/td><th><!--scstart/i.exec(tooltip);
  const slot = slotMatch && slotMatch[1] ? slotMatch[1].trim() : undefined;

  let category = 'Miscellaneous';
  if (classId === 2 || slot === 'One-Hand' || slot === 'Two-Hand' || slot === 'Main Hand' || slot === 'Off Hand' || slot === 'Ranged') {
    category = 'Weapons';
  } else if (classId === 4 || /<!--amr-->\d+\s*Armor/i.test(tooltip)) {
    category = 'Armor';
  } else if (/Slot Bag/i.test(tooltip) || icon.startsWith('inv_misc_bag')) {
    category = 'Bags';
  } else if (icon.startsWith('inv_misc_herb') || icon.startsWith('inv_herbalism') || icon.startsWith('inv_misc_flower')) {
    category = 'Herbs';
  } else if (icon.startsWith('inv_ore') || icon.startsWith('inv_ingot') || icon.startsWith('inv_stone')) {
    category = 'Mining';
  } else if (icon.startsWith('inv_enchant') || icon.startsWith('inv_misc_dust')) {
    category = 'Enchanting';
  } else if (icon.startsWith('inv_fabric')) {
    category = 'Cloth';
  } else if (icon.startsWith('inv_misc_leather') || icon.startsWith('inv_misc_pelt')) {
    category = 'Leather';
  } else if (icon.startsWith('inv_misc_gem') || icon.startsWith('inv_jewelcrafting')) {
    category = 'Gems';
  } else if (icon.startsWith('inv_potion') || icon.startsWith('inv_misc_food') || icon.startsWith('inv_drink') || /Use:\s*<a[^>]*>Restores/i.test(tooltip)) {
    category = 'Consumables';
  } else if (icon.startsWith('inv_ammo')) {
    category = 'Projectile';
  } else if (/^(Recipe|Pattern|Plans|Schematic|Formula|Manual|Technique|Design):/i.test(name) || icon.startsWith('inv_scroll')) {
    category = 'Recipes';
  } else if (icon.startsWith('inv_glyph') || /^Glyph of /i.test(name)) {
    category = 'Glyphs';
  } else if (stackSize && stackSize >= 5) {
    category = 'Trade Goods';
  }

  const ahMapped = mapSeedCategoryToAh(category, icon, name);
  if (ahMapped.ahCategory === 'weapons' && slot === 'Two-Hand') {
    ahMapped.ahSubcategory = 'two-handed';
  } else if (ahMapped.ahCategory === 'weapons' && slot === 'Ranged') {
    ahMapped.ahSubcategory = 'ranged';
  } else if (ahMapped.ahCategory === 'armor') {
    const armorType = subClassLabel?.toLowerCase();
    if (armorType === 'cloth' || armorType === 'leather' || armorType === 'mail' || armorType === 'plate') {
      ahMapped.ahSubcategory = armorType;
    } else if (armorType === 'shield' || armorType === 'shields') {
      ahMapped.ahSubcategory = 'shields';
    }
  }

  const meta: WowheadTooltipMeta = {
    name,
    quality,
    icon,
    category,
    ...(subClassLabel ? { subCategory: subClassLabel } : {}),
    ahCategory: ahMapped.ahCategory,
    ...(ahMapped.ahSubcategory ? { ahSubcategory: ahMapped.ahSubcategory } : {}),
    ...(itemLevel !== undefined ? { itemLevel } : {}),
    ...(reqLevel !== undefined ? { reqLevel } : {}),
    ...(slot ? { slot } : {}),
    ...(stackSize !== undefined ? { stackSize } : {}),
    ...(tooltip ? { tooltipHtml: tooltip } : {}),
  };

  registerWowheadTooltipMeta(itemId, meta, flavor);
  return meta;
}

export function registerWowheadTooltipMeta(
  itemId: number,
  meta: WowheadTooltipMeta,
  flavor: FlavorId = 'forever',
): void {
  if (Number.isSafeInteger(itemId) && itemId > 0) {
    dynamicTooltipCache.set(`${flavor}:${itemId}`, meta);
  }
}

export function getCachedWowheadTooltipMeta(
  itemId: number,
  flavor: FlavorId = 'forever',
): WowheadTooltipMeta | undefined {
  return dynamicTooltipCache.get(`${flavor}:${itemId}`);
}

export function resolveItemMetadata(
  itemKey: string | number | { itemId: number; suffix?: number },
  flavor: FlavorId = 'forever',
): ItemMetadata {
  const parsed = normalizeItemKey(itemKey);

  if (parsed.isPetCage && parsed.petSpeciesId !== undefined) {
    const pet = PET_SPECIES_CATALOG[parsed.petSpeciesId];
    const icon = pet?.icon ?? PET_CAGE_ICON;
    return {
      itemKey: parsed.canonicalKey,
      itemId: parsed.itemId,
      suffix: parsed.suffix,
      isPetCage: true,
      petSpeciesId: parsed.petSpeciesId,
      name: pet ? pet.name : `Pet Cage #${parsed.petSpeciesId}`,
      quality: pet?.quality ?? 3,
      category: 'Battle Pets',
      ahCategory: 'battle-pets',
      itemLevel: 25,
      reqLevel: 1,
      icon,
      iconUrl: getItemIconUrl(icon),
      stackSize: 1,
      isSeeded: Boolean(pet),
      isFallback: !pet,
    };
  }

  const seeded = SEED_ITEM_CATALOG[parsed.itemId];
  const dynamic = getCachedWowheadTooltipMeta(parsed.itemId, flavor);
  const suffixLabel = resolveSuffixName(parsed.suffix);
  const formatWithSuffix = (base: string) =>
    parsed.suffix !== 0
      ? suffixLabel
        ? `${base} ${suffixLabel}`
        : `${base} (Variant #${parsed.suffix})`
      : base;

  if (seeded) {
    const baseName = dynamic?.name ?? seeded.name;
    const name = formatWithSuffix(baseName);
    const icon = dynamic?.icon ?? seeded.icon;
    const category = dynamic?.category ?? seeded.category;
    const ahMapped = mapSeedCategoryToAh(category, icon, baseName);
    return {
      itemKey: parsed.canonicalKey,
      itemId: parsed.itemId,
      suffix: parsed.suffix,
      isPetCage: false,
      name,
      quality: dynamic?.quality ?? seeded.quality,
      category,
      ...(dynamic?.subCategory ? { subCategory: dynamic.subCategory } : {}),
      ahCategory: dynamic?.ahCategory ?? ahMapped.ahCategory,
      ...(dynamic?.ahSubcategory ?? ahMapped.ahSubcategory
        ? { ahSubcategory: dynamic?.ahSubcategory ?? ahMapped.ahSubcategory }
        : {}),
      ...(dynamic?.itemLevel !== undefined ? { itemLevel: dynamic.itemLevel } : {}),
      ...(dynamic?.reqLevel !== undefined ? { reqLevel: dynamic.reqLevel } : {}),
      ...(dynamic?.slot ? { slot: dynamic.slot } : {}),
      icon,
      iconUrl: getItemIconUrl(icon),
      ...(dynamic?.tooltipHtml ? { tooltipHtml: dynamic.tooltipHtml } : {}),
      stackSize: dynamic?.stackSize ?? seeded.stackSize,
      isSeeded: true,
      isFallback: false,
    };
  }

  if (dynamic && dynamic.name) {
    const name = formatWithSuffix(dynamic.name);
    const icon = dynamic.icon ?? DEFAULT_ITEM_ICON;
    const category = dynamic.category ?? 'Miscellaneous';
    const ahMapped = mapSeedCategoryToAh(category, icon, dynamic.name);
    return {
      itemKey: parsed.canonicalKey,
      itemId: parsed.itemId,
      suffix: parsed.suffix,
      isPetCage: false,
      name,
      quality: dynamic.quality ?? 1,
      category,
      ...(dynamic.subCategory ? { subCategory: dynamic.subCategory } : {}),
      ahCategory: dynamic.ahCategory ?? ahMapped.ahCategory,
      ...(dynamic.ahSubcategory ?? ahMapped.ahSubcategory
        ? { ahSubcategory: dynamic.ahSubcategory ?? ahMapped.ahSubcategory }
        : {}),
      ...(dynamic.itemLevel !== undefined ? { itemLevel: dynamic.itemLevel } : {}),
      ...(dynamic.reqLevel !== undefined ? { reqLevel: dynamic.reqLevel } : {}),
      ...(dynamic.slot ? { slot: dynamic.slot } : {}),
      icon,
      iconUrl: getItemIconUrl(icon),
      ...(dynamic.tooltipHtml ? { tooltipHtml: dynamic.tooltipHtml } : {}),
      ...(dynamic.stackSize !== undefined ? { stackSize: dynamic.stackSize } : {}),
      isSeeded: false,
      isFallback: false,
    };
  }

  return {
    itemKey: parsed.canonicalKey,
    itemId: parsed.itemId,
    suffix: parsed.suffix,
    isPetCage: false,
    name: formatWithSuffix(`#${parsed.itemId}`),
    quality: 1,
    category: 'Unknown',
    ahCategory: 'miscellaneous',
    icon: DEFAULT_ITEM_ICON,
    iconUrl: getItemIconUrl(DEFAULT_ITEM_ICON),
    isSeeded: false,
    isFallback: true,
  };
}

export const resolveItemMeta = resolveItemMetadata;
