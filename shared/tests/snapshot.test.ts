import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLAVOR_IDS,
  MAX_COPPER,
  normalizeSnapshot,
  parseDatasetIndex,
} from '@marketsync/shared';

const DATA_ROOT = 'c:\\Dev Projects\\MarketSyncData\\datasets';
const hasMarketSyncData = fs.existsSync(path.join(DATA_ROOT, 'index.json'));

function readDatasetJson(relPath: string): unknown {
  const fullPath = path.join(DATA_ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

describe('Dataset index & snapshot normalization', () => {
  it('normalizes just the history market while merging aliases and keeping variants', () => {
    const low = { minPrice: 8, maxPrice: 12, totalQty: 3, listings: 2 };
    const high = { minPrice: 10, maxPrice: 20, totalQty: 4, listings: 3 };
    const raw = {
      flavor: 'forever',
      timestamp: 1_795_350_000,
      rulesets: {
        p: { Alliance: { '13005:4512': low }, Horde: { '13005:4512': high } },
        pvp: { alliance: { '13005:4512': high, '13005': high } },
        normal: { Alliance: { '13005:4512': high } },
      },
    };
    const full = normalizeSnapshot(raw);
    const filtered = normalizeSnapshot(raw, 'forever', { partitionKey: 'pvp', faction: 'Alliance' });
    expect(Object.keys(filtered.partitions)).toEqual(['pvp']);
    expect(filtered.partitions.pvp?.factions).toEqual({ Alliance: full.partitions.pvp?.factions.Alliance });
    expect(filtered.partitions.pvp?.factions.Alliance?.['13005:4512']).toMatchObject({
      minPrice: 8, maxPrice: 20, totalQty: 7, listings: 5,
    });
    expect(filtered.timestamp).toBe(full.timestamp);
    expect(filtered.isoDate).toBe(full.isoDate);
  });

  it.skipIf(!hasMarketSyncData)(
    'parses real MarketSyncData datasets/index.json including legacy flavorless & simulated blocks',
    () => {
      const rawIndex = readDatasetJson('index.json');
      const parsed = parseDatasetIndex(rawIndex);

      expect(parsed.blocks.length).toBeGreaterThanOrEqual(11);
      expect(parsed.lastUpdated).toBeTruthy();

      // Legacy blocks omitting flavor default to forever and preserve simulated flags
      const legacySim = parsed.blocks.find((b) => b.path === 'datasets/2026-11-22/07-00.json');
      expect(legacySim).toBeDefined();
      expect(legacySim?.flavor).toBe('forever');
      expect(legacySim?.simulated).toBe(true);
      expect(legacySim?.isLegacyPath).toBe(true);

      const legacyLive = parsed.blocks.find((b) => b.path === 'datasets/2026-11-22/08-00.json');
      expect(legacyLive?.flavor).toBe('forever');
      expect(legacyLive?.simulated).toBe(false);
      expect(legacyLive?.isLegacyPath).toBe(true);

      // The archive grows every hour, so assert that each flavor points to its newest capture.
      for (const flavor of FLAVOR_IDS) {
        const captures = parsed.blocks.filter((block) => block.flavor === flavor);
        expect(parsed.latestByFlavor[flavor]?.timestamp).toBe(Math.max(...captures.map((block) => block.timestamp)));
        const live = captures.filter((block) => !block.simulated);
        expect(parsed.latestLiveByFlavor[flavor]?.timestamp).toBe(Math.max(...live.map((block) => block.timestamp)));
        expect(parsed.latestLiveByFlavor[flavor]?.simulated).toBe(false);
      }

      // Filtering out simulated blocks removes 07-00.json
      const liveOnly = parseDatasetIndex(rawIndex, { includeSimulated: false });
      expect(liveOnly.blocks.some((b) => b.simulated)).toBe(false);
      expect(
        liveOnly.blocks.find((b) => b.path === 'datasets/2026-11-22/07-00.json'),
      ).toBeUndefined();
    },
  );

  it.skipIf(!hasMarketSyncData)(
    'normalizes legacy simulated 07-00.json and legacy live 08-00.json',
    () => {
      const simSnap = normalizeSnapshot(readDatasetJson('2026-11-22/07-00.json'));
      expect(simSnap.flavor).toBe('forever');
      expect(simSnap.simulated).toBe(true);
      expect(simSnap.partitions.english).toBeDefined();
      expect(simSnap.partitions.english?.label).toBe('English');
      expect(simSnap.declaredStats.totalItems).toBe(6);
      expect(simSnap.computedStats.entryCount).toBe(18);
      expect(simSnap.computedStats.uniqueItemCount).toBe(6);

      const legacySnap = normalizeSnapshot(readDatasetJson('2026-11-22/08-00.json'));
      expect(legacySnap.flavor).toBe('forever');
      expect(legacySnap.simulated).toBe(false);
      expect(Object.keys(legacySnap.partitions).sort()).toEqual(['normal', 'pvp', 'roleplay']);
      expect(legacySnap.computedStats.entryCount).toBe(51_999);
    },
  );

  it.skipIf(!hasMarketSyncData)(
    'normalizes forever 08-00 (p/r/n) and 09-00 (pvp/normal/roleplay/roleplaypvp) with 64-bit copper and stats reconciliation',
    () => {
      const f08 = normalizeSnapshot(readDatasetJson('forever/2026-11-22/08-00.json'));
      expect(f08.flavor).toBe('forever');
      expect(f08.partitions.pvp?.rawKeys).toEqual(['p']);
      expect(f08.partitions.roleplay?.rawKeys).toEqual(['r']);
      expect(f08.partitions.normal?.rawKeys).toEqual(['n']);
      expect(f08.declaredStats.totalItems).toBe(403_824);
      expect(f08.computedStats.entryCount).toBe(51_999);

      const f09 = normalizeSnapshot(readDatasetJson('forever/2026-11-22/09-00.json'));
      expect(Object.keys(f09.partitions).sort()).toEqual([
        'normal',
        'pvp',
        'roleplay',
        'roleplaypvp',
      ]);
      expect(f09.computedStats.entryCount).toBe(69_332);

      // Verify 64-bit copper max price and suffixed item key presence
      let maxObserved = 0;
      let sawSuffixed = false;
      for (const part of Object.values(f09.partitions)) {
        for (const items of Object.values(part.factions)) {
          for (const entry of Object.values(items)) {
            if (entry.maxPrice > maxObserved) maxObserved = entry.maxPrice;
            if (entry.itemKey === '13005:4512') sawSuffixed = true;
          }
        }
      }
      expect(maxObserved).toBe(MAX_COPPER);
      expect(sawSuffixed).toBe(true);
    },
  );

  it.skipIf(!hasMarketSyncData)(
    'normalizes anniversary 09-00 and classicEra 08-00/09-00 empty & missing-faction realms gracefully',
    () => {
      const ann09 = normalizeSnapshot(readDatasetJson('anniversary/2026-11-22/09-00.json'));
      expect(ann09.flavor).toBe('anniversary');
      expect(Object.keys(ann09.partitions).sort()).toEqual([
        'dreamscythe',
        'maladath',
        'nightslayer',
      ]);
      expect(ann09.computedStats.entryCount).toBe(0);
      expect(ann09.partitions.dreamscythe?.missingExpectedFactions).toEqual([]);

      const era08 = normalizeSnapshot(readDatasetJson('classicEra/2026-11-22/08-00.json'));
      expect(era08.flavor).toBe('classicEra');
      expect(era08.computedStats.partitionCount).toBe(23);
      expect(era08.computedStats.entryCount).toBe(0);
      const firstRealm = Object.values(era08.partitions)[0];
      expect(firstRealm?.missingExpectedFactions).toEqual(['Alliance']);

      const era09 = normalizeSnapshot(readDatasetJson('classicEra/2026-11-22/09-00.json'));
      expect(era09.computedStats.partitionCount).toBe(23);
      expect(era09.partitions.doomhowl).toBeDefined();
    },
  );

  it.skipIf(!hasMarketSyncData)(
    'normalizes classic 09-00 (CrossFaction + Pet Cages) and retail 09-00 (Commodities)',
    () => {
      const classic09 = normalizeSnapshot(readDatasetJson('classic/2026-11-22/09-00.json'));
      expect(classic09.flavor).toBe('classic');
      expect(classic09.computedStats.partitionCount).toBe(23);
      expect(classic09.partitions.pagle?.entryCount).toBe(5186);
      expect(classic09.partitions.myzrael?.entryCount).toBe(0);
      const direhorn = classic09.partitions.pagle?.factions.CrossFaction?.['82800:48213'];
      expect(direhorn?.isPetCage).toBe(true);
      expect(direhorn?.petSpeciesId).toBe(48213);
      const relic = classic09.partitions.pagle?.factions.CrossFaction?.['79330:445'];
      expect(relic?.itemId).toBe(79330);
      expect(relic?.suffixId).toBe(445);

      const retail09 = normalizeSnapshot(readDatasetJson('retail/2026-11-22/09-00.json'));
      expect(retail09.flavor).toBe('retail');
      expect(retail09.partitions.region?.label).toBe('Region-Wide');
      expect(retail09.partitions.region?.entryCount).toBe(9774);
      let retailMax = 0;
      for (const entry of Object.values(
        retail09.partitions.region?.factions.Commodities ?? {},
      )) {
        if (entry.maxPrice > retailMax) retailMax = entry.maxPrice;
      }
      expect(retailMax).toBe(99_999_999_900);
    },
  );

  it('handles synthetic Anniversary doomhowl 0-listing & mixed realms and rejects path traversal', () => {
    const syntheticAnn = normalizeSnapshot({
      version: '1.0',
      flavor: 'anniversary',
      timestamp: 1795340000,
      isoDate: '2026-11-22T10:00:00.000Z',
      region: 'us',
      rulesets: {
        dreamscythe: { Alliance: {}, Horde: {}, Neutral: {} },
        nightslayer: {
          Alliance: {
            '13464': {
              minPrice: 12000,
              maxPrice: 15000,
              totalQty: 10,
              listings: 2,
              time: 1795340000,
            },
          },
          Horde: {},
          Neutral: {},
        },
        maladath: { Alliance: {}, Horde: {}, Neutral: {} },
        doomhowl: { Alliance: {}, Horde: {}, Neutral: {} },
      },
      stats: { totalItems: 1, totalVolume: 10, status: 'live' },
    });

    expect(Object.keys(syntheticAnn.partitions).sort()).toEqual([
      'doomhowl',
      'dreamscythe',
      'maladath',
      'nightslayer',
    ]);
    expect(syntheticAnn.partitions.doomhowl?.label).toBe('Doomhowl (Hardcore)');
    expect(syntheticAnn.partitions.doomhowl?.entryCount).toBe(0);
    expect(syntheticAnn.partitions.nightslayer?.entryCount).toBe(1);

    expect(() =>
      parseDatasetIndex({
        lastUpdated: null,
        blocks: [
          {
            date: '2026-11-22',
            hour: '09',
            path: 'datasets/../../etc/passwd.json',
            items: 0,
            volume: 0,
            timestamp: 1,
          },
        ],
      }),
    ).toThrow(/unsafe dataset block path/i);
  });
});
