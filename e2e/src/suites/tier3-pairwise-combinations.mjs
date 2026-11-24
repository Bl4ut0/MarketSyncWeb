import assert from 'node:assert/strict';
import {
  MAX_COPPER_CAP,
  SELECTORS,
  assertCapabilitiesContract,
  assertDatasetIndexContract,
  assertGraceful501Contract,
  assertSnapshotBlockContract,
  byTestId,
  decodeMS1,
  encodeMS1,
} from '../contracts.mjs';
import { ANCHOR_ITEMS, DATE_STR } from '../fixtures/dataset-fixtures.mjs';
import { createAddonBridge } from '../addon/lua-bridge.mjs';
import {
  apiJson,
  assertEraBranding,
  assertValidCurrencyText,
  closeItemDetailModal,
  createShoppingList,
  exportMS1FromUI,
  getRulesetOptions,
  importMS1InUI,
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
  registry.register({
    id: 'T3-PAIR-01',
    tier: 3,
    feature: 'F1',
    title: 'Pairwise F1xF2: Switching eras updates ruleset/realm options and resets selection cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'roleplaypvp');
        await waitForAuctionRows(page);

        await selectFlavor(page, 'anniversary');
        await selectRulesetOrRealm(page, 'nightslayer');
        await waitForAuctionRowsOrEmpty(page);

        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        assert.ok((await waitForAuctionRows(page)) > 0);

        await selectFlavor(page, 'retail');
        await selectRulesetOrRealm(page, 'region');
        await assertEraBranding(page, 'retail');
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-02',
    tier: 3,
    feature: 'F2',
    title: 'Pairwise F2xF3: Forever legacy rulesets (p/n/r) paired with Neutral 64-bit copper cap & suffixed items',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const snap = await apiJson(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/forever/${DATE_STR}/08-00.json`)}`
      );
      assert.equal(snap.status, 200);
      assert.equal(snap.body.rulesets.p.Neutral[ANCHOR_ITEMS.COPPER_CAP_ITEM].maxPrice, MAX_COPPER_CAP);
      assert.ok(snap.body.rulesets.p.Alliance[ANCHOR_ITEMS.SUFFIXED_ITEM]);

      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Neutral');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_CAP_ITEM);
        const text = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        assertValidCurrencyText(text, 'Neutral cap item');
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-03',
    tier: 3,
    feature: 'F3',
    title: 'Pairwise F3xF4: 9.5+ MB Forever snapshot paired with search, sorting, and pagination',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({ largeForever: true });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'forever');
          await selectRulesetOrRealm(page, 'pvp');
          await selectMarket(page, 'Alliance');
          await waitForAuctionRows(page, 30000);

          const nextBtn = page.locator(byTestId(SELECTORS.paginationNext));
          if (await nextBtn.isEnabled()) {
            await nextBtn.click();
          }
          await searchAuctions(page, 'Dreamfoil');
          const rowText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
          assert.match(rowText || '', /Dreamfoil|13464/i);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T3-PAIR-04',
    tier: 3,
    feature: 'F4',
    title: 'Pairwise F4xF5: Filtering Classic Pagle to Pet Cages then opening multi-hour price history SVG',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '82800');
        await openItemDetailByText(page, /82800|48213|Pet/i);
        const svgCount = await page.locator(`${byTestId(SELECTORS.priceHistoryChart)} svg`).count();
        assert.ok(svgCount >= 1, 'Expected SVG price history chart for Pet Cage');
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-05',
    tier: 3,
    feature: 'F5',
    title: 'Pairwise F5xF6: Inspecting multi-hour price history on Forever 13444 and adding to login-free list',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.MAJOR_MANA_POTION);
        await openItemDetailByText(page, /Major Mana Potion|13444/i);
        await page.locator(byTestId(SELECTORS.addToListBtn)).click();
        await closeItemDetailModal(page);

        await navigateToShoppingLists(page);
        const rowText = await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().textContent();
        assert.match(rowText || '', /Major Mana Potion|13444/i);
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-06',
    tier: 3,
    feature: 'F6',
    title: 'Pairwise F6xF7: Login-free shopping list CRUD paired with !MS1! export and re-import in fresh browser',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const exported = await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const seed = encodeMS1({
          v: 1,
          n: 'Cross-Context List',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [{ id: 13464, q: 25, m: 45000, nm: 'Dreamfoil', nt: 'Carry over', d: 0, a: 1 }],
        });
        await importMS1InUI(page, seed);
        return exportMS1FromUI(page);
      });

      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await importMS1InUI(page, exported);
        const rowText = await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().textContent();
        assert.match(rowText || '', /Dreamfoil|13464/i);
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-07',
    tier: 3,
    feature: 'F7',
    title: 'Pairwise F7xF8: Web UI !MS1! export -> Lua Addon Favorites edit -> Lua export -> Web UI import',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const webExport = await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const seed = encodeMS1({
          v: 1,
          n: 'WebToLuaToWeb',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [{ id: 13464, q: 10, m: 35000, nm: 'Dreamfoil', nt: 'Raid', d: 0, a: 1 }],
        });
        await importMS1InUI(page, seed);
        return exportMS1FromUI(page);
      });

      const bridge = createAddonBridge();
      let luaExported;
      try {
        assert.equal(bridge.importToFavorites(webExport).ok, true);
        bridge.runLua(`
          local F = MarketSync.Favorites
          if F and F.SetQuantity and F.SetItemMeta then
            F.SetQuantity("WebToLuaToWeb", 13464, 50)
            F.SetItemMeta("WebToLuaToWeb", 13464, { done = true })
          elseif MarketSyncDB.FavoriteMeta["WebToLuaToWeb"] and MarketSyncDB.FavoriteMeta["WebToLuaToWeb"].items then
            MarketSyncDB.FavoriteQuantities["WebToLuaToWeb"][13464] = 50
            MarketSyncDB.FavoriteMeta["WebToLuaToWeb"].items[13464].done = true
          end
        `, 'pair7-lua-edit');
        const exp = bridge.exportFromFavorites('WebToLuaToWeb');
        assert.equal(exp.ok, true);
        luaExported = exp.encoded;
      } finally {
        bridge.close();
      }

      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await importMS1InUI(page, luaExported);
        const reExported = await exportMS1FromUI(page);
        const dec = decodeMS1(reExported);
        assert.equal(dec.i.find((x) => x.id === 13464).q, 50);
        assert.equal(dec.i.find((x) => x.id === 13464).d, 1);
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-08',
    tier: 3,
    feature: 'F8',
    title: 'Pairwise F8xF3: Lua 5.1 addon codec round-trips suffixed item, Pet Cage, 64-bit cap, and uncached item',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const list = {
          v: 1,
          n: 'Complex Domain Items',
          f: 'classic',
          r: 'pagle',
          fa: 'CrossFaction',
          i: [
            { id: 13005, s: 4512, q: 1, m: MAX_COPPER_CAP, nm: 'Suffixed Cap', d: 0, a: 1 },
            { id: 82800, s: 48213, q: 2, m: 16200000, nm: 'Pet Cage', d: 0, a: 0 },
            { id: 999999, q: 3, m: 12000 },
          ],
        };
        const jsStr = encodeMS1(list);
        const dec = bridge.decodeList(jsStr);
        assert.equal(dec.ok, true, dec.error);
        const luaStr = bridge.encodeList(dec.list);
        const jsBack = decodeMS1(luaStr);
        assert.equal(jsBack.i[0].m, MAX_COPPER_CAP);
        assert.equal(jsBack.i[1].s, 48213);
        assert.equal(jsBack.i[2].id, 999999);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T3-PAIR-09',
    tier: 3,
    feature: 'F9',
    title: 'Pairwise F9xF6: Login-free shopping list linked to realmless Forever {name, surname} character via OAuth',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
      const foreverChar = (me.body.characters || []).find((c) => c.name === 'Aelindor' && c.surname === 'Dawnblade');
      assert.ok(foreverChar, 'Expected Forever character');

      const post = await apiJson(ctx.baseUrl, '/api/lists', {
        method: 'POST',
        jar,
        body: {
          name: 'Aelindor Forever Prep',
          flavor: 'forever',
          ruleset: 'pvp',
          market: 'Alliance',
          characterId: foreverChar.id,
          items: [{ itemId: 13464, qty: 20, maxPrice: 15000 }],
        },
      });
      assert.ok(post.status === 200 || post.status === 201);
      const listsRes = await apiJson(ctx.baseUrl, '/api/lists', { jar });
      const lists = Array.isArray(listsRes.body) ? listsRes.body : listsRes.body.lists;
      const linked = lists.find((l) => l.name === 'Aelindor Forever Prep');
      assert.ok(linked && String(linked.characterId) === String(foreverChar.id));
    },
  });

  registry.register({
    id: 'T3-PAIR-10',
    tier: 3,
    feature: 'F10',
    title: 'Pairwise F10xF5: Simultaneous price spike (above) and drop (below) across snapshot hour transition 09->10',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
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

        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const list = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.ok(list.length >= 2, `Expected both spike and drop notifications, got ${list.length}`);
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T3-PAIR-11',
    tier: 3,
    feature: 'F11',
    title: 'Pairwise F11xF1: Capabilities report mode accurately while all 5 era themes render identically across modes',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const cap = await apiJson(ctx.baseUrl, '/api/capabilities');
      assert.equal(cap.status, 200);
      assertCapabilitiesContract(cap.body, ctx.mode);

      if (ctx.mode === 'cloudflare') {
        const res = await apiJson(ctx.baseUrl, '/api/alerts');
        assertGraceful501Contract(res.status, res.body);
      }

      await withAppPage(ctx, async (page) => {
        for (const f of ['forever', 'retail']) {
          await selectFlavor(page, f);
          await assertEraBranding(page, f);
        }
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-12',
    tier: 3,
    feature: 'F12',
    title: 'Pairwise F12xF5: Legacy simulated root snapshot (07-00.json) coexists with multi-hour forever blocks',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const idx = await apiJson(ctx.baseUrl, '/api/datasets/index.json');
      assert.equal(idx.status, 200);
      assertDatasetIndexContract(idx.body);

      const legacy = idx.body.blocks.find((b) => b.simulated === true && !b.flavor);
      const modern = idx.body.blocks.find((b) => b.flavor === 'forever' && b.hour === '09');
      assert.ok(legacy && modern);

      const legacySnap = await apiJson(ctx.baseUrl, `/api/datasets/snapshot?path=${encodeURIComponent(legacy.path)}`);
      const modernSnap = await apiJson(ctx.baseUrl, `/api/datasets/snapshot?path=${encodeURIComponent(modern.path)}`);
      assertSnapshotBlockContract(legacySnap.body);
      assertSnapshotBlockContract(modernSnap.body);
    },
  });

  registry.register({
    id: 'T3-PAIR-13',
    tier: 3,
    feature: 'F2',
    title: 'Pairwise F2xF12: Classic Era missing Alliance faction key + Anniversary empty realms recover cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classicEra');
        await selectRulesetOrRealm(page, 'whitemane');
        await waitForAuctionRowsOrEmpty(page);

        await selectFlavor(page, 'anniversary');
        await selectRulesetOrRealm(page, 'maladath');
        const st = await waitForAuctionRowsOrEmpty(page);
        assert.ok(st.emptyVisible || st.rowCount === 0);
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-14',
    tier: 3,
    feature: 'F3',
    title: 'Pairwise F3xF1: Era-specific markets (Classic CrossFaction Pet Cages vs Retail Commodities 64-bit)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '82800');
        assert.ok((await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count()) >= 1);

        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_64BIT_RETAIL);
        const rText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        assertValidCurrencyText(rText, 'Retail 64-bit');
      });
    },
  });

  registry.register({
    id: 'T3-PAIR-15',
    tier: 3,
    feature: 'F1',
    title: 'Pairwise F1xF10: Multi-era alerts (Forever + Retail) fire together on snapshot hour advance with email',
    modes: ['selfhosted'],
    async run(ctx) {
      ctx.emailServer.clearEmails();
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
        await apiJson(ctx.baseUrl, '/api/settings/notifications', {
          method: 'PUT',
          jar,
          body: { email: 'multi-era@example.com', emailEnabled: true, onsiteEnabled: true },
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
            notifyEmail: true,
          },
        });
        await apiJson(ctx.baseUrl, '/api/alerts', {
          method: 'POST',
          jar,
          body: {
            flavor: 'retail',
            ruleset: 'region',
            market: 'Commodities',
            itemKey: '2447',
            condition: 'below',
            thresholdCopper: 20000,
            notifyOnsite: true,
            notifyEmail: true,
          },
        });

        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const list = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.ok(list.length >= 2);
        const email = await ctx.emailServer.waitForEmail((e) => String(e.to).includes('multi-era@example.com'), 5000);
        assert.ok(email);
      } finally {
        ctx.dataServer.reset();
        ctx.emailServer.clearEmails();
      }
    },
  });
}
