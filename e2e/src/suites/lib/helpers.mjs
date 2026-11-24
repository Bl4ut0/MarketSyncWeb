import assert from 'node:assert/strict';
import {
  FLAVORS,
  SELECTORS,
  byTestId,
} from '../../contracts.mjs';

// ---------------------------------------------------------------------------
// HTTP & Cookie Jar Helpers (Opaque-Box API Testing)
// ---------------------------------------------------------------------------

export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  captureFromResponse(res) {
    let rawHeaders = [];
    if (typeof res.headers.getSetCookie === 'function') {
      rawHeaders = res.headers.getSetCookie();
    } else {
      const single = res.headers.get('set-cookie');
      if (single) rawHeaders = [single];
    }

    for (const header of rawHeaders) {
      const firstPart = String(header).split(';')[0]?.trim();
      if (!firstPart) continue;
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (value === '' || /Max-Age=0/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  headerValue() {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

export async function apiRequest(baseUrl, path, {
  method = 'GET',
  headers = {},
  body = undefined,
  jar = null,
  redirect = 'follow',
} = {}) {
  const reqHeaders = new Headers(headers);
  if (jar) {
    const cookieHeader = jar.headerValue();
    if (cookieHeader && !reqHeaders.has('cookie')) {
      reqHeaders.set('cookie', cookieHeader);
    }
  }
  let payload = body;
  if (body !== undefined && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof URLSearchParams)) {
    payload = JSON.stringify(body);
    if (!reqHeaders.has('content-type')) {
      reqHeaders.set('content-type', 'application/json');
    }
  }

  const targetUrl = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(targetUrl, {
    method,
    headers: reqHeaders,
    body: payload,
    redirect,
  });

  if (jar && targetUrl.startsWith(baseUrl.replace(/\/+$/, ''))) {
    jar.captureFromResponse(res);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text,
    json,
    location: res.headers.get('location'),
  };
}

export async function apiJson(baseUrl, path, opts = {}) {
  const res = await apiRequest(baseUrl, path, opts);
  return { ...res, body: res.json };
}

/**
 * Executes the Battle.net OAuth 2.0 Authorization Code flow over HTTP against the app
 * and its configured mock-oauth-server without hardcoding internal session secrets.
 */
export async function performHttpOAuthLogin(baseUrl, {
  region = 'us',
  deny = false,
  tamperState = false,
  omitState = false,
} = {}) {
  const jar = new CookieJar();
  const loginRes = await apiRequest(
    baseUrl,
    `/api/auth/login?region=${encodeURIComponent(region)}`,
    { jar, redirect: 'manual' }
  );
  assert.ok(
    loginRes.status >= 300 && loginRes.status < 400 && loginRes.location,
    `Expected /api/auth/login redirect, got status=${loginRes.status} location=${loginRes.location}`
  );

  const authUrl = new URL(loginRes.location, baseUrl);
  if (deny) {
    authUrl.searchParams.set('deny', '1');
  }
  const authorizeRes = await apiRequest(baseUrl, authUrl.toString(), { redirect: 'manual' });
  assert.ok(
    authorizeRes.status >= 300 && authorizeRes.status < 400 && authorizeRes.location,
    `Expected OAuth authorize redirect, got status=${authorizeRes.status}`
  );

  const callbackUrl = new URL(authorizeRes.location, baseUrl);
  if (tamperState) {
    callbackUrl.searchParams.set('state', 'tampered_csrf_state_invalid');
  }
  if (omitState) {
    callbackUrl.searchParams.delete('state');
  }

  const callbackRes = await apiRequest(
    baseUrl,
    `${callbackUrl.pathname}${callbackUrl.search}`,
    { jar, redirect: 'manual' }
  );

  return { jar, loginRes, authorizeRes, callbackRes };
}

// ---------------------------------------------------------------------------
// Playwright Browser Session & Semantic / TestId Helpers
// ---------------------------------------------------------------------------

export async function withAppPage(ctx, fn, {
  path = '/',
  contextOptions = {},
  waitUntil = 'domcontentloaded',
  timeout = 20000,
} = {}) {
  return ctx.browser.withPage(async (session) => {
    const targetUrl = `${ctx.baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
    // Keep fixture-based browser assertions independent of Wowhead availability.
    await session.context.route('https://wow.zamimg.com/widgets/power.js', (route) => route.fulfill({
      contentType: 'text/javascript', body: '',
    }));
    await session.context.route('https://wow.zamimg.com/images/wow/icons/**', (route) => route.fulfill({
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    }));
    await session.context.route('https://nether.wowhead.com/**', (route) => route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {},
    }));
    await session.context.route('**/api/items/search?*', (route) => route.fulfill({ json: { items: [] } }));
    await session.page.goto(targetUrl, { waitUntil, timeout });
    await session.page.locator(byTestId(SELECTORS.appShell)).waitFor({ state: 'visible', timeout });
    const result = await fn(session.page, session);
    session.assertNoErrors();
    return result;
  }, contextOptions);
}

export async function selectFlavor(page, flavor, timeout = 15000) {
  assert.ok(FLAVORS.includes(flavor), `Unknown flavor: ${flavor}`);
  const tab = page.locator(byTestId(SELECTORS.flavorTab(flavor)));
  await tab.waitFor({ state: 'visible', timeout });
  await tab.click();
  await page.locator(`${byTestId(SELECTORS.appShell)}[data-flavor="${flavor}"]`).waitFor({
    state: 'visible',
    timeout,
  });
}

export async function getRulesetOptions(page) {
  const select = page.locator(byTestId(SELECTORS.rulesetSelect));
  await select.waitFor({ state: 'visible', timeout: 15000 });
  return select.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
  );
}

export async function selectRulesetOrRealm(page, valueOrLabel, timeout = 15000) {
  const select = page.locator(byTestId(SELECTORS.rulesetSelect));
  await select.waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    ({ sel, target }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Array.from(el.options).some(
        (o) => o.value === target || (o.textContent || '').trim().toLowerCase() === String(target).toLowerCase()
      );
    },
    { sel: byTestId(SELECTORS.rulesetSelect), target: valueOrLabel },
    { timeout }
  );

  const opts = await getRulesetOptions(page);
  const match = opts.find(
    (o) => o.value === valueOrLabel || o.label.toLowerCase() === String(valueOrLabel).toLowerCase()
  );
  assert.ok(match, `Option "${valueOrLabel}" not found in ruleset-select: ${JSON.stringify(opts)}`);
  await select.selectOption(match.value);
}

export async function selectMarket(page, market, timeout = 15000) {
  const tab = page.locator(byTestId(SELECTORS.marketTab(market)));
  await tab.waitFor({ state: 'visible', timeout });
  await tab.click();
}

export async function waitForAuctionRowsOrEmpty(page, timeout = 20000) {
  await page.waitForFunction(
    ({ tableSel, emptySel }) => {
      const empty = document.querySelector(emptySel);
      if (empty && empty.offsetParent !== null) return true;
      const rows = document.querySelectorAll(`${tableSel} tbody tr`);
      return rows.length > 0;
    },
    {
      tableSel: byTestId(SELECTORS.auctionTable),
      emptySel: byTestId(SELECTORS.emptyMarketState),
    },
    { timeout }
  );
  const rowCount = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
  const emptyVisible = await page.locator(byTestId(SELECTORS.emptyMarketState)).isVisible().catch(() => false);
  return { rowCount, emptyVisible };
}

export async function waitForAuctionRows(page, timeout = 20000) {
  await page.waitForFunction(
    (tableSel) => document.querySelectorAll(`${tableSel} tbody tr`).length > 0,
    byTestId(SELECTORS.auctionTable),
    { timeout }
  );
  return page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
}

export async function searchAuctions(page, query) {
  const input = page.locator(byTestId(SELECTORS.auctionSearchInput));
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(query);
  await page.waitForTimeout(200);
}

export async function openItemDetailByText(page, textOrPattern) {
  const table = page.locator(byTestId(SELECTORS.auctionTable));
  const row = table.locator('tbody tr', { hasText: textOrPattern }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
  const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
  await chart.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const loading = el.getAttribute('data-history-loading');
      return loading === null || loading === 'false';
    },
    byTestId(SELECTORS.priceHistoryChart),
    { timeout: 15000 }
  );
}

export async function closeItemDetailModal(page) {
  const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
  const dialog = page.locator('[role="dialog"]');
  const closeByAria = page.locator(
    '[role="dialog"] button[aria-label*="Close" i], [role="dialog"] button[aria-label*="close" i]'
  ).first();
  if ((await closeByAria.count()) > 0 && (await closeByAria.isVisible().catch(() => false))) {
    await closeByAria.click();
  } else {
    const closeByText = page.locator('[role="dialog"] button').filter({ hasText: /close/i }).first();
    if ((await closeByText.count()) > 0 && (await closeByText.isVisible().catch(() => false))) {
      await closeByText.click();
    } else {
      await page.keyboard.press('Escape');
    }
  }
  await chart.waitFor({ state: 'hidden', timeout: 10000 });
  if ((await dialog.count()) > 0) {
    await dialog.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
}

export async function navigateToAuctionHouse(page) {
  const byId = page.locator('[data-testid="nav-auction-house"]');
  const nav = (await byId.count()) > 0
    ? byId.first()
    : page.getByRole('button', { name: /Auction House/i }).or(page.getByRole('tab', { name: /Auction House/i })).first();
  await nav.waitFor({ state: 'visible', timeout: 15000 });
  await nav.click();
}

export async function navigateToShoppingLists(page) {
  const nav = page.locator(byTestId(SELECTORS.navShoppingLists));
  await nav.waitFor({ state: 'visible', timeout: 15000 });
  await nav.click();
}

export async function createShoppingList(page, listName) {
  const input = page.locator(byTestId(SELECTORS.createListInput));
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(listName);
  await page.locator(byTestId(SELECTORS.createListBtn)).click();
  await page.waitForFunction(
    ({ sel, expected }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Array.from(el.options).some((o) => (o.textContent || '').includes(expected) || o.value === expected);
    },
    { sel: byTestId(SELECTORS.shoppingListSelect), expected: listName },
    { timeout: 10000 }
  );
}

export async function exportMS1FromUI(page) {
  await page.locator(byTestId(SELECTORS.exportMs1Btn)).click();
  const output = page.locator(byTestId(SELECTORS.ms1ExportOutput));
  await output.waitFor({ state: 'visible', timeout: 10000 });
  const val = await output.inputValue().catch(async () => (await output.textContent()) || '');
  return val.trim();
}

export async function importMS1InUI(page, ms1String, { expectError = false } = {}) {
  await page.locator(byTestId(SELECTORS.importMs1Btn)).click();
  const input = page.locator(byTestId(SELECTORS.ms1ImportInput));
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(ms1String);
  await page.locator(byTestId(SELECTORS.ms1ImportConfirm)).click();
  if (expectError) {
    const errEl = page.locator(byTestId(SELECTORS.ms1ImportError));
    await errEl.waitFor({ state: 'visible', timeout: 10000 });
    return (await errEl.textContent()) || '';
  }
  await input.waitFor({ state: 'hidden', timeout: 10000 });
  return '';
}

export async function navigateToAlerts(page) {
  const nav = page.locator(byTestId(SELECTORS.navAlerts));
  await nav.waitFor({ state: 'visible', timeout: 15000 });
  await nav.click();
}

export async function loginViaBrowserOAuth(page) {
  const loginBtn = page.locator(byTestId(SELECTORS.bnetLoginBtn));
  await loginBtn.waitFor({ state: 'visible', timeout: 15000 });
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/oauth/'), { timeout: 15000 }),
    loginBtn.click(),
  ]);
  await page.locator(byTestId(SELECTORS.userBattletag)).waitFor({ state: 'visible', timeout: 15000 });
  return ((await page.locator(byTestId(SELECTORS.userBattletag)).textContent()) || '').trim();
}

export async function assertEraBranding(page, expectedFlavor) {
  const shell = page.locator(byTestId(SELECTORS.appShell));
  await shell.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await shell.getAttribute('data-flavor'), expectedFlavor);

  const logo = page.locator(byTestId(SELECTORS.eraLogo));
  await logo.waitFor({ state: 'visible', timeout: 15000 });
  const logoInfo = await logo.evaluate((img) => ({
    tag: img.tagName.toLowerCase(),
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    alt: img.alt || '',
    src: img.currentSrc || img.getAttribute('src') || '',
  }));
  assert.equal(logoInfo.tag, 'img', 'Era logo must be an <img> element');
  assert.ok(logoInfo.complete && logoInfo.naturalWidth > 0, `Broken era logo for ${expectedFlavor}: ${logoInfo.src}`);
  assert.ok(logoInfo.alt.trim().length > 0, `Era logo alt text missing for ${expectedFlavor}`);

  const footer = page.locator(byTestId(SELECTORS.trademarkFooter));
  await footer.waitFor({ state: 'visible', timeout: 10000 });
  const footerText = ((await footer.textContent()) || '').trim();
  assert.ok(footerText.length > 10, 'Trademark/non-affiliation footer must be non-empty');
  assert.match(footerText, /blizzard|warcraft|affiliated|trademark/i);

  return { logoInfo, footerText };
}

export function assertValidCurrencyText(text, label = 'currency') {
  const clean = String(text || '').trim();
  assert.ok(clean.length > 0, `${label} must not be empty`);
  assert.ok(!/NaN|undefined|Infinity/i.test(clean), `${label} contains invalid token: ${clean}`);
}
