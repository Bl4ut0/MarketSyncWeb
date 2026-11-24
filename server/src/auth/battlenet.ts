import {
  FLAVORS,
  FLAVOR_IDS,
  normalizeFaction,
  type FactionPartition,
  type FlavorId,
  type LinkedCharacter,
} from '@marketsync/shared';

export const BNET_REGIONS = ['us', 'eu', 'kr', 'tw'] as const;
export type BnetRegion = (typeof BNET_REGIONS)[number];

export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface BnetOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  oauthBaseUrl?: string;
  apiBaseUrl?: string;
  sessionTtlMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BnetTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  sub?: string;
  scope?: string;
}

export interface BnetUserInfo {
  sub: string;
  id?: number | string;
  battletag: string;
}

interface RawWowCharacter {
  id?: number | string;
  name?: string;
  surname?: string;
  realm?: {
    slug?: string;
    name?: string;
  };
  faction?: {
    type?: string;
    name?: string;
  };
  playable_class?: {
    name?: string;
  };
  level?: number;
}

interface RawWowProfileResponse {
  wow_accounts?: Array<{
    id?: number;
    characters?: RawWowCharacter[];
  }>;
}

export function isBnetRegion(value: unknown): value is BnetRegion {
  return (
    typeof value === 'string' &&
    (BNET_REGIONS as readonly string[]).includes(value)
  );
}

export function normalizeRegion(raw?: string | null): BnetRegion {
  const lower = (raw ?? 'us').trim().toLowerCase();
  return isBnetRegion(lower) ? lower : 'us';
}

export function isOAuthConfigured(config: BnetOAuthConfig): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

export function generateRandomHex(byteCount = 32): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function getOAuthEndpoints(config: BnetOAuthConfig): {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
} {
  if (config.oauthBaseUrl) {
    const base = trimTrailingSlash(config.oauthBaseUrl);
    return {
      authorizeUrl: `${base}/oauth/authorize`,
      tokenUrl: `${base}/oauth/token`,
      userinfoUrl: `${base}/oauth/userinfo`,
    };
  }
  return {
    authorizeUrl: 'https://oauth.battle.net/authorize',
    tokenUrl: 'https://oauth.battle.net/token',
    userinfoUrl: 'https://oauth.battle.net/userinfo',
  };
}

function getApiBaseUrl(config: BnetOAuthConfig, region: BnetRegion): string {
  if (config.apiBaseUrl) {
    return trimTrailingSlash(config.apiBaseUrl);
  }
  return `https://${region}.api.blizzard.com`;
}

export function buildAuthorizeUrl(
  config: BnetOAuthConfig,
  params: {
    state: string;
    redirectUri: string;
    scope?: string;
  },
): string {
  if (!config.clientId) {
    throw new Error('BNET_CLIENT_ID is not configured.');
  }
  const { authorizeUrl } = getOAuthEndpoints(config);
  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('scope', params.scope ?? 'openid wow.profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

export async function exchangeCodeForToken(
  config: BnetOAuthConfig,
  params: {
    code: string;
    redirectUri: string;
  },
): Promise<BnetTokenResponse> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Battle.net OAuth credentials are not configured.');
  }
  const fetchFn = config.fetchImpl ?? fetch;
  const { tokenUrl } = getOAuthEndpoints(config);

  const basicAuth = btoa(`${config.clientId}:${config.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Battle.net token exchange failed (HTTP ${res.status}): ${errText}`,
    );
  }

  const data = (await res.json()) as Partial<BnetTokenResponse>;
  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error('Battle.net token response missing access_token.');
  }

  return data as BnetTokenResponse;
}

export async function fetchBnetUserInfo(
  config: BnetOAuthConfig,
  accessToken: string,
): Promise<{ status: number; userInfo: BnetUserInfo | null }> {
  const fetchFn = config.fetchImpl ?? fetch;
  const { userinfoUrl } = getOAuthEndpoints(config);

  const res = await fetchFn(userinfoUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    return { status: res.status, userInfo: null };
  }

  const data = (await res.json()) as Partial<BnetUserInfo>;
  const sub =
    data.sub !== undefined
      ? String(data.sub)
      : data.id !== undefined
        ? String(data.id)
        : '';
  const battletag = typeof data.battletag === 'string' ? data.battletag : '';
  if (!sub || !battletag) {
    throw new Error('Battle.net userinfo response missing sub or battletag.');
  }

  return {
    status: res.status,
    userInfo: { sub, id: data.id, battletag },
  };
}

export function getProfileNamespacesForRegion(
  region: BnetRegion,
): Array<{ flavor: FlavorId; namespace: string }> {
  return FLAVOR_IDS.map((flavor) => ({
    flavor,
    namespace: `${FLAVORS[flavor].apiNamespaces.profilePrefix}-${region}`,
  }));
}

function parseWowCharacter(
  raw: RawWowCharacter,
  ctx: { userId: string; region: BnetRegion; flavor: FlavorId; namespace: string },
): LinkedCharacter | null {
  if (!raw.name || typeof raw.name !== 'string') {
    return null;
  }

  const realmSlug =
    typeof raw.realm?.slug === 'string' && raw.realm.slug.trim() !== ''
      ? raw.realm.slug.trim()
      : undefined;
  const surname =
    typeof raw.surname === 'string' && raw.surname.trim() !== ''
      ? raw.surname.trim()
      : undefined;

  const realmPart = realmSlug ? realmSlug.toLowerCase() : 'realmless';
  const charId =
    raw.id !== undefined
      ? String(raw.id)
      : `${realmPart}:${raw.name.trim().toLowerCase()}${surname ? `:${surname.toLowerCase()}` : ''}`;

  let faction: FactionPartition | undefined;
  const rawFaction = raw.faction?.name ?? raw.faction?.type;
  if (typeof rawFaction === 'string' && rawFaction.trim() !== '') {
    faction = normalizeFaction(rawFaction);
  }

  const character: LinkedCharacter = {
    id: `${ctx.userId}:${ctx.region}:${ctx.namespace}:${realmPart}:${charId}`,
    userId: ctx.userId,
    region: ctx.region,
    flavor: ctx.flavor,
    namespace: ctx.namespace,
    name: raw.name,
  };

  if (surname) {
    character.surname = surname;
  }
  if (realmSlug) {
    character.realmSlug = realmSlug;
  }
  if (faction) {
    character.faction = faction;
  }
  if (typeof raw.level === 'number' && Number.isFinite(raw.level)) {
    character.level = raw.level;
  }
  if (
    typeof raw.playable_class?.name === 'string' &&
    raw.playable_class.name.trim() !== ''
  ) {
    character.className = raw.playable_class.name.trim();
  }

  return character;
}

export async function fetchAllNamespaceCharacters(
  config: BnetOAuthConfig,
  params: {
    userId: string;
    region: BnetRegion;
    accessToken: string;
  },
): Promise<LinkedCharacter[]> {
  const fetchFn = config.fetchImpl ?? fetch;
  const apiBase = getApiBaseUrl(config, params.region);
  const targets = getProfileNamespacesForRegion(params.region);

  const results = await Promise.allSettled(
    targets.map(async ({ flavor, namespace }) => {
      const url = `${apiBase}/profile/user/wow?namespace=${encodeURIComponent(namespace)}`;
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Battlenet-Namespace': namespace,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        return [] as LinkedCharacter[];
      }
      const data = (await res.json()) as RawWowProfileResponse;
      const characters: LinkedCharacter[] = [];
      for (const account of data.wow_accounts ?? []) {
        for (const rawChar of account.characters ?? []) {
          const parsed = parseWowCharacter(rawChar, {
            userId: params.userId,
            region: params.region,
            flavor,
            namespace,
          });
          if (parsed) characters.push(parsed);
        }
      }
      return characters;
    }),
  );

  const collected: LinkedCharacter[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      collected.push(...r.value);
    }
  }
  return collected;
}
