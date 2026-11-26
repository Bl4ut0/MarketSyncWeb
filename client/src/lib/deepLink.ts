import { isFlavorId } from '@marketsync/shared';
import type { FactionPartition, FlavorId } from '@marketsync/shared';

// Deep links for the web app and the MarketSync addon.
//
//   /ah/<flavor>/<ruleset>/<faction>[/<date>[/<hour>]]
//   /analytics/<flavor>/<ruleset>/<faction>[/<date>[/<hour>]]
//   /item/<flavor>/<ruleset>/<faction>/<itemKey>[/<date>[/<hour>]]
//
//   flavor   forever | classicEra | anniversary | classic | retail
//   ruleset  pvp | normal | roleplay | roleplaypvp | hardcore, or a connected-realm slug
//   faction  alliance | horde | neutral | crossfaction | commodities
//            (the market; case-insensitive in the URL)
//   itemKey  "13464" or a suffix variant "19999:832"
//   date     YYYY-MM-DD (UTC scan day)
//   hour     HH (00-23), the hourly snapshot inside that day
//
// Example: /item/forever/pvp/alliance/13464/2026-11-25/17

export type DeepLinkAction = 'ah' | 'analytics' | 'item';

export interface DeepLinkRoute {
  action: DeepLinkAction;
  flavor: FlavorId;
  ruleset: string;
  faction: FactionPartition;
  itemKey?: string;
  date?: string;
  hour?: string;
}

const ACTIONS: readonly DeepLinkAction[] = ['ah', 'analytics', 'item'];
// Alliance and Horde are the player's faction AH; the rest are shared markets
// (Neutral on Forever and Classic Era, cross-faction on Classic, region
// commodities on Retail).
const FACTIONS: Record<string, FactionPartition> = {
  alliance: 'Alliance',
  horde: 'Horde',
  neutral: 'Neutral',
  crossfaction: 'CrossFaction',
  commodities: 'Commodities',
};
const RULESET_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ITEM_KEY_PATTERN = /^\d+(:\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_PATTERN = /^([01]\d|2[0-3])$/;

export function factionSlug(faction: FactionPartition): string {
  return faction.toLowerCase();
}

export function isValidDeepLinkDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function parseDeepLink(pathname: string): DeepLinkRoute | null {
  const segments = pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return null;
    }
  });
  if (segments.length < 4 || segments.some((part) => part === null)) return null;
  const [action, flavor, ruleset, factionSegment, ...rest] = segments as [string, string, string, string, ...string[]];

  if (!ACTIONS.includes(action as DeepLinkAction)) return null;
  if (!isFlavorId(flavor)) return null;
  if (!RULESET_PATTERN.test(ruleset.toLowerCase())) return null;
  const faction = FACTIONS[factionSegment.toLowerCase()];
  if (!faction) return null;

  const route: DeepLinkRoute = {
    action: action as DeepLinkAction,
    flavor,
    ruleset: ruleset.toLowerCase(),
    faction,
  };

  let tail = rest;
  if (route.action === 'item') {
    const [itemKey, ...after] = rest;
    if (!itemKey || !ITEM_KEY_PATTERN.test(itemKey)) return null;
    route.itemKey = itemKey;
    tail = after;
  }

  const [date, hour, ...extra] = tail;
  if (extra.length > 0) return null;
  if (date !== undefined) {
    if (!isValidDeepLinkDate(date)) return null;
    route.date = date;
  }
  if (hour !== undefined) {
    if (date === undefined || !HOUR_PATTERN.test(hour)) return null;
    route.hour = hour;
  }
  return route;
}

export function buildDeepLink(route: DeepLinkRoute): string {
  const parts: string[] = [route.action, route.flavor, route.ruleset.toLowerCase(), factionSlug(route.faction)];
  if (route.action === 'item') {
    if (!route.itemKey) throw new Error('An item deep link needs an itemKey');
    parts.push(route.itemKey);
  }
  if (route.date) {
    parts.push(route.date);
    if (route.hour) parts.push(route.hour);
  }
  return '/' + parts.map((part) => encodeURIComponent(part).replace(/%3A/gi, ':')).join('/');
}

// Snapshot block path for a deep-linked date and hour, as listed in the dataset index.
export function blockPathForRoute(route: DeepLinkRoute): string | undefined {
  if (!route.date) return undefined;
  const hour = route.hour ?? '';
  if (!hour) return undefined;
  return `datasets/${route.flavor}/${route.date}/${hour}-00.json`;
}
