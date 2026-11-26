import type { FactionPartition, FlavorConfig } from '@marketsync/shared';

// Market selection model shared by the desktop and mobile layouts.
//
//   1. Faction switch: Alliance or Horde. It is the player's own faction and is
//      remembered between visits.
//   2. Partition: playstyle (Forever rulesets), realm (Classic connected realms)
//      or region (Retail).
//   3. Market: the auction house to browse. The player's faction AH, plus every
//      shared market the partition has: Neutral (the same for both factions),
//      cross-faction or region commodities.
//
// The active market is still a FactionPartition ('Alliance', 'Horde', 'Neutral',
// 'CrossFaction', 'Commodities'), so data loading and deep links are unchanged.

export type HomeFaction = 'Alliance' | 'Horde';

export const HOME_FACTIONS: readonly HomeFaction[] = ['Alliance', 'Horde'];
export const HOME_FACTION_STORAGE_KEY = 'marketsync.homeFaction';

export function isHomeFaction(value: unknown): value is HomeFaction {
  return value === 'Alliance' || value === 'Horde';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadHomeFaction(storage: StorageLike | undefined = defaultStorage()): HomeFaction | null {
  try {
    const stored = storage?.getItem(HOME_FACTION_STORAGE_KEY);
    return isHomeFaction(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveHomeFaction(faction: HomeFaction, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(HOME_FACTION_STORAGE_KEY, faction);
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
}

/**
 * The faction to start with: a faction named in a deep link, then the stored
 * choice, then Alliance. A Neutral or shared-market deep link keeps the stored
 * faction.
 */
export function initialHomeFaction(
  routeFaction: FactionPartition | undefined,
  storage: StorageLike | undefined = defaultStorage(),
): HomeFaction {
  if (isHomeFaction(routeFaction)) return routeFaction;
  return loadHomeFaction(storage) ?? 'Alliance';
}

/** Label for the partition selector under the faction switch. */
export function partitionSelectorLabel(partitionType: FlavorConfig['partitionType']): string {
  if (partitionType === 'ruleset') return 'Playstyle';
  if (partitionType === 'region') return 'Region';
  return 'Realm';
}

export interface MarketChoice {
  market: FactionPartition;
  /** 'faction' is the player's faction AH; 'shared' is any market both factions use. */
  kind: 'faction' | 'shared';
  label: string;
}

const SHARED_LABELS: Record<string, string> = {
  Neutral: 'Neutral AH',
  CrossFaction: 'Cross-faction AH',
  Commodities: 'Region commodities',
};

export function marketLabel(market: FactionPartition): string {
  if (isHomeFaction(market)) return `${market} AH`;
  return SHARED_LABELS[market] ?? market;
}

/**
 * The markets offered for one faction: its own AH when the partition has one,
 * then every shared market (Neutral, cross-faction, commodities). The other
 * faction's AH is reached with the faction switch, not listed here.
 */
export function marketChoices(available: readonly FactionPartition[], home: HomeFaction): MarketChoice[] {
  const choices: MarketChoice[] = [];
  if (available.includes(home)) choices.push({ market: home, kind: 'faction', label: marketLabel(home) });
  for (const market of available) {
    if (isHomeFaction(market)) continue;
    choices.push({ market, kind: 'shared', label: marketLabel(market) });
  }
  return choices;
}

/** Whether the partition has separate Alliance and Horde auction houses. */
export function hasFactionMarkets(available: readonly FactionPartition[]): boolean {
  return available.some(isHomeFaction);
}

/**
 * Keep the active market valid when the faction, partition or edition changes:
 * keep the current market if it is still offered, otherwise use the faction's
 * own AH, otherwise the first shared market.
 */
export function resolveMarket(
  available: readonly FactionPartition[],
  home: HomeFaction,
  current: FactionPartition,
): FactionPartition | undefined {
  const choices = marketChoices(available, home);
  if (choices.some((choice) => choice.market === current)) return current;
  return choices[0]?.market;
}
