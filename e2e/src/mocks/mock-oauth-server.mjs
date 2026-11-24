import crypto from 'node:crypto';
import http from 'node:http';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function buildProfiles(baseUrl) {
  return {
    'profile-us': (user) => ({
      _links: {
        self: { href: `${baseUrl}/profile/user/wow?namespace=profile-us` },
        user: { href: `${baseUrl}/oauth/userinfo` },
        profile: { href: `${baseUrl}/profile/user/wow?namespace=profile-us` },
      },
      id: user.id,
      wow_accounts: [
        {
          id: 910001,
          characters: [
            {
              character: { href: `${baseUrl}/profile/wow/character/tichondrius/aelindor?namespace=profile-us` },
              protected_character: { href: `${baseUrl}/profile/user/wow/protected-character/11-1001?namespace=profile-us` },
              name: 'Aelindor',
              id: 1001,
              realm: {
                key: { href: `${baseUrl}/data/wow/realm/11?namespace=dynamic-us` },
                name: 'Tichondrius',
                id: 11,
                slug: 'tichondrius',
              },
              playable_class: { key: { href: '#' }, name: 'Mage', id: 8 },
              playable_race: { key: { href: '#' }, name: 'Human', id: 1 },
              gender: { type: 'MALE', name: 'Male' },
              faction: { type: 'ALLIANCE', name: 'Alliance' },
              level: 80,
            },
          ],
        },
      ],
      collections: { href: `${baseUrl}/profile/user/wow/collections?namespace=profile-us` },
    }),

    'profile-classic-us': (user) => ({
      _links: {
        self: { href: `${baseUrl}/profile/user/wow?namespace=profile-classic-us` },
        user: { href: `${baseUrl}/oauth/userinfo` },
        profile: { href: `${baseUrl}/profile/user/wow?namespace=profile-classic-us` },
      },
      id: user.id,
      wow_accounts: [
        {
          id: 910002,
          characters: [
            {
              character: { href: `${baseUrl}/profile/wow/character/pagle/thalorin?namespace=profile-classic-us` },
              protected_character: { href: `${baseUrl}/profile/user/wow/protected-character/4385-2001?namespace=profile-classic-us` },
              name: 'Thalorin',
              id: 2001,
              realm: {
                key: { href: `${baseUrl}/data/wow/realm/4385?namespace=dynamic-classic-us` },
                name: 'Pagle',
                id: 4385,
                slug: 'pagle',
              },
              playable_class: { key: { href: '#' }, name: 'Paladin', id: 2 },
              playable_race: { key: { href: '#' }, name: 'Human', id: 1 },
              gender: { type: 'MALE', name: 'Male' },
              faction: { type: 'ALLIANCE', name: 'Alliance' },
              level: 90,
            },
          ],
        },
      ],
    }),

    'profile-classic1x-us': (user) => ({
      _links: {
        self: { href: `${baseUrl}/profile/user/wow?namespace=profile-classic1x-us` },
        user: { href: `${baseUrl}/oauth/userinfo` },
        profile: { href: `${baseUrl}/profile/user/wow?namespace=profile-classic1x-us` },
      },
      id: user.id,
      wow_accounts: [
        {
          id: 910003,
          characters: [
            {
              character: { href: `${baseUrl}/profile/wow/character/whitemane/kargath?namespace=profile-classic1x-us` },
              protected_character: { href: `${baseUrl}/profile/user/wow/protected-character/4395-3001?namespace=profile-classic1x-us` },
              name: 'Kargath',
              id: 3001,
              realm: {
                key: { href: `${baseUrl}/data/wow/realm/4395?namespace=dynamic-classic1x-us` },
                name: 'Whitemane',
                id: 4395,
                slug: 'whitemane',
              },
              playable_class: { key: { href: '#' }, name: 'Warrior', id: 1 },
              playable_race: { key: { href: '#' }, name: 'Orc', id: 2 },
              gender: { type: 'MALE', name: 'Male' },
              faction: { type: 'HORDE', name: 'Horde' },
              level: 60,
            },
          ],
        },
      ],
    }),

    'profile-classicann-us': (user) => ({
      _links: {
        self: { href: `${baseUrl}/profile/user/wow?namespace=profile-classicann-us` },
        user: { href: `${baseUrl}/oauth/userinfo` },
        profile: { href: `${baseUrl}/profile/user/wow?namespace=profile-classicann-us` },
      },
      id: user.id,
      wow_accounts: [
        {
          id: 910004,
          characters: [
            {
              character: { href: `${baseUrl}/profile/wow/character/dreamscythe/lyra?namespace=profile-classicann-us` },
              protected_character: { href: `${baseUrl}/profile/user/wow/protected-character/4901-4001?namespace=profile-classicann-us` },
              name: 'Lyra',
              id: 4001,
              realm: {
                key: { href: `${baseUrl}/data/wow/realm/4901?namespace=dynamic-classicann-us` },
                name: 'Dreamscythe',
                id: 4901,
                slug: 'dreamscythe',
              },
              playable_class: { key: { href: '#' }, name: 'Priest', id: 5 },
              playable_race: { key: { href: '#' }, name: 'Night Elf', id: 4 },
              gender: { type: 'FEMALE', name: 'Female' },
              faction: { type: 'ALLIANCE', name: 'Alliance' },
              level: 60,
            },
          ],
        },
      ],
    }),

    // Forever is realmless: characters have { name, surname } and NO realm property
    'profile-forever-us': (user) => ({
      _links: {
        self: { href: `${baseUrl}/profile/user/wow?namespace=profile-forever-us` },
        user: { href: `${baseUrl}/oauth/userinfo` },
        profile: { href: `${baseUrl}/profile/user/wow?namespace=profile-forever-us` },
      },
      id: user.id,
      wow_accounts: [
        {
          id: 910005,
          characters: [
            {
              character: { href: `${baseUrl}/profile/wow/character/aelindor-dawnblade?namespace=profile-forever-us` },
              protected_character: { href: `${baseUrl}/profile/user/wow/protected-character/77-9001?namespace=profile-forever-us` },
              name: 'Aelindor',
              surname: 'Dawnblade',
              id: 9001,
              playable_class: { key: { href: '#' }, name: 'Mage', id: 8 },
              playable_race: { key: { href: '#' }, name: 'Human', id: 1 },
              gender: { type: 'MALE', name: 'Male' },
              faction: { type: 'ALLIANCE', name: 'Alliance' },
              level: 60,
            },
          ],
        },
      ],
    }),
  };
}

export async function startMockOAuthServer(options = {}) {
  const initialState = () => ({
    tokenTtlSeconds: options.tokenTtlSeconds ?? 86400, // 24 hours
    forceExpired: Boolean(options.forceExpired),
    denyNextAuth: Boolean(options.denyNextAuth),
    strictClientAuth: Boolean(options.strictClientAuth),
    expectedClientId: options.clientId || 'test-client-id',
    expectedClientSecret: options.clientSecret || 'test-client-secret',
    user: {
      sub: '12345678',
      id: 12345678,
      battletag: 'MarketTester#1337',
      ...(options.user || {}),
    },
  });

  let state = initialState();
  const authCodes = new Map(); // code -> { state, redirectUri, scope, clientId, used, createdAt }
  const tokens = new Map(); // accessToken -> { sub, issuedAt, expiresAt, scope }
  let url = '';

  function validateBearer(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return { ok: false, status: 401, body: { error: 'invalid_token', error_description: 'Missing Bearer token' } };
    }
    const token = auth.slice(7).trim();
    const record = tokens.get(token);
    if (!record) {
      return { ok: false, status: 401, body: { error: 'invalid_token', error_description: 'Unknown access token' } };
    }
    if (state.forceExpired || Date.now() >= record.expiresAt) {
      return { ok: false, status: 401, body: { error: 'invalid_token', error_description: 'Access token expired' } };
    }
    return { ok: true, record };
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      return res.end();
    }

    // Control routes
    if (pathname === '/__control/expire-tokens' && req.method === 'POST') {
      for (const rec of tokens.values()) {
        rec.expiresAt = Date.now() - 1000;
      }
      state.forceExpired = true;
      return sendJson(res, 200, { ok: true, expiredCount: tokens.size });
    }

    if (pathname === '/__control/set-state' && req.method === 'POST') {
      try {
        const raw = await readRawBody(req);
        const patch = raw ? JSON.parse(raw) : {};
        state = {
          ...state,
          ...patch,
          user: { ...state.user, ...(patch.user || {}) },
        };
        return sendJson(res, 200, { ok: true, state });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === '/__control/reset' && req.method === 'POST') {
      state = initialState();
      authCodes.clear();
      tokens.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/__control/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        ...state,
        activeCodes: authCodes.size,
        activeTokens: tokens.size,
      });
    }

    // 1. Authorization endpoint
    if ((pathname === '/oauth/authorize' || pathname === '/authorize') && req.method === 'GET') {
      const responseType = reqUrl.searchParams.get('response_type');
      const redirectUri = reqUrl.searchParams.get('redirect_uri');
      const oauthState = reqUrl.searchParams.get('state');
      const clientId = reqUrl.searchParams.get('client_id') || '';
      const scope = reqUrl.searchParams.get('scope') || 'openid wow.profile';

      if (responseType !== 'code') {
        return sendJson(res, 400, { error: 'unsupported_response_type', error_description: 'response_type must be code' });
      }
      if (!redirectUri) {
        return sendJson(res, 400, { error: 'invalid_request', error_description: 'Missing redirect_uri' });
      }
      if (!oauthState || oauthState.trim().length === 0) {
        return sendJson(res, 400, { error: 'invalid_request', error_description: 'Missing CSRF state parameter' });
      }

      let target;
      try {
        target = new URL(redirectUri);
      } catch {
        return sendJson(res, 400, { error: 'invalid_request', error_description: 'Invalid redirect_uri' });
      }

      if (reqUrl.searchParams.get('deny') === '1' || state.denyNextAuth) {
        state.denyNextAuth = false;
        target.searchParams.set('error', 'access_denied');
        target.searchParams.set('state', oauthState);
        res.writeHead(302, { Location: target.toString() });
        return res.end();
      }

      const code = crypto.randomBytes(16).toString('hex');
      authCodes.set(code, {
        state: oauthState,
        redirectUri,
        scope,
        clientId,
        used: false,
        createdAt: Date.now(),
      });

      target.searchParams.set('code', code);
      target.searchParams.set('state', oauthState);
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }

    // 2. Token exchange endpoint
    if ((pathname === '/oauth/token' || pathname === '/token') && req.method === 'POST') {
      const raw = await readRawBody(req);
      let params;
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(raw || '{}');
          params = new URLSearchParams(parsed);
        } catch {
          return sendJson(res, 400, { error: 'invalid_request' });
        }
      } else {
        params = new URLSearchParams(raw);
      }

      if (state.strictClientAuth) {
        const auth = req.headers.authorization || '';
        let cid = params.get('client_id');
        let csec = params.get('client_secret');
        if (auth.startsWith('Basic ')) {
          const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
          const idx = decoded.indexOf(':');
          if (idx >= 0) {
            cid = decoded.slice(0, idx);
            csec = decoded.slice(idx + 1);
          }
        }
        if (cid !== state.expectedClientId || csec !== state.expectedClientSecret) {
          return sendJson(res, 401, { error: 'invalid_client' });
        }
      }

      const grantType = params.get('grant_type');
      const code = params.get('code');
      const redirectUri = params.get('redirect_uri');

      if (grantType !== 'authorization_code') {
        return sendJson(res, 400, { error: 'unsupported_grant_type' });
      }
      if (!code || !authCodes.has(code)) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Unknown authorization code' });
      }

      const codeEntry = authCodes.get(code);
      if (codeEntry.used) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Authorization code already consumed' });
      }
      if (redirectUri && redirectUri !== codeEntry.redirectUri) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }

      codeEntry.used = true;
      const accessToken = `bnet_mock_${crypto.randomBytes(16).toString('hex')}`;
      const now = Date.now();
      const ttlMs = state.tokenTtlSeconds * 1000;
      tokens.set(accessToken, {
        sub: state.user.sub,
        issuedAt: now,
        expiresAt: now + ttlMs,
        scope: codeEntry.scope,
      });

      return sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: state.tokenTtlSeconds,
        sub: state.user.sub,
        scope: codeEntry.scope,
      });
    }

    // 3. Userinfo endpoint
    if ((pathname === '/oauth/userinfo' || pathname === '/userinfo') && req.method === 'GET') {
      const check = validateBearer(req);
      if (!check.ok) return sendJson(res, check.status, check.body);
      return sendJson(res, 200, {
        sub: state.user.sub,
        id: state.user.id,
        battletag: state.user.battletag,
      });
    }

    // 4. WoW Account Profile endpoint across 5 namespaces
    if (pathname === '/profile/user/wow' && req.method === 'GET') {
      const check = validateBearer(req);
      if (!check.ok) return sendJson(res, check.status, check.body);

      const namespace =
        reqUrl.searchParams.get('namespace') ||
        req.headers['battlenet-namespace'] ||
        'profile-us';

      const profiles = buildProfiles(url);
      // Allow profile-eu to map to profile-us shape if queried
      const resolvedNs = namespace === 'profile-eu' ? 'profile-us' : namespace;
      if (!Object.prototype.hasOwnProperty.call(profiles, resolvedNs)) {
        return sendJson(res, 404, {
          code: 404,
          type: 'NOT_FOUND',
          detail: `Invalid namespace: ${namespace}`,
        });
      }

      return sendJson(res, 200, profiles[resolvedNs](state.user));
    }

    return sendJson(res, 404, { error: 'not_found', path: pathname });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  url = `http://127.0.0.1:${addr.port}`;

  return {
    port: addr.port,
    url,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
    reset() {
      state = initialState();
      authCodes.clear();
      tokens.clear();
    },
    expireAllTokens() {
      for (const rec of tokens.values()) {
        rec.expiresAt = Date.now() - 1000;
      }
      state.forceExpired = true;
    },
    setState(patch) {
      state = {
        ...state,
        ...patch,
        user: { ...state.user, ...(patch.user || {}) },
      };
    },
    getState() {
      return { ...state, activeCodes: authCodes.size, activeTokens: tokens.size };
    },
  };
}
