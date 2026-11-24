import assert from 'node:assert/strict';
import {
  ANNIVERSARY_REALMS,
  SELECTORS,
  assertCapabilitiesContract,
  assertGraceful501Contract,
  assertHealthContract,
  assertNotificationsContract,
  byTestId,
  decodeMS1,
  encodeMS1,
} from '../contracts.mjs';
import { ANCHOR_ITEMS } from '../fixtures/dataset-fixtures.mjs';
import { createAddonBridge } from '../addon/lua-bridge.mjs';
import {
  apiJson,
  assertEraBranding,
  assertValidCurrencyText,
  closeItemDetailModal,
  createShoppingList,
  exportMS1FromUI,
  importMS1InUI,
  loginViaBrowserOAuth,
  navigateToAlerts,
  navigateToShoppingLists,
  openItemDetailByText,
  performHttpOAuthLogin,
  searchAuctions,
  selectFlavor,
  selectMarket,
  selectRulesetOrRealm,
  waitForAuctionRows,
  waitForAuctionRowsOrEmpty,
  withAppPage,
} from './lib/helpers.mjs';

export function registerTests(registry) {
  // S1: Forever Raid Consumable Prep & Addon Round-Trip
  registry.register({
    id: 'T4-S1',
    tier: 4,
    feature: 'F8',
    title: 'S1: Forever 9.5+ MB raid consumable prep -> !MS1! export -> Lua addon edit -> re-import to Web UI',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({ largeForever: true });
      try {
        const webExport = await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'forever');
          await assertEraBranding(page, 'forever');
          await selectRulesetOrRealm(page, 'pvp');
          await selectMarket(page, 'Alliance');
          await waitForAuctionRows(page, 30000);

          // Browse across Normal and PvP rulesets
          await selectRulesetOrRealm(page, 'normal');
          await waitForAuctionRows(page, 30000);
          await selectRulesetOrRealm(page, 'pvp');
          await waitForAuctionRows(page, 30000);

          // Search raid consumable & add to shopping list
          await searchAuctions(page, 'Dreamfoil');
          await openItemDetailByText(page, /Dreamfoil|13464/i);
          await page.locator(byTestId(SELECTORS.addToListBtn)).click();
          await closeItemDetailModal(page);

          await navigateToShoppingLists(page);
          await createShoppingList(page, 'AQ40 Raid Prep');
          await importMS1InUI(
            page,
            encodeMS1({
              v: 1,
              n: 'AQ40 Raid Prep',
              f: 'forever',
              r: 'pvp',
              fa: 'Alliance',
              i: [
                { id: 13464, q: 20, m: 15000, nm: 'Dreamfoil', nt: 'Nature Prot', d: 0, a: 1 },
                { id: 13444, q: 10, m: 55000, nm: 'Major Mana Potion', nt: 'Healers', d: 0, a: 1 },
              ],
            })
          );
          return exportMS1FromUI(page);
        });

        // Round-trip through real MarketSync Lua 5.1 addon
        const bridge = createAddonBridge();
        let addonExport;
        try {
          const imp = bridge.importToFavorites(webExport);
          assert.equal(imp.ok, true, imp.error);
          bridge.runLua(`
            local F = MarketSync.Favorites
            if F and F.SetQuantity and F.SetItemMeta then
              F.SetQuantity("AQ40 Raid Prep", 13464, 40)
              F.SetItemMeta("AQ40 Raid Prep", 13464, { done = true })
            elseif MarketSyncDB.FavoriteMeta["AQ40 Raid Prep"] and MarketSyncDB.FavoriteMeta["AQ40 Raid Prep"].items then
              MarketSyncDB.FavoriteQuantities["AQ40 Raid Prep"][13464] = 40
              MarketSyncDB.FavoriteMeta["AQ40 Raid Prep"].items[13464].done = true
            end
          `, 's1-addon-edit');
          const exp = bridge.exportFromFavorites('AQ40 Raid Prep');
          assert.equal(exp.ok, true, exp.error);
          addonExport = exp.encoded;
        } finally {
          bridge.close();
        }

        // Import back into fresh browser context & verify edits
        await withAppPage(ctx, async (page) => {
          await navigateToShoppingLists(page);
          await importMS1InUI(page, addonExport);
          const finalStr = await exportMS1FromUI(page);
          const finalList = decodeMS1(finalStr);
          const dreamfoil = finalList.i.find((x) => x.id === 13464);
          assert.equal(dreamfoil.q, 40);
          assert.equal(dreamfoil.d, 1);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  // S2: Classic MoP Pet & Glyph Flipping
  registry.register({
    id: 'T4-S2',
    tier: 4,
    feature: 'F5',
    title: 'S2: Classic MoP Pagle Pet Cage (82800:48213) price history inspection -> shopping list -> !MS1! export',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await assertEraBranding(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);

        await searchAuctions(page, '82800');
        await openItemDetailByText(page, /82800|48213|Pet/i);
        const svgCount = await page.locator(`${byTestId(SELECTORS.priceHistoryChart)} svg`).count();
        assert.ok(svgCount >= 1, 'Expected SVG price history chart for Pet Cage');

        await page.locator(byTestId(SELECTORS.addToListBtn)).click();
        await closeItemDetailModal(page);
        await navigateToShoppingLists(page);
        const exported = await exportMS1FromUI(page);
        const dec = decodeMS1(exported);
        assert.ok(dec.i.length >= 1, 'Expected Pet Cage item in exported !MS1! list');
      });
    },
  });

  // S3: Anniversary Launch Realm Check & Graceful Empty Market Workflow
  registry.register({
    id: 'T4-S3',
    tier: 4,
    feature: 'F12',
    title: 'S3: Anniversary launch realms inspection with 0-listing graceful empty state & persistent pre-launch list',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'anniversary');
        await assertEraBranding(page, 'anniversary');

        for (const realm of ANNIVERSARY_REALMS) {
          await selectRulesetOrRealm(page, realm);
          const state = await waitForAuctionRowsOrEmpty(page);
          assert.ok(state.emptyVisible || state.rowCount === 0, `Expected graceful empty state on ${realm}`);
        }

        await navigateToShoppingLists(page);
        await createShoppingList(page, 'Anniversary Launch Plan');
        await importMS1InUI(
          page,
          encodeMS1({
            v: 1,
            n: 'Anniversary Launch Plan',
            f: 'anniversary',
            r: 'nightslayer',
            fa: 'Alliance',
            i: [{ id: 13464, q: 20, m: 10000, nm: 'Dreamfoil', nt: 'Week 1 buy' }],
          })
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToShoppingLists(page);
        const rows = await page.locator(byTestId(SELECTORS.shoppingItemRow)).count();
        assert.equal(rows, 1, 'Pre-launch shopping list must persist across reload');
      });
    },
  });

  // S4: Retail Commodities Tracking + OAuth Alert Email & On-Site Trigger
  registry.register({
    id: 'T4-S4',
    tier: 4,
    feature: 'F10',
    title: 'S4: Retail Commodities OAuth alert -> hour advance price drop -> on-site inbox & mock email delivery',
    modes: ['selfhosted'],
    async run(ctx) {
      ctx.emailServer.clearEmails();
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'retail');
          await assertEraBranding(page, 'retail');
          await selectMarket(page, 'Commodities');
          await waitForAuctionRows(page);

          await searchAuctions(page, ANCHOR_ITEMS.PEACEBLOOM);
          const rowText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
          assertValidCurrencyText(rowText, 'Retail Peacebloom');

          const battletag = await loginViaBrowserOAuth(page);
          assert.match(battletag, /MarketTester#1337/);

          await navigateToAlerts(page);
          await page.locator(byTestId(SELECTORS.notificationEmailInput)).fill('s4-alerts@example.com');
          await Promise.all([
            page.waitForResponse(
              (res) => res.url().includes('/api/settings/notifications') && res.request().method() === 'PUT'
            ),
            page.locator(byTestId(SELECTORS.saveNotificationSettingsBtn)).click(),
          ]);

          // Create alert rule via authenticated browser context fetch so cookies match session
          const created = await page.evaluate(async () => {
            const res = await fetch('/api/alerts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                flavor: 'retail',
                ruleset: 'region',
                market: 'Commodities',
                itemKey: '2447',
                condition: 'below',
                thresholdCopper: 20000,
                notifyOnsite: true,
                notifyEmail: true,
              }),
            });
            return res.status;
          });
          assert.ok(created === 200 || created === 201, `Alert creation failed with status ${created}`);

          // Advance mock data server to hour 10 (Peacebloom 30,000 -> 12,000c) and evaluate
          ctx.dataServer.advanceHour(2);
          const evalStatus = await page.evaluate(async () => {
            const res = await fetch('/api/notifications/evaluate', { method: 'POST' });
            return res.status;
          });
          assert.ok(evalStatus >= 200 && evalStatus < 300);

          await page.reload({ waitUntil: 'domcontentloaded' });
          await navigateToAlerts(page);
          const inbox = page.locator(byTestId(SELECTORS.notificationInbox));
          await inbox.waitFor({ state: 'visible', timeout: 10000 });
          const inboxText = (await inbox.textContent()) || '';
          assert.match(inboxText, /Peacebloom|2447/i);
        });

        const email = await ctx.emailServer.waitForEmail(
          (e) => String(e.to).includes('s4-alerts@example.com'),
          5000
        );
        assert.ok(email.subject.length > 0);
      } finally {
        ctx.dataServer.reset();
        ctx.emailServer.clearEmails();
      }
    },
  });

  // S5: Forever Realmless Character Linking + Multi-Hour Price Spike Alert
  registry.register({
    id: 'T4-S5',
    tier: 4,
    feature: 'F9',
    title: 'S5: Forever realmless {name, surname} character linking + suffixed & spike alerts evaluation',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
        const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
        assert.equal(me.body.authenticated, true);
        const foreverChar = (me.body.characters || []).find((c) => c.name === 'Aelindor' && c.surname === 'Dawnblade');
        assert.ok(foreverChar, 'Expected realmless Forever character');
        assert.equal(foreverChar.realm, undefined);

        // Link a Forever shopping list to the realmless character
        const listRes = await apiJson(ctx.baseUrl, '/api/lists', {
          method: 'POST',
          jar,
          body: {
            name: 'Aelindor Spike Watch',
            flavor: 'forever',
            ruleset: 'pvp',
            market: 'Alliance',
            characterId: foreverChar.id,
            items: [
              { itemId: 13005, suffix: 4512, qty: 1, maxPrice: 6000 },
              { itemId: 13464, qty: 20, maxPrice: 30000 },
            ],
          },
        });
        assert.ok(listRes.status === 200 || listRes.status === 201);

        // Create suffixed drop alert (8999 -> 4500) + spike alert (13000 -> 45000)
        await apiJson(ctx.baseUrl, '/api/alerts', {
          method: 'POST',
          jar,
          body: {
            flavor: 'forever',
            ruleset: 'pvp',
            market: 'Alliance',
            itemKey: '13005:4512',
            condition: 'below',
            thresholdCopper: 6000,
            notifyOnsite: true,
            notifyEmail: false,
          },
        });
        await apiJson(ctx.baseUrl, '/api/alerts', {
          method: 'POST',
          jar,
          body: {
            flavor: 'forever',
            ruleset: 'pvp',
            market: 'Alliance',
            itemKey: '13464',
            condition: 'above',
            thresholdCopper: 30000,
            notifyOnsite: true,
            notifyEmail: false,
          },
        });

        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });

        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        assert.equal(notifs.status, 200);
        assertNotificationsContract(notifs.body);
        const items = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.ok(items.length >= 2, `Expected >=2 notifications for suffixed drop & Dreamfoil spike, got ${items.length}`);

        for (const item of items) {
          const readRes = await apiJson(ctx.baseUrl, `/api/notifications/${encodeURIComponent(item.id)}/read`, {
            method: 'POST',
            jar,
          });
          assert.ok(readRes.status >= 200 && readRes.status < 300);
        }
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  // S6: Dual-Mode Portability Check (Self-Hosted Node vs Zero-DB Cloudflare Worker)
  registry.register({
    id: 'T4-S6',
    tier: 4,
    feature: 'F11',
    title: 'S6: Dual-mode portability — identical browsing/history/!MS1! behavior with mode-accurate capabilities',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const health = await apiJson(ctx.baseUrl, '/api/health');
      assert.equal(health.status, 200);
      assertHealthContract(health.body, ctx.mode);

      const caps = await apiJson(ctx.baseUrl, '/api/capabilities');
      assert.equal(caps.status, 200);
      assertCapabilitiesContract(caps.body, ctx.mode);

      if (ctx.mode === 'cloudflare') {
        const authRes = await apiJson(ctx.baseUrl, '/api/auth/login?region=us', { redirect: 'manual' });
        assertGraceful501Contract(authRes.status, authRes.body);
        const listsRes = await apiJson(ctx.baseUrl, '/api/lists');
        assertGraceful501Contract(listsRes.status, listsRes.body);
      } else {
        const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
        const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
        assert.equal(me.body.authenticated, true);
      }

      // Core browsing, price history, and login-free !MS1! must work identically in BOTH modes
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await assertEraBranding(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, 'Dreamfoil');
        await openItemDetailByText(page, /Dreamfoil|13464/i);
        await page.locator(byTestId(SELECTORS.addToListBtn)).click();
        await closeItemDetailModal(page);

        await navigateToShoppingLists(page);
        const exported = await exportMS1FromUI(page);
        const decoded = decodeMS1(exported);
        assert.ok(decoded.i.length >= 1);
      });
    },
  });
}
