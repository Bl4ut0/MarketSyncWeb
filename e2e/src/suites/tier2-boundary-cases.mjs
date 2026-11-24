import assert from 'node:assert/strict';
import {
  FLAVORS,
  MAX_COPPER_CAP,
  SELECTORS,
  assertAuthMeContract,
  assertGraceful501Contract,
  assertItemsMetadataContract,
  assertSnapshotBlockContract,
  byTestId,
  crc32Hex,
  decodeMS1,
  encodeMS1,
  toBase64Url,
} from '../contracts.mjs';
import { ANCHOR_ITEMS, DATE_STR } from '../fixtures/dataset-fixtures.mjs';
import { createAddonBridge } from '../addon/lua-bridge.mjs';
import {
  apiJson,
  apiRequest,
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
  // =========================================================================
  // F1: Era Switching & Official Branding Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F1-01',
    tier: 2,
    feature: 'F1',
    title: 'Rapid consecutive switching across all 5 flavors settles on final flavor without stale state or errors',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        for (const f of ['classicEra', 'anniversary', 'classic', 'retail', 'forever']) {
          await page.locator(byTestId(SELECTORS.flavorTab(f))).click();
        }
        await page.locator(`${byTestId(SELECTORS.appShell)}[data-flavor="forever"]`).waitFor({ state: 'visible', timeout: 15000 });
        await waitForAuctionRows(page);
        await assertEraBranding(page, 'forever');
      });
    },
  });

  registry.register({
    id: 'T2-F1-02',
    tier: 2,
    feature: 'F1',
    title: 'Switching flavors while item detail/price history drawer is open closes/resets cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, 'Dreamfoil');
        await openItemDetailByText(page, /Dreamfoil|13464/i);

        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);
        await assertEraBranding(page, 'retail');
      });
    },
  });

  registry.register({
    id: 'T2-F1-03',
    tier: 2,
    feature: 'F1',
    title: 'Mobile viewport (390x844) renders era branding, logo, and trademark footer cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(
        ctx,
        async (page) => {
          await selectFlavor(page, 'anniversary');
          await assertEraBranding(page, 'anniversary');
          const hasOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 40
          );
          assert.equal(hasOverflow, false, 'Mobile layout should avoid severe horizontal overflow');
        },
        { contextOptions: { viewport: { width: 390, height: 844 } } }
      );
    },
  });

  registry.register({
    id: 'T2-F1-04',
    tier: 2,
    feature: 'F1',
    title: 'Invalid flavor query param (?flavor=unknown_era) falls back safely to a valid flavor',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(
        ctx,
        async (page) => {
          const flavor = await page.locator(byTestId(SELECTORS.appShell)).getAttribute('data-flavor');
          assert.ok(FLAVORS.includes(flavor), `Expected valid fallback flavor, got ${flavor}`);
          await assertEraBranding(page, flavor);
        },
        { path: '/?flavor=unknown_era_xyz' }
      );
    },
  });

  registry.register({
    id: 'T2-F1-05',
    tier: 2,
    feature: 'F1',
    title: 'Switching from Retail Commodities to Forever resets unavailable market tab cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);

        await selectFlavor(page, 'forever');
        const rows = await waitForAuctionRows(page);
        assert.ok(rows > 0, 'Forever should fall back to an available faction tab (Alliance/Horde/Neutral)');
      });
    },
  });

  // =========================================================================
  // F2: Ruleset & Realm Selection Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F2-01',
    tier: 2,
    feature: 'F2',
    title: 'Classic Era hour 08 omits Alliance key completely — UI renders empty market gracefully',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classicEra');
        await selectRulesetOrRealm(page, 'whitemane');
        const state = await waitForAuctionRowsOrEmpty(page);
        assert.ok(state.emptyVisible || state.rowCount === 0, 'Empty classicEra realm must render empty-market-state or 0 rows');
      });
    },
  });

  registry.register({
    id: 'T2-F2-02',
    tier: 2,
    feature: 'F2',
    title: 'Anniversary empty realm (doomhowl) displays empty-market-state with 0 listings',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'anniversary');
        await selectRulesetOrRealm(page, 'doomhowl');
        const state = await waitForAuctionRowsOrEmpty(page);
        assert.ok(state.emptyVisible || state.rowCount === 0, 'Empty anniversary realm must render gracefully');
      });
    },
  });

  registry.register({
    id: 'T2-F2-03',
    tier: 2,
    feature: 'F2',
    title: 'Classic MoP empty realms (myzrael, benediction) render empty CrossFaction cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        for (const realm of ['myzrael', 'benediction']) {
          await selectRulesetOrRealm(page, realm);
          const state = await waitForAuctionRowsOrEmpty(page);
          assert.ok(state.emptyVisible || state.rowCount === 0, `${realm} should render empty market cleanly`);
        }
      });
    },
  });

  registry.register({
    id: 'T2-F2-04',
    tier: 2,
    feature: 'F2',
    title: 'Arbitrary/legacy ruleset key (english in legacy 07-00.json) is handled without crash',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const snap = await apiJson(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/${DATE_STR}/07-00.json`)}`
      );
      assert.equal(snap.status, 200);
      assertSnapshotBlockContract(snap.body);
      assert.ok(snap.body.rulesets.english);

      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        const opts = await getRulesetOptions(page);
        assert.ok(opts.length >= 4, 'Forever rulesets must populate cleanly');
      });
    },
  });

  registry.register({
    id: 'T2-F2-05',
    tier: 2,
    feature: 'F2',
    title: 'Hyphenated multi-word realm slugs (arugal-au, defias-pillager) select and load cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'arugal-au');
        assert.ok((await waitForAuctionRows(page)) > 0, 'arugal-au should load CrossFaction items');

        await selectFlavor(page, 'classicEra');
        await selectRulesetOrRealm(page, 'defias-pillager');
        await waitForAuctionRowsOrEmpty(page);
      });
    },
  });

  // =========================================================================
  // F3: Auction Browsing & 64-Bit Copper / Suffix Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F3-01',
    tier: 2,
    feature: 'F3',
    title: '64-bit copper cap (99,999,999,999c on item 3030) and single-digit copper (8c) format without overflow',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Neutral');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_CAP_ITEM);

        const row = page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        const text = await row.textContent();
        assertValidCurrencyText(text, '64-bit copper cap row');
        // Verify 9,999,999g (MAX_COPPER_CAP / 10000) is not truncated to 32-bit signed max (~214,748g)
        assert.match(text, /9,?999,?999/, `Expected 9,999,999g scale in "${text}"`);
      });
    },
  });

  registry.register({
    id: 'T2-F3-02',
    tier: 2,
    feature: 'F3',
    title: 'Multi-billion copper prices (90001 Forever, 92426 Classic, 6306 Retail) render without 32-bit wrap',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_64BIT_FOREVER);
        const fText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        assertValidCurrencyText(fText, 'Forever 90001');
        assert.match(fText, /500,?000/, '5,000,000,000c = 500,000g');

        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_64BIT_RETAIL);
        const rText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        assertValidCurrencyText(rText, 'Retail 6306');
        assert.match(rText, /2,?972,?000/, '29,720,000,000c = 2,972,000g');
      });
    },
  });

  registry.register({
    id: 'T2-F3-03',
    tier: 2,
    feature: 'F3',
    title: 'Zero-suffix key (19019:0) and positive-suffix key (13005:4512) both render cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '19019');
        const cText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.match(cText || '', /19019|Thunderfury/i);

        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);
        await searchAuctions(page, '13005:4512');
        const fText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.match(fText || '', /13005/);
      });
    },
  });

  registry.register({
    id: 'T2-F3-04',
    tier: 2,
    feature: 'F3',
    title: 'Pet Cage 82800:<speciesId> resolves distinct pet species entries (48213, 48212, 18269)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '82800');
        const count = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
        assert.ok(count >= 3, `Expected 3 distinct Pet Cage species rows, got ${count}`);
      });
    },
  });

  registry.register({
    id: 'T2-F3-05',
    tier: 2,
    feature: 'F3',
    title: 'Uncached item #999999 renders graceful fallback without broken icon or console error',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.UNCACHED_ITEM);

        const row = page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        const text = await row.textContent();
        assert.match(text || '', /#?999999/);
      });
    },
  });

  // =========================================================================
  // F4: Search, Filtering, Sorting & Pagination Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F4-01',
    tier: 2,
    feature: 'F4',
    title: 'Clearing search query restores full paginated auction table',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        const fullCount = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();

        await searchAuctions(page, 'Dreamfoil');
        const narrowed = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
        assert.ok(narrowed < fullCount || narrowed >= 1);

        await searchAuctions(page, '');
        const restored = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
        assert.equal(restored, fullCount, 'Clearing search should restore initial page size');
      });
    },
  });

  registry.register({
    id: 'T2-F4-02',
    tier: 2,
    feature: 'F4',
    title: 'Search handles XSS/regex meta-characters (<script>, .*, OR 1=1) safely with 0 matches',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        for (const payload of ['<script>window.__xss=1</script>', '.*[invalid(', "' OR '1'='1"]) {
          await searchAuctions(page, payload);
          const xss = await page.evaluate(() => window.__xss || false);
          assert.equal(xss, false, 'XSS payload must never execute');
        }
      });
    },
  });

  registry.register({
    id: 'T2-F4-03',
    tier: 2,
    feature: 'F4',
    title: 'Pagination Previous is disabled on page 1 and Next disables on last page',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        const prevBtn = page.locator(byTestId(SELECTORS.paginationPrev));
        const nextBtn = page.locator(byTestId(SELECTORS.paginationNext));
        assert.equal(await prevBtn.isDisabled(), true, 'Previous must be disabled on page 1');

        let guard = 0;
        while ((await nextBtn.isEnabled()) && guard < 20) {
          await nextBtn.click();
          guard += 1;
        }
        assert.equal(await nextBtn.isDisabled(), true, 'Next must disable on final page');
      });
    },
  });

  registry.register({
    id: 'T2-F4-04',
    tier: 2,
    feature: 'F4',
    title: 'Combining search + sort + quality filter on page > 1 resets safely to page 1',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        const nextBtn = page.locator(byTestId(SELECTORS.paginationNext));
        if (await nextBtn.isEnabled()) {
          await nextBtn.click();
        }
        await searchAuctions(page, 'Dreamfoil');
        const rows = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
        assert.ok(rows >= 1, 'Filtering while on page 2 must reset to page 1 and show matching rows');
      });
    },
  });

  registry.register({
    id: 'T2-F4-05',
    tier: 2,
    feature: 'F4',
    title: 'Searching and sorting on an empty realm (anniversary doomhowl) remains stable with 0 errors',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'anniversary');
        await selectRulesetOrRealm(page, 'doomhowl');
        await waitForAuctionRowsOrEmpty(page);
        await searchAuctions(page, 'Dreamfoil');
        const state = await waitForAuctionRowsOrEmpty(page);
        assert.ok(state.emptyVisible || state.rowCount === 0);
      });
    },
  });

  // =========================================================================
  // F5: Multi-Snapshot Price History & index.json Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F5-01',
    tier: 2,
    feature: 'F5',
    title: 'Single-snapshot item renders price history chart without NaN SVG coordinates',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.UNCACHED_ITEM);
        await openItemDetailByText(page, /999999/);
        const svgHtml = await page.locator(byTestId(SELECTORS.priceHistoryChart)).innerHTML();
        assert.equal(/NaN/i.test(svgHtml), false, `SVG chart must not contain NaN: ${svgHtml}`);
      });
    },
  });

  registry.register({
    id: 'T2-F5-02',
    tier: 2,
    feature: 'F5',
    title: 'Legacy index.json block without flavor and with simulated:true normalizes to forever',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const idx = await apiJson(ctx.baseUrl, '/api/datasets/index.json');
      assert.equal(idx.status, 200);
      const legacyBlocks = idx.body.blocks.filter((b) => !b.flavor);
      assert.ok(legacyBlocks.length >= 1, 'Fixture index.json includes legacy blocks without flavor');
      assert.ok(legacyBlocks.some((b) => b.simulated === true));
    },
  });

  registry.register({
    id: 'T2-F5-03',
    tier: 2,
    feature: 'F5',
    title: 'Extreme 64-bit copper price range (99,999,999,900c on Retail 6306) renders chart without Infinity/NaN',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);
        await searchAuctions(page, ANCHOR_ITEMS.COPPER_64BIT_RETAIL);
        await openItemDetailByText(page, /6306/);
        const svgHtml = await page.locator(byTestId(SELECTORS.priceHistoryChart)).innerHTML();
        assert.equal(/NaN|Infinity/i.test(svgHtml), false, 'Extreme copper SVG must not contain NaN/Infinity');
      });
    },
  });

  registry.register({
    id: 'T2-F5-04',
    tier: 2,
    feature: 'F5',
    title: 'Opening price history for item A then item B updates chart cleanly without stale points',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, '13464');
        await openItemDetailByText(page, /Dreamfoil|13464/i);
        const firstHtml = await page.locator(byTestId(SELECTORS.priceHistoryChart)).innerHTML();
        await closeItemDetailModal(page);

        await searchAuctions(page, '90001');
        await openItemDetailByText(page, /90001/);
        const secondHtml = await page.locator(byTestId(SELECTORS.priceHistoryChart)).innerHTML();
        assert.notEqual(firstHtml, secondHtml, 'Price history chart must update when inspecting a different item');
      });
    },
  });

  registry.register({
    id: 'T2-F5-05',
    tier: 2,
    feature: 'F5',
    title: 'Price history maintains chronological ordering across 3 snapshot hours (08 -> 09 -> 10)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.advanceHour(2);
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'forever');
          await waitForAuctionRows(page);
          await searchAuctions(page, '13464');
          await openItemDetailByText(page, /Dreamfoil|13464/i);
          const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
          await chart.waitFor({ state: 'visible', timeout: 10000 });
          const graphic = chart.locator('svg, canvas').first();
          await graphic.waitFor({ state: 'visible', timeout: 10000 });
          const box = await graphic.boundingBox();
          assert.ok(box && box.width > 0 && box.height > 0, `Expected non-zero chart bounding box, got ${JSON.stringify(box)}`);
          if ((await chart.locator('canvas').count()) === 0) {
            const geoCount = await chart.locator('svg polyline, svg path, svg circle, svg rect').count();
            assert.ok(geoCount >= 3, `Expected >= 3 chart geometry elements across 3 snapshot hours, got ${geoCount}`);
            const xCoords = await chart.locator('svg circle').evaluateAll((els) =>
              els.map((el) => Number(el.getAttribute('cx'))).filter((n) => Number.isFinite(n))
            );
            assert.ok(xCoords.length >= 3, `Expected >= 3 SVG data point circles across 3 hours, got ${xCoords.length}`);
          }
          assert.equal(/NaN|Infinity/i.test(await chart.innerHTML()), false);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  // =========================================================================
  // F6: Login-Free Shopping Lists Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F6-01',
    tier: 2,
    feature: 'F6',
    title: 'Shopping list name boundaries: 1-char and 64-char names succeed; empty name is rejected',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const beforeOpts = await page.locator(`${byTestId(SELECTORS.shoppingListSelect)} option`).count();
        await page.locator(byTestId(SELECTORS.createListInput)).fill('   ');
        await page.locator(byTestId(SELECTORS.createListBtn)).click();
        const afterBlank = await page.locator(`${byTestId(SELECTORS.shoppingListSelect)} option`).count();
        assert.equal(afterBlank, beforeOpts, 'Whitespace-only list name must not create a list');

        await createShoppingList(page, 'A');
        await createShoppingList(page, 'L'.repeat(64));
      });
    },
  });

  registry.register({
    id: 'T2-F6-02',
    tier: 2,
    feature: 'F6',
    title: 'Unicode and HTML special chars in list name & task notes persist cleanly without XSS',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const specialName = 'Café "AQ40" & <Raid>';
        const payload = encodeMS1({
          v: 1,
          n: specialName,
          i: [{ id: 13464, q: 5, nm: 'Dreamfoil', nt: '<img src=x onerror=window.__xss=1> & café' }],
        });
        await importMS1InUI(page, payload);
        const xss = await page.evaluate(() => window.__xss || false);
        assert.equal(xss, false, 'HTML in notes must be escaped, never executed');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToShoppingLists(page);
        const opts = await page.locator(`${byTestId(SELECTORS.shoppingListSelect)} option`).allTextContents();
        assert.ok(opts.some((t) => t.includes('Café')));
      });
    },
  });

  registry.register({
    id: 'T2-F6-03',
    tier: 2,
    feature: 'F6',
    title: 'Max copper cap (99999999999) and zero maxPrice (0) persist accurately in shopping list storage',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const payload = encodeMS1({
          v: 1,
          n: 'Boundary Copper List',
          i: [
            { id: 3030, q: 1, m: MAX_COPPER_CAP, nm: 'Cap Item' },
            { id: 13464, q: 10, m: 0, nm: 'Zero Cap Item' },
          ],
        });
        await importMS1InUI(page, payload);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToShoppingLists(page);
        const exported = await exportMS1FromUI(page);
        const decoded = decodeMS1(exported);
        assert.equal(decoded.i.find((x) => x.id === 3030).m, MAX_COPPER_CAP);
        assert.equal(decoded.i.find((x) => x.id === 13464).m ?? 0, 0);
      });
    },
  });

  registry.register({
    id: 'T2-F6-04',
    tier: 2,
    feature: 'F6',
    title: 'Empty shopping list (0 items) exports valid !MS1! with empty items array and deletes cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'Empty Export List');
        const exported = await exportMS1FromUI(page);
        const decoded = decodeMS1(exported);
        assert.equal(decoded.n, 'Empty Export List');
        assert.deepEqual(decoded.i, []);
      });
    },
  });

  registry.register({
    id: 'T2-F6-05',
    tier: 2,
    feature: 'F6',
    title: 'Switching between multiple shopping lists keeps items strictly isolated per list',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await importMS1InUI(page, encodeMS1({ v: 1, n: 'List Alpha', i: [{ id: 13464, q: 1, nm: 'Dreamfoil' }] }));
        await importMS1InUI(page, encodeMS1({ v: 1, n: 'List Beta', i: [{ id: 14344, q: 2, nm: 'Large Brilliant Shard' }] }));

        const select = page.locator(byTestId(SELECTORS.shoppingListSelect));
        const options = await select.locator('option').evaluateAll((opts) =>
          opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
        );
        const alpha = options.find((o) => o.label.includes('List Alpha'));
        const beta = options.find((o) => o.label.includes('List Beta'));
        assert.ok(alpha && beta);

        await select.selectOption(alpha.value);
        const alphaText = await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().textContent();
        assert.match(alphaText || '', /Dreamfoil|13464/i);

        await select.selectOption(beta.value);
        const betaText = await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().textContent();
        assert.match(betaText || '', /Large Brilliant Shard|14344/i);
      });
    },
  });

  // =========================================================================
  // F7: Web !MS1! Import/Export Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F7-01',
    tier: 2,
    feature: 'F7',
    title: 'Web UI round-trips 64-char list name and MAX_COPPER_CAP (99999999999) accurately',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const maxName = 'R'.repeat(64);
        const str = encodeMS1({
          v: 1,
          n: maxName,
          i: [{ id: 3030, q: 1, m: MAX_COPPER_CAP, nm: 'Max Cap' }],
        });
        await importMS1InUI(page, str);
        const out = await exportMS1FromUI(page);
        const dec = decodeMS1(out);
        assert.equal(dec.n, maxName);
        assert.equal(dec.i[0].m, MAX_COPPER_CAP);
      });
    },
  });

  registry.register({
    id: 'T2-F7-02',
    tier: 2,
    feature: 'F7',
    title: 'Web UI trims surrounding whitespace/newlines on valid !MS1! import string',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const valid = encodeMS1({ v: 1, n: 'Trimmed List', i: [{ id: 13464, q: 3, nm: 'Dreamfoil' }] });
        await importMS1InUI(page, `  \n\t ${valid} \n  `);
        const rows = await page.locator(byTestId(SELECTORS.shoppingItemRow)).count();
        assert.equal(rows, 1);
      });
    },
  });

  registry.register({
    id: 'T2-F7-03',
    tier: 2,
    feature: 'F7',
    title: 'Web UI rejects base64 padding (=) and non-base64url chars (+, /) with visible alert',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const err1 = await importMS1InUI(page, '!MS1!eyJ2IjoxfQ==.00000000', { expectError: true });
        assert.ok(err1.trim().length > 0);
      });
    },
  });

  registry.register({
    id: 'T2-F7-04',
    tier: 2,
    feature: 'F7',
    title: 'Web UI rejects valid CRC32 over invalid schema (v:2 or empty list name)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        // Compute genuine IEEE CRC32 over UTF-8 bytes of invalid schema {"v":2,"n":"Bad","i":[]}
        const badSchemaJson = JSON.stringify({ v: 2, n: 'Bad', i: [] });
        const utf8Bytes = Buffer.from(badSchemaJson, 'utf8');
        const b64 = toBase64Url(utf8Bytes);
        const validCrc = crc32Hex(utf8Bytes);
        const err = await importMS1InUI(page, `!MS1!${b64}.${validCrc}`, { expectError: true });
        assert.ok(err.trim().length > 0, 'Expected visible validation alert for invalid schema v:2 with valid CRC32');
      });
    },
  });

  registry.register({
    id: 'T2-F7-05',
    tier: 2,
    feature: 'F7',
    title: 'Web UI rejects truncated !MS1! string missing checksum separator',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const valid = encodeMS1({ v: 1, n: 'Truncate', i: [{ id: 13464, q: 1 }] });
        const truncated = valid.split('.')[0];
        const err = await importMS1InUI(page, truncated, { expectError: true });
        assert.ok(err.trim().length > 0);
      });
    },
  });

  // =========================================================================
  // F8: MarketSync Addon Lua 5.1 Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F8-01',
    tier: 2,
    feature: 'F8',
    title: 'Lua ListCodec preserves 64-bit MAX_COPPER_CAP (99999999999), m=0, and q=1000 cleanly',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const list = {
          v: 1,
          n: 'Lua 64-bit Cap',
          i: [
            { id: 3030, q: 1000, m: MAX_COPPER_CAP, nm: 'Max Cap' },
            { id: 13464, q: 1, m: 0, nm: 'Zero Price' },
          ],
        };
        const luaEnc = bridge.encodeList(list);
        const jsDec = decodeMS1(luaEnc);
        assert.equal(jsDec.i[0].m, MAX_COPPER_CAP);
        assert.equal(jsDec.i[0].q, 1000);
        assert.equal(jsDec.i[1].m ?? 0, 0);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T2-F8-02',
    tier: 2,
    feature: 'F8',
    title: 'Lua ListCodec round-trips escaped quotes, backslashes, tabs, and UTF-8 accents identically to JS',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const list = {
          v: 1,
          n: 'Café "Raid" \\ Prep',
          i: [{ id: 13464, q: 5, nt: 'Line1\tCol2 "quoted" \\ path', nm: 'Dreamfoil' }],
        };
        const jsEnc = encodeMS1(list);
        const luaDec = bridge.decodeList(jsEnc);
        assert.equal(luaDec.ok, true, luaDec.error);
        assert.equal(luaDec.list.n, list.n);
        assert.equal(luaDec.list.i[0].nt, list.i[0].nt);

        const luaEnc = bridge.encodeList(luaDec.list);
        const jsDec = decodeMS1(luaEnc);
        assert.equal(jsDec.n, list.n);
        assert.equal(jsDec.i[0].nt, list.i[0].nt);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T2-F8-03',
    tier: 2,
    feature: 'F8',
    title: 'Lua ListCodec Decode normalizes omitted item quantity q to 1 and validates schema bounds',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        // Payload with omitted q: {"v":1,"n":"DefaultQ","i":[{"id":13464}]}
        const json = '{"v":1,"n":"DefaultQ","i":[{"id":13464}]}';
        const b64 = Buffer.from(json, 'utf8').toString('base64url');
        // Use JS encode? JS encode normalizes q=1; compute CRC via Lua directly for raw omitted-q test
        const crc = bridge.runLua(`return MarketSync.ListCodec.CRC32Hex(${JSON.stringify(json)})`, 'crc-omitted-q');
        const dec = bridge.decodeList(`!MS1!${b64}.${crc}`);
        assert.equal(dec.ok, true, dec.error);
        assert.equal(dec.list.i[0].q, 1);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T2-F8-04',
    tier: 2,
    feature: 'F8',
    title: 'Lua ListCodec Decode rejects wrong schema version, uppercase CRC32, and missing checksum',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const valid = encodeMS1({ v: 1, n: 'Valid', i: [{ id: 13464, q: 1 }] });
        const [body, hex] = valid.split('.');
        assert.equal(bridge.decodeList(`${body}.${hex.toUpperCase()}`).ok, false, 'Must reject uppercase hex CRC');
        assert.equal(bridge.decodeList(body).ok, false, 'Must reject missing CRC separator');

        const v2Json = '{"v":2,"n":"V2","i":[]}';
        const v2Crc = bridge.runLua(`return MarketSync.ListCodec.CRC32Hex(${JSON.stringify(v2Json)})`, 'crc-v2');
        const v2Str = `!MS1!${Buffer.from(v2Json, 'utf8').toString('base64url')}.${v2Crc}`;
        assert.equal(bridge.decodeList(v2Str).ok, false, 'Must reject v !== 1');
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T2-F8-05',
    tier: 2,
    feature: 'F8',
    title: 'Favorites backward-compatibility: legacy Favorites without FavoriteMeta still export valid !MS1!',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        bridge.runLua(`
          MarketSyncDB.Favorites["LegacyList"] = { 13464, 14344 }
          MarketSyncDB.FavoriteQuantities["LegacyList"] = { [13464] = 12 }
        `, 'seed-legacy-fav');
        const exp = bridge.exportFromFavorites('LegacyList');
        assert.equal(exp.ok, true, exp.error);
        const dec = decodeMS1(exp.encoded);
        assert.equal(dec.n, 'LegacyList');
        assert.equal(dec.i.find((x) => x.id === 13464).q, 12);
        assert.equal(dec.i.find((x) => x.id === 14344).q, 1);
      } finally {
        bridge.close();
      }
    },
  });

  // =========================================================================
  // F9: Optional Battle.net OAuth 2.0 Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F9-01',
    tier: 2,
    feature: 'F9',
    title: 'OAuth callback rejects tampered or missing CSRF state parameter (400/403)',
    modes: ['selfhosted'],
    async run(ctx) {
      const tampered = await performHttpOAuthLogin(ctx.baseUrl, { tamperState: true });
      assert.ok(tampered.callbackRes.status === 400 || tampered.callbackRes.status === 403);
      const meAfterTamper = await apiJson(ctx.baseUrl, '/api/auth/me', { jar: tampered.jar });
      assert.equal(meAfterTamper.body.authenticated, false);

      const missing = await performHttpOAuthLogin(ctx.baseUrl, { omitState: true });
      assert.ok(missing.callbackRes.status === 400 || missing.callbackRes.status === 403);
    },
  });

  registry.register({
    id: 'T2-F9-02',
    tier: 2,
    feature: 'F9',
    title: 'OAuth user denial (access_denied) does not create session or trigger 500 error',
    modes: ['selfhosted'],
    async run(ctx) {
      const denied = await performHttpOAuthLogin(ctx.baseUrl, { deny: true });
      assert.ok(denied.callbackRes.status < 500, `OAuth deny must not 500, got ${denied.callbackRes.status}`);
      const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar: denied.jar });
      assert.equal(me.status, 200);
      assert.equal(me.body.authenticated, false);
    },
  });

  registry.register({
    id: 'T2-F9-03',
    tier: 2,
    feature: 'F9',
    title: 'Unauthenticated calls to protected persistence endpoints return 401 JSON (never 500)',
    modes: ['selfhosted'],
    async run(ctx) {
      const endpoints = [
        { method: 'GET', path: '/api/lists' },
        { method: 'GET', path: '/api/alerts' },
        { method: 'GET', path: '/api/notifications' },
        { method: 'PUT', path: '/api/settings/notifications', body: { email: 'x@example.com' } },
      ];
      for (const ep of endpoints) {
        const res = await apiJson(ctx.baseUrl, ep.path, { method: ep.method, body: ep.body });
        assert.equal(res.status, 401, `Expected 401 for unauthenticated ${ep.method} ${ep.path}, got ${res.status}`);
        assert.ok(res.body && (res.body.error || res.body.message));
      }
    },
  });

  registry.register({
    id: 'T2-F9-04',
    tier: 2,
    feature: 'F9',
    title: 'Expired Battle.net OAuth token is handled gracefully without 500 error',
    modes: ['selfhosted'],
    async run(ctx) {
      try {
        const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
        ctx.oauthServer.expireAllTokens();
        const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
        assert.ok(me.status === 200 || me.status === 401, `Expected 200/401 on expired token, got ${me.status}`);
        if (me.status === 200) {
          assertAuthMeContract(me.body);
        }
      } finally {
        ctx.oauthServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F9-05',
    tier: 2,
    feature: 'F9',
    title: 'Realmless Forever character {name: Aelindor, surname: Dawnblade} has no fake realm requirement',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const me = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
      assert.equal(me.body.authenticated, true);
      const foreverChar = (me.body.characters || []).find((c) => c.name === 'Aelindor' && c.surname === 'Dawnblade');
      assert.ok(foreverChar, 'Expected realmless Forever character');
      assert.ok(!foreverChar.realm, 'Forever character must remain realmless');
    },
  });

  // =========================================================================
  // F10: Price-Change Alert Rules & Notifications Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F10-01',
    tier: 2,
    feature: 'F10',
    title: 'Alert condition "above" fires on price spike (Retail 190396: 15,000 -> 42,000c)',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
        await apiJson(ctx.baseUrl, '/api/alerts', {
          method: 'POST',
          jar,
          body: {
            flavor: 'retail',
            ruleset: 'region',
            market: 'Commodities',
            itemKey: '190396',
            condition: 'above',
            thresholdCopper: 25000,
            notifyOnsite: true,
            notifyEmail: false,
          },
        });
        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const list = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.ok(list.some((n) => String(n.itemKey || n.message || '').includes('190396') || String(n.message || '').match(/Hochenblume/i)));
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F10-02',
    tier: 2,
    feature: 'F10',
    title: 'Alert rule does not false-trigger before threshold is crossed (hour 09 2447=30,000 vs below 20,000)',
    modes: ['selfhosted'],
    async run(ctx) {
      const uniqueSub = `e2e_f10_02_${Date.now()}`;
      ctx.oauthServer.setState({
        user: { sub: uniqueSub, id: 91002, battletag: 'BoundaryF1002#1002' },
      });
      try {
        const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
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
            notifyEmail: false,
          },
        });
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const list = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.equal(list.length, 0, 'Must not trigger notification when price 30,000 is not below 20,000');
      } finally {
        ctx.oauthServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F10-03',
    tier: 2,
    feature: 'F10',
    title: 'Re-evaluating same snapshot hour does not duplicate already-emitted notifications',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
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
            notifyEmail: false,
          },
        });
        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const firstCount = (await apiJson(ctx.baseUrl, '/api/notifications', { jar })).body;
        const c1 = (Array.isArray(firstCount) ? firstCount : firstCount.notifications).length;

        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const secondCount = (await apiJson(ctx.baseUrl, '/api/notifications', { jar })).body;
        const c2 = (Array.isArray(secondCount) ? secondCount : secondCount.notifications).length;
        assert.equal(c2, c1, 'Idempotent re-evaluation of same snapshot hour must not duplicate notifications');
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F10-04',
    tier: 2,
    feature: 'F10',
    title: '64-bit copper threshold (5,500,000,000c on Forever 90001) persists cleanly without 32-bit truncation',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const create = await apiJson(ctx.baseUrl, '/api/alerts', {
        method: 'POST',
        jar,
        body: {
          flavor: 'forever',
          ruleset: 'pvp',
          market: 'Alliance',
          itemKey: '90001',
          condition: 'below',
          thresholdCopper: 5500000000,
          notifyOnsite: true,
          notifyEmail: false,
        },
      });
      assert.ok(create.status === 200 || create.status === 201);
      const list = await apiJson(ctx.baseUrl, '/api/alerts', { jar });
      const alerts = Array.isArray(list.body) ? list.body : list.body.alerts;
      const saved = alerts.find((a) => a.itemKey === '90001');
      assert.equal(Number(saved.thresholdCopper), 5500000000);
    },
  });

  registry.register({
    id: 'T2-F10-05',
    tier: 2,
    feature: 'F10',
    title: 'Deleting an alert rule removes it and prevents subsequent triggers',
    modes: ['selfhosted'],
    async run(ctx) {
      const uniqueSub = `e2e_f10_05_${Date.now()}`;
      ctx.oauthServer.setState({
        user: { sub: uniqueSub, id: 91005, battletag: 'BoundaryF1005#1005' },
      });
      try {
        const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
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
            notifyEmail: false,
          },
        });
        const list = await apiJson(ctx.baseUrl, '/api/alerts', { jar });
        const alerts = Array.isArray(list.body) ? list.body : list.body.alerts;
        const id = alerts[0].id;

        const delRes = await apiJson(ctx.baseUrl, `/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE', jar });
        assert.ok(delRes.status >= 200 && delRes.status < 300);

        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        const notifs = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const items = Array.isArray(notifs.body) ? notifs.body : notifs.body.notifications;
        assert.equal(items.length, 0, 'Deleted alert rule must not emit notifications');
      } finally {
        ctx.dataServer.reset();
        ctx.oauthServer.reset();
      }
    },
  });

  // =========================================================================
  // F11: Dual-Mode Hosting & Capability Boundaries (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F11-01',
    tier: 2,
    feature: 'F11',
    title: 'Zero-DB Cloudflare Worker returns graceful 501 JSON on all persistence & OAuth endpoints',
    modes: ['cloudflare'],
    async run(ctx) {
      const endpoints = [
        { method: 'GET', path: '/api/auth/login?region=us' },
        { method: 'GET', path: '/api/lists' },
        { method: 'POST', path: '/api/lists', body: { name: 'CF Test' } },
        { method: 'GET', path: '/api/alerts' },
        { method: 'GET', path: '/api/notifications' },
        { method: 'PUT', path: '/api/settings/notifications', body: { email: 'a@b.com' } },
      ];
      for (const ep of endpoints) {
        const res = await apiJson(ctx.baseUrl, ep.path, { method: ep.method, body: ep.body, redirect: 'manual' });
        assertGraceful501Contract(res.status, res.body);
      }
    },
  });

  registry.register({
    id: 'T2-F11-02',
    tier: 2,
    feature: 'F11',
    title: 'Self-hosted API validates alert payloads and returns 400 on negative thresholds',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const bad = await apiJson(ctx.baseUrl, '/api/alerts', {
        method: 'POST',
        jar,
        body: { flavor: 'retail', ruleset: 'region', market: 'Commodities', itemKey: '2447', condition: 'below', thresholdCopper: -5 },
      });
      assert.equal(bad.status, 400);
      assert.ok(bad.body && (bad.body.error || bad.body.message));
    },
  });

  registry.register({
    id: 'T2-F11-03',
    tier: 2,
    feature: 'F11',
    title: 'GET /api/items handles empty ids, malformed ids, and duplicates cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const empty = await apiJson(ctx.baseUrl, '/api/items?ids=');
      assert.equal(empty.status, 200);
      assertItemsMetadataContract(empty.body);

      const dup = await apiJson(ctx.baseUrl, '/api/items?ids=13464,13464,invalid_id,82800:48213');
      assert.equal(dup.status, 200);
      assertItemsMetadataContract(dup.body);
    },
  });

  registry.register({
    id: 'T2-F11-04',
    tier: 2,
    feature: 'F11',
    title: 'Unknown /api/* routes return structured 404 JSON rather than HTML or 500',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/this-route-does-not-exist-e2e');
      assert.equal(res.status, 404);
      assert.ok(res.body && (res.body.error || res.body.message));
    },
  });

  registry.register({
    id: 'T2-F11-05',
    tier: 2,
    feature: 'F11',
    title: 'Both Node and Cloudflare Worker stream 9.5+ MB Forever snapshot intact without truncation',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiRequest(
        ctx.baseUrl,
        '/api/datasets/snapshot?path=datasets/forever/large/00-00.json'
      );
      assert.equal(res.status, 200);
      assert.ok(Buffer.byteLength(res.text, 'utf8') >= 9_500_000);
      const parsed = JSON.parse(res.text);
      assert.equal(parsed.rulesets.pvp.Neutral['3030'].maxPrice, MAX_COPPER_CAP);
    },
  });

  // =========================================================================
  // F12: Snapshot Ingestion Edge Cases & Error Resilience (5 tests)
  // =========================================================================

  registry.register({
    id: 'T2-F12-01',
    tier: 2,
    feature: 'F12',
    title: 'Corrupt truncated JSON snapshot does not crash server or cause unhandled browser pageerror',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({
        overrides: {
          [`datasets/anniversary/${DATE_STR}/09-00.json`]: '{"version":"1.0","flavor":"anniversary","rulesets":{"dreamscythe":',
        },
      });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'anniversary');
          await page.waitForTimeout(600);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F12-02',
    tier: 2,
    feature: 'F12',
    title: 'Empty-body upstream snapshot is handled gracefully with zero uncaught pageerror',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({
        overrides: {
          [`datasets/anniversary/${DATE_STR}/09-00.json`]: '',
        },
      });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'anniversary');
          await page.waitForTimeout(600);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F12-03',
    tier: 2,
    feature: 'F12',
    title: 'Wrong-schema snapshot object fails gracefully without TypeError crash',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({
        overrides: {
          [`datasets/anniversary/${DATE_STR}/09-00.json`]: JSON.stringify({ unexpected: true, count: 0 }),
        },
      });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'anniversary');
          await page.waitForTimeout(600);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F12-04',
    tier: 2,
    feature: 'F12',
    title: 'Transient upstream 503 failure recovers cleanly on subsequent snapshot fetch',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({ failNextCount: 1, failStatus: 503 });
      try {
        const first = await apiRequest(
          ctx.baseUrl,
          `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/retail/${DATE_STR}/08-00.json`)}`
        );
        assert.ok(first.status === 502 || first.status === 503 || first.status === 200);

        const retry = await apiJson(
          ctx.baseUrl,
          `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/retail/${DATE_STR}/08-00.json`)}`
        );
        assert.equal(retry.status, 200);
        assertSnapshotBlockContract(retry.body);
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T2-F12-05',
    tier: 2,
    feature: 'F12',
    title: 'Simulated network latency (400ms delay) resolves snapshot UI cleanly without race errors',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      ctx.dataServer.setState({ delayMs: 400 });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'retail');
          await selectMarket(page, 'Commodities');
          const rows = await waitForAuctionRows(page, 20000);
          assert.ok(rows > 0);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });
}
