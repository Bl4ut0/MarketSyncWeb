import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertAuthMeContract } from '../../e2e/src/contracts.mjs';
import {
  startMockOAuthServer,
  type MockOAuthServer,
} from '../../e2e/src/mocks/mock-oauth-server.mjs';
import { startNodeServer, type RunningNodeServer } from '../src/server.node.js';

function extractCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

describe('Battle.net OAuth Flow & Multi-Namespace Character Linking', () => {
  let mockOAuth: MockOAuthServer;
  let server: RunningNodeServer;

  beforeAll(async () => {
    mockOAuth = await startMockOAuthServer({
      strictClientAuth: true,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    server = await startNodeServer({
      port: 0,
      dbPath: ':memory:',
      oauth: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        oauthBaseUrl: mockOAuth.url,
        apiBaseUrl: mockOAuth.url,
      },
    });
  });

  afterAll(async () => {
    await server.close();
    await mockOAuth.close();
  });

  beforeEach(() => {
    mockOAuth.reset();
  });

  it('completes OAuth login, links all 5 flavor namespaces incl. realmless Forever, handles expiry and logout', async () => {
    // 1. Unauthenticated /api/auth/me
    const meBefore = await fetch(`${server.url}/api/auth/me`);
    expect(meBefore.status).toBe(200);
    const meBeforeJson = (await meBefore.json()) as { authenticated: boolean };
    assertAuthMeContract(meBeforeJson);
    expect(meBeforeJson.authenticated).toBe(false);

    // 2. Initiate login -> 302 to mock OAuth authorize + state cookie
    const loginRes = await fetch(`${server.url}/api/auth/login?region=us`, {
      redirect: 'manual',
    });
    expect(loginRes.status).toBe(302);
    const loginCookies = loginRes.headers.getSetCookie();
    const stateCookieHeader = extractCookieHeader(loginCookies);
    expect(stateCookieHeader).toContain('ms_oauth_state=');

    const authorizeLocation = loginRes.headers.get('location')!;
    const authorizeUrl = new URL(authorizeLocation);
    expect(authorizeUrl.searchParams.get('scope')).toBe('openid wow.profile');
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();

    // 3. Mock Battle.net authorize redirects back to callback with code & state
    const authRes = await fetch(authorizeLocation, { redirect: 'manual' });
    expect(authRes.status).toBe(302);
    const callbackLocation = authRes.headers.get('location')!;

    // 4. Reject tampered CSRF state on callback
    const tamperedUrl = new URL(callbackLocation);
    tamperedUrl.searchParams.set('state', 'tampered-state');
    const badCallback = await fetch(tamperedUrl.toString(), {
      headers: { Cookie: stateCookieHeader },
      redirect: 'manual',
    });
    expect(badCallback.status).toBe(400);

    // 5. Complete valid callback
    const callbackRes = await fetch(callbackLocation, {
      headers: { Cookie: stateCookieHeader },
      redirect: 'manual',
    });
    expect(callbackRes.status).toBe(302);
    const sessionCookies = callbackRes.headers.getSetCookie();
    const sessionCookieHeader = extractCookieHeader(
      sessionCookies.filter((c) => !c.includes('ms_oauth_state=;')),
    );
    expect(sessionCookieHeader).toContain('ms_session=');

    // 6. Verify /api/auth/me returns user + all 5 flavor characters
    const meAfter = await fetch(`${server.url}/api/auth/me`, {
      headers: { Cookie: sessionCookieHeader },
    });
    expect(meAfter.status).toBe(200);
    const meAfterJson = (await meAfter.json()) as {
      authenticated: boolean;
      user: { battletag: string };
      characters: Array<{
        flavor: string;
        name: string;
        surname?: string;
        realmSlug?: string;
      }>;
    };
    assertAuthMeContract(meAfterJson);
    expect(meAfterJson.authenticated).toBe(true);
    expect(meAfterJson.user.battletag).toBe('MarketTester#1337');
    expect(meAfterJson.characters).toHaveLength(5);

    const foreverChar = meAfterJson.characters.find((c) => c.flavor === 'forever');
    expect(foreverChar?.name).toBe('Aelindor');
    expect(foreverChar?.surname).toBe('Dawnblade');
    expect(foreverChar?.realmSlug).toBeUndefined();

    const anniChar = meAfterJson.characters.find((c) => c.flavor === 'anniversary');
    expect(anniChar?.realmSlug).toBe('dreamscythe');

    // 7. Token expiration invalidates /api/auth/me cleanly
    mockOAuth.expireAllTokens();
    const meExpired = await fetch(`${server.url}/api/auth/me`, {
      headers: { Cookie: sessionCookieHeader },
    });
    expect(meExpired.status).toBe(200);
    const meExpiredJson = (await meExpired.json()) as { authenticated: boolean };
    assertAuthMeContract(meExpiredJson);
    expect(meExpiredJson.authenticated).toBe(false);

    // 8. Logout returns ok and keeps unauthenticated
    const logoutRes = await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader },
    });
    expect(logoutRes.status).toBe(200);
  });

  it('supports sequential multi-user OAuth logins without characters.id collisions and sanitizes backslash redirects', async () => {
    async function loginUser(
      user: { sub: string; id: number; battletag: string },
      redirectParam?: string,
    ) {
      mockOAuth.setState({ forceExpired: false, user });
      const query = redirectParam
        ? `?region=us&redirect=${encodeURIComponent(redirectParam)}`
        : '?region=us';
      const loginRes = await fetch(`${server.url}/api/auth/login${query}`, {
        redirect: 'manual',
      });
      expect(loginRes.status).toBe(302);
      const stateCookieHeader = extractCookieHeader(loginRes.headers.getSetCookie());

      const authRes = await fetch(loginRes.headers.get('location')!, {
        redirect: 'manual',
      });
      expect(authRes.status).toBe(302);

      const cbRes = await fetch(authRes.headers.get('location')!, {
        headers: { Cookie: stateCookieHeader },
        redirect: 'manual',
      });
      expect(cbRes.status).toBe(302);
      const redirectLocation = cbRes.headers.get('location');
      const sessionCookie = extractCookieHeader(
        cbRes.headers
          .getSetCookie()
          .filter((c) => !c.includes('ms_oauth_state=;')),
      );
      return { sessionCookie, redirectLocation };
    }

    const userA = await loginUser(
      { sub: '10001', id: 10001, battletag: 'AlphaUser#1001' },
      '/\\evil.com',
    );
    expect(userA.redirectLocation).toBe('/');

    const userB = await loginUser(
      { sub: '10002', id: 10002, battletag: 'BetaUser#1002' },
      '//evil.com/path',
    );
    expect(userB.redirectLocation).toBe('/');

    const meA = await fetch(`${server.url}/api/auth/me`, {
      headers: { Cookie: userA.sessionCookie },
    });
    const meAJson = (await meA.json()) as {
      authenticated: boolean;
      user: { id: string; battletag: string };
      characters: Array<{ id: string; userId: string }>;
    };
    assertAuthMeContract(meAJson);
    expect(meAJson.authenticated).toBe(true);
    expect(meAJson.user.battletag).toBe('AlphaUser#1001');
    expect(meAJson.characters).toHaveLength(5);
    expect(meAJson.characters.every((c) => c.id.startsWith('bnet:10001:'))).toBe(
      true,
    );

    const meB = await fetch(`${server.url}/api/auth/me`, {
      headers: { Cookie: userB.sessionCookie },
    });
    const meBJson = (await meB.json()) as {
      authenticated: boolean;
      user: { id: string; battletag: string };
      characters: Array<{ id: string; userId: string }>;
    };
    assertAuthMeContract(meBJson);
    expect(meBJson.authenticated).toBe(true);
    expect(meBJson.user.battletag).toBe('BetaUser#1002');
    expect(meBJson.characters).toHaveLength(5);
    expect(meBJson.characters.every((c) => c.id.startsWith('bnet:10002:'))).toBe(
      true,
    );
  });
});
