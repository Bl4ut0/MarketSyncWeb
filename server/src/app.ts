import { Hono, type Context, type Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import {
  FLAVOR_IDS,
  MAX_COPPER,
  decodeShoppingList,
  encodeShoppingList,
  isFlavorId,
  normalizeFaction,
  normalizeItemKey,
  normalizePartitionKey,
  type AlertCondition,
  type ApiCapabilities,
  type ApiHealth,
  type FactionPartition,
  type FlavorId,
  type ShoppingList,
  type ShoppingListInput,
  type ShoppingListItemInput,
} from '@marketsync/shared';
import {
  DEFAULT_SESSION_TTL_MS,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchAllNamespaceCharacters,
  fetchBnetUserInfo,
  generateRandomHex,
  isOAuthConfigured,
  normalizeRegion,
  type BnetOAuthConfig,
  type BnetRegion,
} from './auth/battlenet.js';
import type { EmailAdapter } from './notifications/email.js';
import { evaluatePriceAlerts } from './notifications/evaluator.js';
import {
  DEFAULT_DATA_BASE_URL,
  InvalidSnapshotPathError,
  proxyDatasetIndex,
  proxyDatasetCatalog,
  proxySnapshotBlock,
  resolveItemsFromQuery,
  searchWowheadItems,
  type CfExecutionContext,
  type EdgeCache,
} from './proxy.js';
import {
  PersistenceUnavailableError,
  type StorageAdapter,
  type UserRecord,
} from './storage/types.js';

export const OAUTH_STATE_COOKIE = 'ms_oauth_state';
export const SESSION_COOKIE = 'ms_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export interface CreateAppOptions {
  mode: 'cloudflare' | 'selfhosted';
  version?: string;
  storage: StorageAdapter;
  emailAdapter: EmailAdapter;
  dataBaseUrl?: string;
  oauth?: BnetOAuthConfig;
  fetchImpl?: typeof fetch;
  edgeCache?: EdgeCache | null;
  executionCtx?: CfExecutionContext | null;
  evaluateSecret?: string;
  allowedOrigins?: string | readonly string[];
}

interface OAuthStatePayload {
  state: string;
  region: BnetRegion;
  redirect: string;
}

function parseAllowedOrigins(raw?: string | readonly string[]): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  const parts = typeof raw === 'string' ? raw.split(',') : raw;
  for (const part of parts) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (trimmed && trimmed !== '*') {
      out.add(trimmed);
    }
  }
  return out;
}

function sanitizeRedirectPath(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return '/';
  }
  return trimmed;
}

function isSecureRequest(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function encodeStateCookie(payload: OAuthStatePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeStateCookie(raw: string | undefined): OAuthStatePayload | null {
  if (!raw) return null;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<OAuthStatePayload>;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.region === 'string' &&
      typeof parsed.redirect === 'string'
    ) {
      return {
        state: parsed.state,
        region: normalizeRegion(parsed.region),
        redirect: sanitizeRedirectPath(parsed.redirect),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function formatPublicUser(user: UserRecord) {
  return {
    id: user.id,
    bnetId: user.bnetId,
    battletag: user.battletag,
    region: user.region,
    notificationEmail: user.notificationEmail,
    emailEnabled: user.emailEnabled,
    onSiteEnabled: user.onSiteEnabled,
  };
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const mode = options.mode;
  const version = options.version ?? '0.1.0';
  const storage = options.storage;
  const emailAdapter = options.emailAdapter;
  const dataBaseUrl = options.dataBaseUrl ?? DEFAULT_DATA_BASE_URL;
  const oauthConfig: BnetOAuthConfig = {
    ...(options.oauth ?? {}),
    fetchImpl: options.oauth?.fetchImpl ?? options.fetchImpl,
  };

  app.onError((err, c) => {
    if (err instanceof PersistenceUnavailableError) {
      return c.json({ error: err.code, message: err.message }, 501);
    }
    if (err instanceof InvalidSnapshotPathError) {
      return c.json({ error: err.code, message: err.message }, 400);
    }
    const message =
      err instanceof Error ? err.message : 'Unexpected server error';
    return c.json({ error: 'internal_error', message }, 500);
  });

  const configuredOrigins = parseAllowedOrigins(options.allowedOrigins);
  function isAllowedOrigin(origin: string, c: Context): boolean {
    if (!origin) return false;
    const normalized = origin.trim().replace(/\/+$/, '');
    if (configuredOrigins.size > 0) {
      if (configuredOrigins.has(normalized)) return true;
    } else if (DEFAULT_DEV_ORIGINS.has(normalized)) {
      return true;
    }
    try {
      const reqOrigin = new URL(c.req.url).origin;
      if (normalized === reqOrigin) return true;
    } catch {
      // Ignore malformed request URL
    }
    return false;
  }

  const corsHandler = cors({
    origin: (origin, c) => (isAllowedOrigin(origin, c) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-MarketSync-Evaluate-Key'],
  });

  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (!origin) {
      return next();
    }
    if (!isAllowedOrigin(origin, c)) {
      c.header('Vary', 'Origin', { append: true });
      if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
      }
      return next();
    }
    return corsHandler(c, next);
  });

  // -------------------------------------------------------------------------
  // Public Health, Capabilities & Dataset Proxy Routes
  // -------------------------------------------------------------------------

  app.get('/api/health', (c) => {
    const body: ApiHealth = {
      ok: true,
      mode,
      version,
    };
    return c.json(body, 200);
  });

  app.get('/api/capabilities', (c) => {
    const body: ApiCapabilities = {
      mode,
      persistence: storage.supportsPersistence,
      oauth: storage.supportsPersistence && isOAuthConfigured(oauthConfig),
      email: emailAdapter.configured,
      flavors: [...FLAVOR_IDS],
    };
    return c.json(body, 200);
  });

  app.get('/api/datasets/index.json', (c) => {
    return proxyDatasetIndex({
      dataBaseUrl,
      fetchImpl: options.fetchImpl,
      edgeCache: options.edgeCache,
      executionCtx: options.executionCtx,
      requestUrl: c.req.url,
    });
  });

  app.get('/api/datasets/catalog', (c) => {
    const flavor = c.req.query('flavor');
    if (!isFlavorId(flavor)) return c.json({ error: 'invalid_flavor' }, 400);
    return proxyDatasetCatalog(flavor, {
      dataBaseUrl,
      fetchImpl: options.fetchImpl,
      edgeCache: options.edgeCache,
      executionCtx: options.executionCtx,
      requestUrl: c.req.url,
    });
  });

  app.get('/api/datasets/snapshot', (c) => {
    const rawPath = c.req.query('path');
    return proxySnapshotBlock(rawPath, {
      dataBaseUrl,
      fetchImpl: options.fetchImpl,
      edgeCache: options.edgeCache,
      executionCtx: options.executionCtx,
      requestUrl: c.req.url,
    });
  });

  app.get('/api/items/search', async (c) => {
    const name = c.req.query('q')?.trim() ?? '';
    const flavor = c.req.query('flavor');
    if (!isFlavorId(flavor) || name.length < 2 || name.length > 100) {
      return c.json({ error: 'invalid_item_search' }, 400);
    }
    try {
      const items = await searchWowheadItems(name, flavor, options.fetchImpl);
      c.header('Cache-Control', 'public, max-age=300');
      return c.json({ items });
    } catch {
      return c.json({ error: 'item_search_unavailable' }, 502);
    }
  });

  app.get('/api/items', (c) => {
    try {
      const ids = c.req.queries('ids');
      const resolved = resolveItemsFromQuery(ids);
      return c.json(resolved, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid item query parameter.';
      return c.json({ error: 'invalid_item_key', message }, 400);
    }
  });

  // -------------------------------------------------------------------------
  // Persistence Guard for Protected Endpoints (501 in Zero-DB CF Worker)
  // -------------------------------------------------------------------------

  async function requirePersistence(c: Context, next: Next) {
    if (!storage.supportsPersistence) {
      return c.json(
        {
          error: 'persistence_unavailable',
          message:
            'Persistent storage and Battle.net user sessions are not available in zero-database Cloudflare Worker mode.',
        },
        501,
      );
    }
    return next();
  }

  app.use('/api/auth/*', requirePersistence);
  app.use('/api/settings/*', requirePersistence);
  app.use('/api/lists', requirePersistence);
  app.use('/api/lists/*', requirePersistence);
  app.use('/api/alerts', requirePersistence);
  app.use('/api/alerts/*', requirePersistence);
  app.use('/api/notifications', requirePersistence);
  app.use('/api/notifications/*', requirePersistence);

  // -------------------------------------------------------------------------
  // Session Resolution Helper
  // -------------------------------------------------------------------------

  async function resolveAuthenticatedUser(
    c: Context,
    verifyUpstream = Boolean(oauthConfig.oauthBaseUrl),
  ): Promise<UserRecord | null> {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) return null;

    const session = await storage.getSession(sessionId);
    if (!session) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      await storage.deleteSession(session.id);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return null;
    }

    if (verifyUpstream && oauthConfig.oauthBaseUrl) {
      try {
        const check = await fetchBnetUserInfo(oauthConfig, session.accessToken);
        if (check.status === 401 || check.status === 403) {
          await storage.deleteSession(session.id);
          deleteCookie(c, SESSION_COOKIE, { path: '/' });
          return null;
        }
      } catch {
        // Ignore transient network errors when checking mock/upstream
      }
    }

    const user = await storage.getUserById(session.userId);
    if (!user) {
      await storage.deleteSession(session.id);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return null;
    }
    return user;
  }

  async function requireAuthenticatedUser(
    c: Context,
  ): Promise<UserRecord | Response> {
    const user = await resolveAuthenticatedUser(c);
    if (!user) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'Authentication required. Please log in with Battle.net.',
        },
        401,
      );
    }
    return user;
  }

  // -------------------------------------------------------------------------
  // Battle.net OAuth 2.0 Routes
  // -------------------------------------------------------------------------

  app.get('/api/auth/login', (c) => {
    if (!isOAuthConfigured(oauthConfig)) {
      return c.json(
        {
          error: 'oauth_not_configured',
          message: 'Battle.net OAuth client credentials are not configured.',
        },
        501,
      );
    }

    const region = normalizeRegion(c.req.query('region'));
    const redirect = sanitizeRedirectPath(c.req.query('redirect'));
    const state = generateRandomHex(24);
    const redirectUri =
      oauthConfig.redirectUri ||
      `${new URL(c.req.url).origin}/api/auth/callback`;

    const cookieVal = encodeStateCookie({ state, region, redirect });
    setCookie(c, OAUTH_STATE_COOKIE, cookieVal, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
      secure: isSecureRequest(c),
    });

    const authorizeUrl = buildAuthorizeUrl(oauthConfig, {
      state,
      redirectUri,
    });
    return c.redirect(authorizeUrl, 302);
  });

  app.get('/api/auth/callback', async (c) => {
    if (!isOAuthConfigured(oauthConfig)) {
      return c.json(
        {
          error: 'oauth_not_configured',
          message: 'Battle.net OAuth client credentials are not configured.',
        },
        501,
      );
    }

    const stateCookie = decodeStateCookie(getCookie(c, OAUTH_STATE_COOKIE));
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

    const queryState = c.req.query('state');
    if (!stateCookie || !queryState || stateCookie.state !== queryState) {
      return c.json(
        {
          error: 'invalid_oauth_state',
          message: 'Missing or mismatched OAuth CSRF state parameter.',
        },
        400,
      );
    }

    const oauthError = c.req.query('error');
    if (oauthError) {
      return c.json(
        {
          error: oauthError,
          message:
            c.req.query('error_description') ||
            'Battle.net authorization was denied.',
        },
        400,
      );
    }

    const code = c.req.query('code');
    if (!code) {
      return c.json(
        {
          error: 'missing_code',
          message: 'Missing OAuth authorization code.',
        },
        400,
      );
    }

    const redirectUri =
      oauthConfig.redirectUri ||
      `${new URL(c.req.url).origin}/api/auth/callback`;

    let token;
    try {
      token = await exchangeCodeForToken(oauthConfig, { code, redirectUri });
    } catch (err) {
      return c.json(
        {
          error: 'oauth_token_exchange_failed',
          message: err instanceof Error ? err.message : 'Token exchange failed.',
        },
        401,
      );
    }

    const userInfoRes = await fetchBnetUserInfo(
      oauthConfig,
      token.access_token,
    );
    if (!userInfoRes.userInfo) {
      return c.json(
        {
          error: 'oauth_userinfo_failed',
          message: `Failed to fetch Battle.net userinfo (HTTP ${userInfoRes.status}).`,
        },
        401,
      );
    }

    const userId = `bnet:${userInfoRes.userInfo.sub}`;
    const user = await storage.upsertUser({
      id: userId,
      bnetId: userInfoRes.userInfo.sub,
      battletag: userInfoRes.userInfo.battletag,
      region: stateCookie.region,
    });

    const fetchedCharacters = await fetchAllNamespaceCharacters(oauthConfig, {
      userId: user.id,
      region: stateCookie.region,
      accessToken: token.access_token,
    });
    const characters = await storage.replaceUserCharacters(
      user.id,
      fetchedCharacters,
    );

    const maxTtl = oauthConfig.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    const tokenTtlMs =
      typeof token.expires_in === 'number' && token.expires_in > 0
        ? Math.min(token.expires_in * 1000, maxTtl)
        : maxTtl;
    const sessionId = generateRandomHex(32);
    await storage.createSession({
      id: sessionId,
      userId: user.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      region: stateCookie.region,
      expiresAt: Date.now() + tokenTtlMs,
      createdAt: new Date().toISOString(),
    });

    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.max(1, Math.floor(tokenTtlMs / 1000)),
      secure: isSecureRequest(c),
    });

    if (c.req.query('format') === 'json') {
      return c.json(
        {
          authenticated: true,
          user: formatPublicUser(user),
          characters,
        },
        200,
      );
    }

    return c.redirect(stateCookie.redirect || '/', 302);
  });

  app.post('/api/auth/logout', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      await storage.deleteSession(sessionId);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true, authenticated: false }, 200);
  });

  app.get('/api/auth/me', async (c) => {
    const user = await resolveAuthenticatedUser(c, true);
    if (!user) {
      return c.json({ authenticated: false }, 200);
    }
    const characters = await storage.listUserCharacters(user.id);
    return c.json(
      {
        authenticated: true,
        user: formatPublicUser(user),
        characters,
      },
      200,
    );
  });

  // -------------------------------------------------------------------------
  // Notification Settings
  // -------------------------------------------------------------------------

  app.put('/api/settings/notifications', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    let body: {
      notificationEmail?: string | null;
      email?: string | null;
      emailEnabled?: boolean;
      onSiteEnabled?: boolean;
      onsiteEnabled?: boolean;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
    }

    const rawEmail =
      body.notificationEmail !== undefined
        ? body.notificationEmail
        : body.email;

    let normalizedEmail = userOrRes.notificationEmail;
    if (rawEmail !== undefined) {
      if (rawEmail === null || (typeof rawEmail === 'string' && rawEmail.trim() === '')) {
        normalizedEmail = null;
      } else if (typeof rawEmail !== 'string') {
        return c.json(
          {
            error: 'invalid_email',
            message: 'Please provide a valid notification email address.',
          },
          400,
        );
      } else {
        const trimmed = rawEmail.trim();
        if (!EMAIL_RE.test(trimmed)) {
          return c.json(
            {
              error: 'invalid_email',
              message: 'Please provide a valid notification email address.',
            },
            400,
          );
        }
        normalizedEmail = trimmed;
      }
    }

    const emailEnabled =
      body.emailEnabled !== undefined
        ? Boolean(body.emailEnabled)
        : userOrRes.emailEnabled;
    const rawOnSite =
      body.onSiteEnabled !== undefined
        ? body.onSiteEnabled
        : body.onsiteEnabled;
    const onSiteEnabled =
      rawOnSite !== undefined ? Boolean(rawOnSite) : userOrRes.onSiteEnabled;

    if (emailEnabled && !normalizedEmail) {
      return c.json(
        {
          error: 'email_required',
          message: 'A valid notificationEmail is required when emailEnabled is true.',
        },
        400,
      );
    }

    const updated = await storage.updateNotificationSettings(userOrRes.id, {
      notificationEmail: normalizedEmail,
      emailEnabled,
      onSiteEnabled,
    });

    return c.json(
      {
        ok: true,
        settings: {
          notificationEmail: updated?.notificationEmail ?? null,
          email: updated?.notificationEmail ?? null,
          emailEnabled: updated?.emailEnabled ?? false,
          onSiteEnabled: updated?.onSiteEnabled ?? true,
          onsiteEnabled: updated?.onSiteEnabled ?? true,
        },
      },
      200,
    );
  });

  // -------------------------------------------------------------------------
  // Authenticated Synced Shopping Lists & Ownership Helpers
  // -------------------------------------------------------------------------

  async function validateOwnedCharacterId(
    c: Context,
    userId: string,
    raw: unknown,
  ): Promise<
    | { ok: true; value: string | null | undefined }
    | { ok: false; response: Response }
  > {
    if (raw === undefined) return { ok: true, value: undefined };
    if (raw === null) return { ok: true, value: null };
    if (typeof raw !== 'string') {
      return {
        ok: false,
        response: c.json(
          { error: 'invalid_character', message: 'characterId must be a string.' },
          400,
        ),
      };
    }
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: true, value: null };
    const characters = await storage.listUserCharacters(userId);
    if (!characters.some((ch) => ch.id === trimmed)) {
      return {
        ok: false,
        response: c.json(
          {
            error: 'forbidden_character',
            message: 'characterId does not belong to the authenticated user.',
          },
          403,
        ),
      };
    }
    return { ok: true, value: trimmed };
  }

  async function validateOwnedListId(
    c: Context,
    userId: string,
    raw: unknown,
  ): Promise<
    | { ok: true; value: string | null | undefined }
    | { ok: false; response: Response }
  > {
    if (raw === undefined) return { ok: true, value: undefined };
    if (raw === null) return { ok: true, value: null };
    if (typeof raw !== 'string') {
      return {
        ok: false,
        response: c.json(
          { error: 'invalid_list', message: 'listId must be a string.' },
          400,
        ),
      };
    }
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: true, value: null };
    const lists = await storage.listUserLists(userId);
    if (!lists.some((list) => list.id === trimmed)) {
      return {
        ok: false,
        response: c.json(
          {
            error: 'forbidden_list',
            message: 'listId does not belong to the authenticated user.',
          },
          403,
        ),
      };
    }
    return { ok: true, value: trimmed };
  }

  app.get('/api/lists', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const lists = await storage.listUserLists(userOrRes.id);
    return c.json({ lists }, 200);
  });

  app.post('/api/lists', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    let body: {
      ms1String?: string;
      list?: ShoppingListInput;
      characterId?: unknown;
      name?: unknown;
      flavor?: unknown;
      ruleset?: unknown;
      partitionKey?: unknown;
      market?: unknown;
      faction?: unknown;
      items?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
    }

    let ms1String: string;
    let parsedList: ShoppingList;

    try {
      if (typeof body.ms1String === 'string' && body.ms1String.trim() !== '') {
        parsedList = decodeShoppingList(body.ms1String);
        ms1String = body.ms1String.trim();
      } else if (body.list && typeof body.list === 'object') {
        ms1String = encodeShoppingList(body.list);
        parsedList = decodeShoppingList(ms1String);
      } else if (
        typeof body.name === 'string' &&
        body.name.trim() !== '' &&
        Array.isArray(body.items)
      ) {
        const mappedItems: ShoppingListItemInput[] = body.items.map((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('Each item must be an object.');
          }
          const item = raw as Record<string, unknown>;
          const idVal = Number(item.itemId ?? item.id);
          const suffixVal = item.suffix ?? item.s;
          const qtyVal = item.qty ?? item.q;
          const maxPriceVal = item.maxPrice ?? item.m;
          const nameVal = item.name ?? item.nm;
          const noteVal = item.note ?? item.nt;
          const doneVal = item.done ?? item.d;
          const alertVal = item.alert ?? item.a;
          return {
            id: idVal,
            ...(suffixVal !== undefined && suffixVal !== null
              ? { s: Number(suffixVal) }
              : {}),
            q: qtyVal !== undefined && qtyVal !== null ? Number(qtyVal) : 1,
            ...(maxPriceVal !== undefined && maxPriceVal !== null
              ? { m: Number(maxPriceVal) }
              : {}),
            ...(typeof nameVal === 'string' ? { nm: nameVal } : {}),
            ...(typeof noteVal === 'string' ? { nt: noteVal } : {}),
            ...(doneVal !== undefined && doneVal !== null
              ? { d: doneVal as 0 | 1 | boolean }
              : {}),
            ...(alertVal !== undefined && alertVal !== null
              ? { a: alertVal as 0 | 1 | boolean }
              : {}),
          };
        });

        const rawFlavor =
          typeof body.flavor === 'string' && body.flavor.trim() !== ''
            ? body.flavor.trim()
            : undefined;
        const rawPartition =
          typeof body.ruleset === 'string' && body.ruleset.trim() !== ''
            ? body.ruleset.trim()
            : typeof body.partitionKey === 'string' &&
                body.partitionKey.trim() !== ''
              ? body.partitionKey.trim()
              : undefined;
        const rawMarket =
          typeof body.market === 'string' && body.market.trim() !== ''
            ? body.market.trim()
            : typeof body.faction === 'string' && body.faction.trim() !== ''
              ? body.faction.trim()
              : undefined;

        const normalizedInput: ShoppingListInput = {
          v: 1,
          n: body.name.trim(),
          ...(rawFlavor ? { f: rawFlavor } : {}),
          ...(rawPartition ? { r: rawPartition } : {}),
          ...(rawMarket ? { fa: normalizeFaction(rawMarket) as FactionPartition } : {}),
          i: mappedItems,
        };
        ms1String = encodeShoppingList(normalizedInput);
        parsedList = decodeShoppingList(ms1String);
      } else {
        return c.json(
          {
            error: 'invalid_list_payload',
            message:
              'Request body must include a valid "ms1String", "list" object, or flat { name, items } payload.',
          },
          400,
        );
      }
    } catch (err) {
      return c.json(
        {
          error: 'invalid_ms1',
          message:
            err instanceof Error ? err.message : 'Invalid shopping list payload.',
        },
        400,
      );
    }

    const charCheck = await validateOwnedCharacterId(
      c,
      userOrRes.id,
      body.characterId,
    );
    if (!charCheck.ok) return charCheck.response;

    const created = await storage.createUserList({
      userId: userOrRes.id,
      name: parsedList.n,
      flavor: parsedList.f,
      partitionKey: parsedList.r,
      faction: parsedList.fa,
      characterId: charCheck.value ?? undefined,
      ms1String,
      list: parsedList,
    });

    return c.json({ list: created }, 201);
  });

  app.delete('/api/lists/:id', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const deleted = await storage.deleteUserList(userOrRes.id, c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found', message: 'Synced list not found.' }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // -------------------------------------------------------------------------
  // Alert Rules CRUD
  // -------------------------------------------------------------------------

  app.get('/api/alerts', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const alerts = await storage.listUserAlerts(userOrRes.id);
    return c.json({ alerts }, 200);
  });

  app.post('/api/alerts', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    let body: {
      flavor?: unknown;
      partitionKey?: unknown;
      ruleset?: unknown;
      faction?: unknown;
      market?: unknown;
      itemKey?: unknown;
      condition?: unknown;
      maxPriceCopper?: unknown;
      thresholdCopper?: unknown;
      characterId?: unknown;
      listId?: unknown;
      enabled?: unknown;
      notifyOnsite?: unknown;
      emailEnabled?: unknown;
      notifyEmail?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
    }

    if (!isFlavorId(body.flavor)) {
      return c.json(
        { error: 'invalid_flavor', message: `Unsupported flavor: ${String(body.flavor)}` },
        400,
      );
    }

    const rawPartition =
      body.partitionKey !== undefined ? body.partitionKey : body.ruleset;
    if (typeof rawPartition !== 'string' || rawPartition.trim() === '') {
      return c.json(
        { error: 'invalid_partition', message: 'partitionKey must be a non-empty string.' },
        400,
      );
    }

    const rawFaction = body.faction !== undefined ? body.faction : body.market;
    if (typeof rawFaction !== 'string' || rawFaction.trim() === '') {
      return c.json(
        { error: 'invalid_faction', message: 'faction must be a non-empty string.' },
        400,
      );
    }

    const rawPrice =
      body.maxPriceCopper !== undefined
        ? body.maxPriceCopper
        : body.thresholdCopper;
    if (
      typeof rawPrice !== 'number' ||
      !Number.isSafeInteger(rawPrice) ||
      rawPrice < 0 ||
      rawPrice > MAX_COPPER
    ) {
      return c.json(
        {
          error: 'invalid_price',
          message: `maxPriceCopper must be an integer between 0 and ${MAX_COPPER}.`,
        },
        400,
      );
    }

    let condition: AlertCondition = 'below';
    if (body.condition !== undefined) {
      if (body.condition !== 'below' && body.condition !== 'above') {
        return c.json(
          {
            error: 'invalid_condition',
            message: 'condition must be "below" or "above".',
          },
          400,
        );
      }
      condition = body.condition;
    }

    let normalizedItemKey: string;
    try {
      if (typeof body.itemKey !== 'string' && typeof body.itemKey !== 'number') {
        throw new Error('itemKey is required.');
      }
      normalizedItemKey = normalizeItemKey(body.itemKey).canonicalKey;
    } catch (err) {
      return c.json(
        {
          error: 'invalid_item_key',
          message: err instanceof Error ? err.message : 'Invalid itemKey.',
        },
        400,
      );
    }

    const partitionKey = normalizePartitionKey(
      body.flavor,
      rawPartition,
    ).key;
    const faction = normalizeFaction(rawFaction);

    const charCheck = await validateOwnedCharacterId(
      c,
      userOrRes.id,
      body.characterId,
    );
    if (!charCheck.ok) return charCheck.response;

    const listCheck = await validateOwnedListId(c, userOrRes.id, body.listId);
    if (!listCheck.ok) return listCheck.response;

    const rawEmailEnabled =
      body.emailEnabled !== undefined ? body.emailEnabled : body.notifyEmail;

    const alert = await storage.createAlert(userOrRes.id, {
      flavor: body.flavor,
      partitionKey,
      faction,
      itemKey: normalizedItemKey,
      condition,
      maxPriceCopper: rawPrice,
      characterId: charCheck.value ?? undefined,
      listId: listCheck.value ?? undefined,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      notifyOnsite:
        body.notifyOnsite !== undefined ? Boolean(body.notifyOnsite) : true,
      emailEnabled:
        rawEmailEnabled !== undefined ? Boolean(rawEmailEnabled) : true,
    });

    return c.json({ alert }, 201);
  });

  app.patch('/api/alerts/:id', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const existing = await storage.getAlertById(userOrRes.id, c.req.param('id'));
    if (!existing) {
      return c.json({ error: 'not_found', message: 'Alert rule not found.' }, 404);
    }

    let body: {
      partitionKey?: unknown;
      ruleset?: unknown;
      faction?: unknown;
      market?: unknown;
      condition?: unknown;
      maxPriceCopper?: unknown;
      thresholdCopper?: unknown;
      characterId?: unknown;
      listId?: unknown;
      enabled?: unknown;
      notifyOnsite?: unknown;
      emailEnabled?: unknown;
      notifyEmail?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
    }

    const rawPrice =
      body.maxPriceCopper !== undefined
        ? body.maxPriceCopper
        : body.thresholdCopper;
    if (
      rawPrice !== undefined &&
      (typeof rawPrice !== 'number' ||
        !Number.isSafeInteger(rawPrice) ||
        rawPrice < 0 ||
        rawPrice > MAX_COPPER)
    ) {
      return c.json(
        {
          error: 'invalid_price',
          message: `maxPriceCopper must be an integer between 0 and ${MAX_COPPER}.`,
        },
        400,
      );
    }

    let conditionPatch: AlertCondition | undefined;
    if (body.condition !== undefined) {
      if (body.condition !== 'below' && body.condition !== 'above') {
        return c.json(
          {
            error: 'invalid_condition',
            message: 'condition must be "below" or "above".',
          },
          400,
        );
      }
      conditionPatch = body.condition;
    }

    const charCheck = await validateOwnedCharacterId(
      c,
      userOrRes.id,
      body.characterId,
    );
    if (!charCheck.ok) return charCheck.response;

    const listCheck = await validateOwnedListId(c, userOrRes.id, body.listId);
    if (!listCheck.ok) return listCheck.response;

    const rawPartition =
      body.partitionKey !== undefined ? body.partitionKey : body.ruleset;
    const rawFaction = body.faction !== undefined ? body.faction : body.market;
    const rawEmailEnabled =
      body.emailEnabled !== undefined ? body.emailEnabled : body.notifyEmail;

    const updated = await storage.updateAlert(userOrRes.id, existing.id, {
      ...(typeof rawPartition === 'string' && rawPartition.trim() !== ''
        ? {
            partitionKey: normalizePartitionKey(
              existing.flavor,
              rawPartition,
            ).key,
          }
        : {}),
      ...(typeof rawFaction === 'string' && rawFaction.trim() !== ''
        ? { faction: normalizeFaction(rawFaction) }
        : {}),
      ...(conditionPatch !== undefined ? { condition: conditionPatch } : {}),
      ...(typeof rawPrice === 'number'
        ? { maxPriceCopper: rawPrice }
        : {}),
      ...(charCheck.value !== undefined ? { characterId: charCheck.value } : {}),
      ...(listCheck.value !== undefined ? { listId: listCheck.value } : {}),
      ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      ...(body.notifyOnsite !== undefined
        ? { notifyOnsite: Boolean(body.notifyOnsite) }
        : {}),
      ...(rawEmailEnabled !== undefined
        ? { emailEnabled: Boolean(rawEmailEnabled) }
        : {}),
    });

    return c.json({ alert: updated }, 200);
  });

  app.delete('/api/alerts/:id', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const deleted = await storage.deleteAlert(userOrRes.id, c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found', message: 'Alert rule not found.' }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // -------------------------------------------------------------------------
  // Notifications & Evaluator Trigger
  // -------------------------------------------------------------------------

  app.get('/api/notifications', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const unreadParam = c.req.query('unreadOnly');
    const unreadOnly = unreadParam === '1' || unreadParam === 'true';
    const rawLimit = c.req.query('limit');
    let limit: number | undefined;
    if (rawLimit !== undefined && rawLimit.trim() !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        return c.json(
          {
            error: 'invalid_limit',
            message: 'limit must be a positive integer.',
          },
          400,
        );
      }
      limit = Math.min(parsed, 500);
    }

    const notifications = await storage.listUserNotifications(userOrRes.id, {
      unreadOnly,
      limit,
    });
    return c.json({ notifications }, 200);
  });

  app.post('/api/notifications/:id/read', async (c) => {
    const userOrRes = await requireAuthenticatedUser(c);
    if (userOrRes instanceof Response) return userOrRes;

    const notification = await storage.markNotificationRead(
      userOrRes.id,
      c.req.param('id'),
    );
    if (!notification) {
      return c.json(
        { error: 'not_found', message: 'Notification not found.' },
        404,
      );
    }
    return c.json({ notification }, 200);
  });

  app.post('/api/notifications/evaluate', async (c) => {
    const evalHeader = c.req.header('x-marketsync-evaluate-key');
    const isAdminTrigger = Boolean(
      options.evaluateSecret &&
        evalHeader &&
        evalHeader === options.evaluateSecret,
    );

    let scopedUserId: string | undefined;
    if (!isAdminTrigger) {
      const userOrRes = await requireAuthenticatedUser(c);
      if (userOrRes instanceof Response) return userOrRes;
      scopedUserId = userOrRes.id;
    }

    let body: { flavor?: unknown; snapshotPath?: unknown } = {};
    try {
      const rawText = await c.req.text();
      if (rawText.trim() !== '') {
        body = JSON.parse(rawText) as {
          flavor?: unknown;
          snapshotPath?: unknown;
        };
      }
    } catch {
      return c.json({ error: 'invalid_json', message: 'Invalid JSON body.' }, 400);
    }

    let flavor: FlavorId | undefined;
    if (body.flavor !== undefined) {
      if (!isFlavorId(body.flavor)) {
        return c.json(
          { error: 'invalid_flavor', message: `Unsupported flavor: ${String(body.flavor)}` },
          400,
        );
      }
      flavor = body.flavor;
    }

    const snapshotPath =
      typeof body.snapshotPath === 'string' && body.snapshotPath.trim() !== ''
        ? body.snapshotPath.trim()
        : undefined;

    const result = await evaluatePriceAlerts({
      storage,
      emailAdapter,
      dataBaseUrl,
      fetchImpl: options.fetchImpl,
      flavor,
      snapshotPath,
      userId: scopedUserId,
    });

    return c.json({ ok: true, ...result }, 200);
  });

  app.all('/api', (c) =>
    c.json(
      {
        error: 'not_found',
        message: `Unknown API route: ${c.req.path}`,
      },
      404,
    ),
  );

  app.all('/api/*', (c) =>
    c.json(
      {
        error: 'not_found',
        message: `Unknown API route: ${c.req.path}`,
      },
      404,
    ),
  );

  return app;
}
