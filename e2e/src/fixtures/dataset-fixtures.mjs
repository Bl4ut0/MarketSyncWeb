import { ANNIVERSARY_REALMS, MAX_COPPER_CAP } from '../contracts.mjs';

/**
 * Deterministic Mulberry32 PRNG.
 */
export function createPrng(seed = 20261122) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DATE_STR = '2026-11-22';

export const HOUR_TIMESTAMPS = Object.freeze({
  '07': 1795333449,
  '08': 1795336513,
  '09': 1795338869,
  '10': 1795342469,
});

export const CLASSIC_ERA_REALMS = Object.freeze([
  'whitemane', 'mankrik', 'doomhowl', 'defias-pillager', 'remulos',
  'pagle', 'benediction', 'faerlina', 'grobbulus', 'atiesh',
  'ashkandi', 'bloodsail-buccaneers', 'deviate-delight', 'earthfury', 'herod',
  'incendius', 'kirtonos', 'kromcrush', 'myzrael', 'old-blanchy',
  'rattlegore', 'skeram', 'stalagg',
]);

export const ANCHOR_ITEMS = Object.freeze({
  DREAMFOIL: '13464',
  PLAGUEBLOOM: '13463',
  LARGE_BRILLIANT_SHARD: '14344',
  MAJOR_MANA_POTION: '13444',
  BLOOD_OF_THE_MOUNTAIN: '11382',
  LAVA_CORE: '17011',
  SUFFIXED_ITEM: '13005:4512',
  COPPER_CAP_ITEM: '3030',
  COPPER_64BIT_FOREVER: '90001',
  COPPER_64BIT_CLASSIC: '92426',
  COPPER_64BIT_RETAIL: '6306',
  PET_CAGE_1: '82800:48213',
  PET_CAGE_2: '82800:48212',
  PET_CAGE_3: '82800:18269',
  UNCACHED_ITEM: '999999',
  PEACEBLOOM: '2447',
  HOCHENBLUME: '190396',
});

function computeStats(rulesets, status = 'live') {
  let totalItems = 0;
  let totalVolume = 0;
  for (const markets of Object.values(rulesets)) {
    for (const items of Object.values(markets)) {
      for (const entry of Object.values(items)) {
        totalItems += 1;
        totalVolume += entry.totalQty || 0;
      }
    }
  }
  return { totalItems, totalVolume, status };
}

function makeListing(minPrice, maxPrice, totalQty, listings, time) {
  return { minPrice, maxPrice, totalQty, listings, time };
}

function makeSyntheticMarket(rng, count, time, baseIdOffset = 2000, includeSuffixes = true) {
  const market = {};
  for (let i = 0; i < count; i++) {
    const id = baseIdOffset + i;
    const key = includeSuffixes && i % 13 === 0 ? `${id}:${1000 + (i % 900)}` : String(id);
    const minPrice = 100 + Math.floor(rng() * 85000);
    const maxPrice = minPrice + 50 + Math.floor(rng() * 45000);
    const listings = 1 + Math.floor(rng() * 35);
    const totalQty = listings * (1 + Math.floor(rng() * 20));
    market[key] = makeListing(minPrice, maxPrice, totalQty, listings, time);
  }
  return market;
}

function buildLegacyHour07Block() {
  const time = HOUR_TIMESTAMPS['07'];
  const horde = {
    '11382': makeListing(42000, 58000, 18, 6, time),
    '13463': makeListing(11500, 14800, 140, 22, time),
    '13464': makeListing(12000, 15500, 180, 28, time),
    '14343': makeListing(32000, 41000, 45, 11, time),
    '14344': makeListing(48000, 62000, 94, 19, time),
    '17011': makeListing(85000, 112000, 60, 8, time),
  };
  const alliance = {
    '11382': makeListing(41000, 56000, 15, 5, time),
    '13463': makeListing(11000, 14200, 120, 19, time),
    '13464': makeListing(11800, 15200, 165, 24, time),
    '14343': makeListing(31500, 40500, 38, 9, time),
    '14344': makeListing(47500, 61000, 85, 16, time),
    '17011': makeListing(84000, 110000, 52, 7, time),
  };
  const neutral = {
    '13464': makeListing(14500, 19500, 24, 4, time),
    '14344': makeListing(52000, 69000, 12, 3, time),
  };
  const rulesets = {
    english: {
      Horde: horde,
      Alliance: alliance,
      Neutral: neutral,
    },
  };
  return {
    version: '1.0',
    // flavor intentionally omitted (legacy simulated block)
    timestamp: time,
    isoDate: `${DATE_STR}T07:04:09.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'simulated'),
  };
}

function buildForeverBlock(hour, { omitFlavor = false } = {}) {
  const rng = createPrng(20261122 + Number(hour) * 101);
  const time = HOUR_TIMESTAMPS[hour];
  const useLegacyKeys = hour === '08';
  const rulesetKeys = useLegacyKeys
    ? ['p', 'n', 'r']
    : ['pvp', 'normal', 'roleplay', 'roleplaypvp'];

  // Deterministic price progressions for multi-hour history & alert triggers:
  // Hour 08: Dreamfoil (13464) = 12500, Major Mana Potion (13444) = 48000, Suffixed (13005:4512) = 8500
  // Hour 09: Dreamfoil = 13000, Major Mana Potion = 50000, Suffixed = 8999
  // Hour 10: Dreamfoil spikes 13000 -> 45000 (+246%), Major Mana Potion spikes 50000 -> 75000, Suffixed drops 8999 -> 4500 (-50%)
  const dreamfoilPrice = hour === '08' ? 12500 : hour === '09' ? 13000 : 45000;
  const manaPotPrice = hour === '08' ? 48000 : hour === '09' ? 50000 : 75000;
  const suffixedPrice = hour === '08' ? 8500 : hour === '09' ? 8999 : 4500;

  const rulesets = {};
  for (const [rIdx, key] of rulesetKeys.entries()) {
    const shift = rIdx * 100;
    const alliance = {
      ...makeSyntheticMarket(rng, 40, time, 2100 + rIdx * 100),
      '13464': makeListing(dreamfoilPrice + shift, dreamfoilPrice + 3500 + shift, 320, 42, time),
      '13463': makeListing(11200 + shift, 14600 + shift, 210, 29, time),
      '14344': makeListing(46000 + shift, 59000 + shift, 150, 21, time),
      '13444': makeListing(manaPotPrice + shift, manaPotPrice + 9000 + shift, 440, 55, time),
      '11382': makeListing(42000 + shift, 55000 + shift, 35, 9, time),
      '17011': makeListing(82000 + shift, 98000 + shift, 44, 12, time),
      '13005:4512': makeListing(suffixedPrice, suffixedPrice + 2500, 6, 3, time),
      '90001': makeListing(5000000000, 5500000000, 2, 2, time),
      '999999': makeListing(1234, 2468, 5, 2, time),
    };
    const horde = {
      ...makeSyntheticMarket(rng, 35, time, 3100 + rIdx * 100),
      '13464': makeListing(dreamfoilPrice + 200 + shift, dreamfoilPrice + 3800 + shift, 290, 38, time),
      '13444': makeListing(manaPotPrice + 400 + shift, manaPotPrice + 9500 + shift, 390, 47, time),
      '13005:4512': makeListing(suffixedPrice + 100, suffixedPrice + 2800, 4, 2, time),
    };
    const neutral = {
      ...makeSyntheticMarket(rng, 15, time, 4100 + rIdx * 100),
      '3030': makeListing(8, MAX_COPPER_CAP, 12, 4, time),
      '13464': makeListing(dreamfoilPrice + 1200, dreamfoilPrice + 4800, 34, 6, time),
    };
    rulesets[key] = { Alliance: alliance, Horde: horde, Neutral: neutral };
  }

  const block = {
    version: '1.0',
    ...(omitFlavor ? {} : { flavor: 'forever' }),
    timestamp: time,
    isoDate: `${DATE_STR}T${hour}:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };
  return block;
}

function buildClassicEraBlock(hour) {
  const time = HOUR_TIMESTAMPS[hour];
  const rulesets = {};
  for (const realm of CLASSIC_ERA_REALMS) {
    if (hour === '08') {
      // Real-world edge case observed in MarketSyncData: Alliance key omitted completely in 08-00.json
      rulesets[realm] = { Horde: {}, Neutral: {} };
    } else {
      rulesets[realm] = { Alliance: {}, Horde: {}, Neutral: {} };
    }
  }
  return {
    version: '1.0',
    flavor: 'classicEra',
    timestamp: time,
    isoDate: `${DATE_STR}T${hour}:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };
}

function buildAnniversaryBlock(hour, { populated = false } = {}) {
  const time = HOUR_TIMESTAMPS[hour];
  const rulesets = {};
  for (const realm of ANNIVERSARY_REALMS) {
    if (populated && realm === 'dreamscythe') {
      rulesets[realm] = {
        Alliance: {
          '13464': makeListing(10500, 13200, 80, 14, time),
          '13444': makeListing(36000, 42000, 60, 12, time),
        },
        Horde: {
          '13464': makeListing(10800, 13800, 65, 11, time),
        },
        Neutral: {},
      };
    } else {
      rulesets[realm] = { Alliance: {}, Horde: {}, Neutral: {} };
    }
  }
  return {
    version: '1.0',
    flavor: 'anniversary',
    timestamp: time,
    isoDate: `${DATE_STR}T${hour}:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };
}

function buildClassicBlock(hour) {
  const rng = createPrng(20261122 + 500 + Number(hour));
  const time = HOUR_TIMESTAMPS[hour];
  const petBase = hour === '08' ? 14500000 : hour === '09' ? 16200000 : 12100000;

  const rulesets = {
    pagle: {
      CrossFaction: {
        ...makeSyntheticMarket(rng, 45, time, 52000, true),
        '82800:48213': makeListing(petBase, petBase + 4500000, 5, 5, time),
        '82800:48212': makeListing(8500000, 11000000, 3, 3, time),
        '82800:18269': makeListing(6200000, 7900000, 2, 2, time),
        '92426': makeListing(3333330000, 4999990000, 3, 3, time),
        '19019:0': makeListing(250000, 340000, 8, 4, time),
      },
    },
    atiesh: {
      CrossFaction: {
        ...makeSyntheticMarket(rng, 25, time, 54000, true),
        '82800:48213': makeListing(petBase + 500000, petBase + 5000000, 2, 2, time),
      },
    },
    mankrik: {
      CrossFaction: {
        ...makeSyntheticMarket(rng, 20, time, 56000, false),
      },
    },
    'arugal-au': {
      CrossFaction: {
        ...makeSyntheticMarket(rng, 15, time, 58000, false),
      },
    },
    myzrael: {
      CrossFaction: {},
    },
    benediction: {
      CrossFaction: {},
    },
  };

  return {
    version: '1.0',
    flavor: 'classic',
    timestamp: time,
    isoDate: `${DATE_STR}T${hour}:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };
}

function buildRetailBlock(hour) {
  const rng = createPrng(20261122 + 900 + Number(hour));
  const time = HOUR_TIMESTAMPS[hour];
  // Hour 08: 2447 = 28000, 190396 = 14000
  // Hour 09: 2447 = 30000, 190396 = 15000
  // Hour 10: 2447 drops 30000 -> 12000 (triggers 'below'), 190396 spikes 15000 -> 42000 (triggers 'above')
  const peacebloomPrice = hour === '08' ? 28000 : hour === '09' ? 30000 : 12000;
  const hochenblumePrice = hour === '08' ? 14000 : hour === '09' ? 15000 : 42000;

  const rulesets = {
    region: {
      Commodities: {
        ...makeSyntheticMarket(rng, 55, time, 190000, false),
        '2447': makeListing(peacebloomPrice, peacebloomPrice + 6000, 18400, 312, time),
        '190396': makeListing(hochenblumePrice, hochenblumePrice + 8500, 42100, 528, time),
        '6306': makeListing(29720000000, 99999999900, 4, 4, time),
      },
    },
  };

  return {
    version: '1.0',
    flavor: 'retail',
    timestamp: time,
    isoDate: `${DATE_STR}T${hour}:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };
}

/**
 * Deterministically generates a realistic `forever` snapshot strictly >= 9,500,000 bytes
 * (exceeding both 9 MiB = 9,437,184 bytes and 9.1 MB = 9,100,000 bytes).
 */
export function generateLargeForeverSnapshot({
  minBytes = 9_500_000,
  timestamp = HOUR_TIMESTAMPS['09'],
} = {}) {
  const rng = createPrng(9500000);
  const rulesetKeys = ['pvp', 'normal', 'roleplay', 'roleplaypvp'];
  const rulesets = {};

  for (const [rIdx, rKey] of rulesetKeys.entries()) {
    const alliance = makeSyntheticMarket(rng, 7100, timestamp, 10000 + rIdx * 20000, true);
    const horde = makeSyntheticMarket(rng, 7100, timestamp, 18000 + rIdx * 20000, true);
    const neutral = makeSyntheticMarket(rng, 1600, timestamp, 26000 + rIdx * 20000, true);

    // Inject canonical anchor items in every ruleset
    alliance['13464'] = makeListing(13000, 16500, 450, 42, timestamp);
    alliance['13463'] = makeListing(11500, 14800, 310, 31, timestamp);
    alliance['14344'] = makeListing(48000, 62000, 180, 25, timestamp);
    alliance['13444'] = makeListing(50000, 59000, 520, 61, timestamp);
    alliance['13005:4512'] = makeListing(8999, 11499, 6, 3, timestamp);
    alliance['90001'] = makeListing(5000000000, 5500000000, 2, 2, timestamp);
    alliance['999999'] = makeListing(1234, 2468, 5, 2, timestamp);
    neutral['3030'] = makeListing(8, MAX_COPPER_CAP, 12, 4, timestamp);

    rulesets[rKey] = {
      Alliance: alliance,
      Horde: horde,
      Neutral: neutral,
    };
  }

  const block = {
    version: '1.0',
    flavor: 'forever',
    timestamp,
    isoDate: `${DATE_STR}T09:00:00.000Z`,
    region: 'us',
    rulesets,
    stats: computeStats(rulesets, 'live'),
  };

  let json = JSON.stringify(block, null, 2);
  let byteLength = Buffer.byteLength(json, 'utf8');
  let extraId = 900000;

  while (byteLength < minBytes) {
    for (let i = 0; i < 500; i++) {
      const id = extraId++;
      rulesets.normal.Alliance[String(id)] = makeListing(1500 + (i % 500), 3500 + (i % 900), 25, 5, timestamp);
    }
    block.stats = computeStats(rulesets, 'live');
    json = JSON.stringify(block, null, 2);
    byteLength = Buffer.byteLength(json, 'utf8');
  }

  return { block, json, byteLength };
}

function makeIndexEntry({ flavor, date = DATE_STR, hour, path, block, simulated = false }) {
  const entry = {
    ...(flavor ? { flavor } : {}),
    date,
    hour,
    path,
    items: block.stats.totalItems,
    volume: block.stats.totalVolume,
    timestamp: block.timestamp,
    simulated,
  };
  return entry;
}

/**
 * Builds the complete deterministic multi-flavor, multi-hour fixture dataset.
 */
export function buildFixtureDataset({
  maxHour = '09',
  includeLegacyRoot = true,
  populateAnniversary = false,
} = {}) {
  const files = new Map();
  const blocks = [];
  const activeHours = ['08', '09', '10'].filter((h) => h <= maxHour);

  if (includeLegacyRoot) {
    const legacy07 = buildLegacyHour07Block();
    const p07 = `datasets/${DATE_STR}/07-00.json`;
    files.set(p07, JSON.stringify(legacy07, null, 2));
    blocks.push(makeIndexEntry({ hour: '07', path: p07, block: legacy07, simulated: true }));

    const legacy08 = buildForeverBlock('08', { omitFlavor: true });
    const p08 = `datasets/${DATE_STR}/08-00.json`;
    files.set(p08, JSON.stringify(legacy08, null, 2));
    blocks.push(makeIndexEntry({ hour: '08', path: p08, block: legacy08, simulated: false }));
  }

  for (const hour of activeHours) {
    const flavorMap = [
      ['forever', buildForeverBlock(hour)],
      ['classicEra', buildClassicEraBlock(hour)],
      ['anniversary', buildAnniversaryBlock(hour, { populated: populateAnniversary })],
      ['classic', buildClassicBlock(hour)],
      ['retail', buildRetailBlock(hour)],
    ];

    for (const [flavor, block] of flavorMap) {
      const filePath = `datasets/${flavor}/${DATE_STR}/${hour}-00.json`;
      files.set(filePath, JSON.stringify(block, null, 2));
      blocks.push(makeIndexEntry({ flavor, hour, path: filePath, block, simulated: false }));
    }
  }

  // Corrupt / edge-case files (not indexed in index.json)
  files.set('datasets/corrupt/bad-json.json', '{"version":"1.0","flavor":"forever","rulesets":{"pvp":');
  files.set('datasets/corrupt/empty-body.json', '');
  files.set('datasets/corrupt/wrong-schema.json', JSON.stringify({ unexpected: true, count: 0 }));

  const index = {
    blocks,
    lastUpdated: `${DATE_STR}T${maxHour}:05:00.000Z`,
  };
  files.set('datasets/index.json', JSON.stringify(index, null, 2));

  return { index, files };
}
