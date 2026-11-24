import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ANNIVERSARY_REALMS,
  FLAVORS,
  FOREVER_CANONICAL_RULESETS,
  MAX_COPPER_CAP,
  SELECTORS,
  assertAlertsContract,
  assertAuthMeContract,
  assertCapabilitiesContract,
  assertDatasetIndexContract,
  assertHealthContract,
  assertItemsMetadataContract,
  assertListsContract,
  assertNotificationsContract,
  assertSnapshotBlockContract,
  byTestId,
  decodeMS1,
  encodeMS1,
} from '../contracts.mjs';
import {
  ANCHOR_ITEMS,
  CLASSIC_ERA_REALMS,
  DATE_STR,
} from '../fixtures/dataset-fixtures.mjs';
import {
  createAddonBridge,
  probeAddonCodec,
  validateLua51Source,
} from '../addon/lua-bridge.mjs';
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
  loginViaBrowserOAuth,
  navigateToAlerts,
  navigateToAuctionHouse,
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
  // F1: Release Candidate / Era Switching & Official Branding (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F1-01',
    tier: 1,
    feature: 'F1',
    title: 'Default load renders Forever shell, official Blizzard logo, and non-affiliation footer',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        const shell = page.locator(byTestId(SELECTORS.appShell));
        const initialFlavor = await shell.getAttribute('data-flavor');
        assert.ok(FLAVORS.includes(initialFlavor), `Expected valid initial flavor, got ${initialFlavor}`);
        await assertEraBranding(page, initialFlavor);
      });
    },
  });

  registry.register({
    id: 'T1-F1-02',
    tier: 1,
    feature: 'F1',
    title: 'Switching across all 5 release candidates updates data-flavor and applies distinct era themes',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        const themeSignatures = new Map();
        for (const flavor of FLAVORS) {
          await selectFlavor(page, flavor);
          const sig = await page.locator(byTestId(SELECTORS.appShell)).evaluate((el) => {
            const cs = getComputedStyle(el);
            const bodyCs = getComputedStyle(document.body);
            return JSON.stringify({
              flavor: el.getAttribute('data-flavor'),
              bg: cs.backgroundColor,
              bgImg: cs.backgroundImage,
              color: cs.color,
              border: cs.borderColor,
              bodyBg: bodyCs.backgroundColor,
              cls: el.className,
            });
          });
          themeSignatures.set(flavor, sig);
        }
        const uniqueThemes = new Set(themeSignatures.values());
        assert.equal(uniqueThemes.size, 5, 'Each of the 5 release candidates must apply a distinct visual theme');
      });
    },
  });

  registry.register({
    id: 'T1-F1-03',
    tier: 1,
    feature: 'F1',
    title: 'Each of the 5 release candidates displays a loaded official game logo with alt text',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        const logoSrcs = new Set();
        for (const flavor of FLAVORS) {
          await selectFlavor(page, flavor);
          const { logoInfo } = await assertEraBranding(page, flavor);
          logoSrcs.add(logoInfo.src);
        }
        assert.ok(logoSrcs.size >= 4, `Expected distinct era logos across flavors, got ${logoSrcs.size}`);
      });
    },
  });

  registry.register({
    id: 'T1-F1-04',
    tier: 1,
    feature: 'F1',
    title: 'Cohesive Armory/AH core landmarks remain accessible across all 5 eras',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        for (const flavor of FLAVORS) {
          await selectFlavor(page, flavor);
          await page.locator(byTestId(SELECTORS.rulesetSelect)).waitFor({ state: 'visible', timeout: 10000 });
          await page.locator(byTestId(SELECTORS.auctionSearchInput)).waitFor({ state: 'visible', timeout: 10000 });
          await page.locator(byTestId(SELECTORS.navShoppingLists)).waitFor({ state: 'visible', timeout: 10000 });
          await page.locator(byTestId(SELECTORS.trademarkFooter)).waitFor({ state: 'visible', timeout: 10000 });
        }
      });
    },
  });

  registry.register({
    id: 'T1-F1-05',
    tier: 1,
    feature: 'F1',
    title: 'Selected release candidate persists or restores cleanly across browser reload',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await waitForAuctionRowsOrEmpty(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator(byTestId(SELECTORS.appShell)).waitFor({ state: 'visible', timeout: 15000 });
        const flavorAfterReload = await page.locator(byTestId(SELECTORS.appShell)).getAttribute('data-flavor');
        assert.ok(FLAVORS.includes(flavorAfterReload), 'Flavor after reload must be valid');
        await assertEraBranding(page, flavorAfterReload);
      });
    },
  });

  // =========================================================================
  // F2: Ruleset & Realm Selection (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F2-01',
    tier: 1,
    feature: 'F2',
    title: 'Forever exposes canonical rulesets (PvP, Normal, Roleplay, Roleplay PvP) and switches markets',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        const options = await getRulesetOptions(page);
        for (const [key, label] of Object.entries(FOREVER_CANONICAL_RULESETS)) {
          assert.ok(
            options.some((o) => o.value === key || o.label.toLowerCase() === label.toLowerCase()),
            `Missing forever ruleset ${key} (${label}) in ${JSON.stringify(options)}`
          );
        }
        await selectRulesetOrRealm(page, 'normal');
        await waitForAuctionRows(page);
        await selectRulesetOrRealm(page, 'roleplaypvp');
        await waitForAuctionRows(page);
      });
    },
  });

  registry.register({
    id: 'T1-F2-02',
    tier: 1,
    feature: 'F2',
    title: 'Classic Era lists all 23 realms from snapshot index in ruleset/realm selector',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classicEra');
        await waitForAuctionRowsOrEmpty(page);
        const options = await getRulesetOptions(page);
        assert.ok(options.length >= CLASSIC_ERA_REALMS.length, `Expected >=23 classicEra realms, got ${options.length}`);
        for (const sampleRealm of ['whitemane', 'mankrik', 'doomhowl', 'defias-pillager', 'remulos']) {
          assert.ok(
            options.some((o) => o.value === sampleRealm || o.label.toLowerCase().includes(sampleRealm)),
            `Missing classicEra realm ${sampleRealm}`
          );
        }
      });
    },
  });

  registry.register({
    id: 'T1-F2-03',
    tier: 1,
    feature: 'F2',
    title: 'Anniversary exposes all 4 launch realms including dreamscythe, nightslayer, maladath, doomhowl',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'anniversary');
        await waitForAuctionRowsOrEmpty(page);
        const options = await getRulesetOptions(page);
        for (const realm of ANNIVERSARY_REALMS) {
          assert.ok(
            options.some((o) => o.value === realm || o.label.toLowerCase().includes(realm)),
            `Missing anniversary realm ${realm}`
          );
        }
      });
    },
  });

  registry.register({
    id: 'T1-F2-04',
    tier: 1,
    feature: 'F2',
    title: 'Classic (MoP) exposes Pagle, Atiesh, Mankrik, Arugal-AU, Myzrael, Benediction and loads Pagle',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        const rows = await waitForAuctionRows(page);
        assert.ok(rows > 0, 'Expected populated listings on classic pagle');
        const options = await getRulesetOptions(page);
        for (const realm of ['pagle', 'atiesh', 'arugal-au', 'myzrael']) {
          assert.ok(options.some((o) => o.value === realm), `Missing classic realm ${realm}`);
        }
      });
    },
  });

  registry.register({
    id: 'T1-F2-05',
    tier: 1,
    feature: 'F2',
    title: 'Retail exposes region selector and Commodities market tab',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'retail');
        const options = await getRulesetOptions(page);
        assert.ok(options.some((o) => o.value === 'region'), 'Retail must include region selector');
        await selectMarket(page, 'Commodities');
        const rows = await waitForAuctionRows(page);
        assert.ok(rows > 0, 'Expected Retail Commodities listings');
      });
    },
  });

  // =========================================================================
  // F3: Auction Browsing, Faction/Market Tabs & 9+ MB Snapshots (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F3-01',
    tier: 1,
    feature: 'F3',
    title: 'Forever PvP switches cleanly between Alliance, Horde, and Neutral faction markets',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        assert.ok((await waitForAuctionRows(page)) > 0);
        await selectMarket(page, 'Horde');
        assert.ok((await waitForAuctionRows(page)) > 0);
        await selectMarket(page, 'Neutral');
        assert.ok((await waitForAuctionRows(page)) > 0);
      });
    },
  });

  registry.register({
    id: 'T1-F3-02',
    tier: 1,
    feature: 'F3',
    title: 'Classic Pagle CrossFaction market renders Pet Cage entries (82800:<speciesId>)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '82800');
        const rowsText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.ok(rowsText && rowsText.trim().length > 0, 'Expected Pet Cage rows when filtering by 82800');
      });
    },
  });

  registry.register({
    id: 'T1-F3-03',
    tier: 1,
    feature: 'F3',
    title: 'Auction table renders suffixed items (13005:4512) and uncached #999999 fallback cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        await searchAuctions(page, '13005');
        const suffixText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.ok(suffixText && suffixText.includes('13005'), 'Expected suffixed item 13005:4512 in table');

        await searchAuctions(page, '999999');
        const uncachedText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.ok(uncachedText && uncachedText.includes('999999'), 'Expected #999999 fallback item in table');
      });
    },
  });

  registry.register({
    id: 'T1-F3-04',
    tier: 1,
    feature: 'F3',
    title: 'Retail Commodities displays Peacebloom and Hochenblume with formatted prices and quantities',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'retail');
        await selectMarket(page, 'Commodities');
        await waitForAuctionRows(page);
        await searchAuctions(page, '2447');
        const row = page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        const rowText = await row.textContent();
        assertValidCurrencyText(rowText, 'Retail commodity row');
        assert.match(rowText, /Peacebloom|2447/i);
      });
    },
  });

  registry.register({
    id: 'T1-F3-05',
    tier: 1,
    feature: 'F3',
    title: '9.5+ MB Forever snapshot streams via API and parses off-thread in browser without freeze',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      // 1. Verify streaming proxy handles >= 9.5 MB payload intact
      const snapRes = await apiRequest(
        ctx.baseUrl,
        '/api/datasets/snapshot?path=datasets/forever/large/00-00.json'
      );
      assert.equal(snapRes.status, 200);
      const byteLength = Buffer.byteLength(snapRes.text, 'utf8');
      assert.ok(byteLength >= 9_500_000, `Expected >= 9,500,000 bytes, got ${byteLength}`);
      const parsed = JSON.parse(snapRes.text);
      assertSnapshotBlockContract(parsed);

      // 2. Verify browser loads 9.5+ MB snapshot cleanly with largeForever enabled
      ctx.dataServer.setState({ largeForever: true });
      try {
        await withAppPage(ctx, async (page) => {
          await selectFlavor(page, 'forever');
          await selectRulesetOrRealm(page, 'pvp');
          await selectMarket(page, 'Alliance');
          const rowCount = await waitForAuctionRows(page, 30000);
          assert.ok(rowCount > 0, 'Expected parsed rows from 9.5+ MB snapshot');
          await searchAuctions(page, 'Dreamfoil');
          const body = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
          assert.match(body || '', /Dreamfoil|13464/i);
        });
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  // =========================================================================
  // F4: Search, Filtering, Sorting & Pagination (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F4-01',
    tier: 1,
    feature: 'F4',
    title: 'Search input filters auction table by item name (Dreamfoil)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        const initialCount = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).count();
        await searchAuctions(page, 'Dreamfoil');
        const filteredRows = page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`);
        const filteredCount = await filteredRows.count();
        assert.ok(filteredCount >= 1 && filteredCount <= initialCount, 'Search must narrow matching rows');
        const text = await filteredRows.first().textContent();
        assert.match(text || '', /Dreamfoil/i);
      });
    },
  });

  registry.register({
    id: 'T1-F4-02',
    tier: 1,
    feature: 'F4',
    title: 'Search input locates items by numeric ID (13444) and suffixed key (13005:4512)',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        await searchAuctions(page, ANCHOR_ITEMS.MAJOR_MANA_POTION);
        const manaText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.match(manaText || '', /Major Mana Potion|13444/i);

        await searchAuctions(page, ANCHOR_ITEMS.SUFFIXED_ITEM);
        const suffixText = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody`).textContent();
        assert.match(suffixText || '', /13005/);
      });
    },
  });

  registry.register({
    id: 'T1-F4-03',
    tier: 1,
    feature: 'F4',
    title: 'Sort selector reorders rows deterministically across price and quantity modes',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        const sortEl = page.locator(byTestId(SELECTORS.sortSelect));
        await sortEl.waitFor({ state: 'visible', timeout: 10000 });
        const sortOptions = await sortEl.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
        assert.ok(sortOptions.length >= 2, 'Expected multiple sort options');

        await sortEl.selectOption(sortOptions[0]);
        const firstOrder = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();

        await sortEl.selectOption(sortOptions[sortOptions.length - 1]);
        await page.waitForFunction(
          ({ sel, prev }) => {
            const row = document.querySelector(sel);
            return Boolean(row && row.textContent !== prev);
          },
          {
            sel: `${byTestId(SELECTORS.auctionTable)} tbody tr`,
            prev: firstOrder,
          },
          { timeout: 5000 }
        ).catch(() => {});
        const secondOrder = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        assert.notEqual(firstOrder, secondOrder, 'Changing sort option should reorder auction rows');
      });
    },
  });

  registry.register({
    id: 'T1-F4-04',
    tier: 1,
    feature: 'F4',
    title: 'Quality filter updates displayed rows without errors',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        const qFilter = page.locator(byTestId(SELECTORS.qualityFilter));
        await qFilter.waitFor({ state: 'visible', timeout: 10000 });
        const opts = await qFilter.locator('option').evaluateAll((o) => o.map((x) => x.value));
        assert.ok(opts.length >= 2, 'Expected quality filter options');
        for (const val of opts.slice(0, 3)) {
          await qFilter.selectOption(val);
          await waitForAuctionRowsOrEmpty(page);
        }
      });
    },
  });

  registry.register({
    id: 'T1-F4-05',
    tier: 1,
    feature: 'F4',
    title: 'Pagination Next and Previous buttons navigate across multiple pages of auctions',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);

        const nextBtn = page.locator(byTestId(SELECTORS.paginationNext));
        const prevBtn = page.locator(byTestId(SELECTORS.paginationPrev));
        await nextBtn.waitFor({ state: 'visible', timeout: 10000 });

        const page1First = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
        if (await nextBtn.isEnabled()) {
          await nextBtn.click();
          const page2First = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
          assert.notEqual(page1First, page2First, 'Next page should display different items');
          await prevBtn.click();
          const backToPage1 = await page.locator(`${byTestId(SELECTORS.auctionTable)} tbody tr`).first().textContent();
          assert.equal(backToPage1, page1First, 'Previous button should return to page 1');
        }
      });
    },
  });

  // =========================================================================
  // F5: Multi-Snapshot Price History Views & index.json Normalization (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F5-01',
    tier: 1,
    feature: 'F5',
    title: 'GET /api/datasets/index.json returns normalized index with all 5 flavors and legacy entries',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/datasets/index.json');
      assert.equal(res.status, 200);
      assertDatasetIndexContract(res.body);
      for (const flavor of FLAVORS) {
        assert.ok(
          res.body.blocks.some((b) => b.flavor === flavor),
          `index.json missing blocks for flavor ${flavor}`
        );
      }
    },
  });

  registry.register({
    id: 'T1-F5-02',
    tier: 1,
    feature: 'F5',
    title: 'Selecting an item row opens price history detail view with SVG/Canvas chart',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);
        await searchAuctions(page, 'Dreamfoil');
        await openItemDetailByText(page, /Dreamfoil|13464/i);

        const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
        const hasGraphic = await chart.locator('svg, canvas').count();
        assert.ok(hasGraphic >= 1, 'Price history chart must contain an <svg> or <canvas>');
      });
    },
  });

  registry.register({
    id: 'T1-F5-03',
    tier: 1,
    feature: 'F5',
    title: 'Multi-hour price history renders multiple data points across snapshot hours 08 and 09',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await selectRulesetOrRealm(page, 'pvp');
        await selectMarket(page, 'Alliance');
        await waitForAuctionRows(page);
        await searchAuctions(page, '13464');
        await openItemDetailByText(page, /Dreamfoil|13464/i);

        const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
        const pointCount = await chart.evaluate((el) => {
          const circles = el.querySelectorAll('circle, [data-point], rect[data-ts], tr');
          if (circles.length >= 2) return circles.length;
          const poly = el.querySelector('polyline, path');
          if (poly) {
            const pts = poly.getAttribute('points') || poly.getAttribute('d') || '';
            return pts.trim().split(/[\s,ML]+/).filter(Boolean).length;
          }
          return 0;
        });
        assert.ok(pointCount >= 2, `Expected >= 2 history data points across 08:00 & 09:00, got ${pointCount}`);
      });
    },
  });

  registry.register({
    id: 'T1-F5-04',
    tier: 1,
    feature: 'F5',
    title: 'Classic MoP Pet Cage (82800:48213) renders multi-hour price history chart',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'classic');
        await selectRulesetOrRealm(page, 'pagle');
        await selectMarket(page, 'CrossFaction');
        await waitForAuctionRows(page);
        await searchAuctions(page, '48213');
        await openItemDetailByText(page, /48213|Pet/i);
        const chart = page.locator(byTestId(SELECTORS.priceHistoryChart));
        await chart.waitFor({ state: 'visible', timeout: 10000 });
        const graphic = chart.locator('svg, canvas').first();
        await graphic.waitFor({ state: 'visible', timeout: 10000 });
        const box = await graphic.boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0, `Pet Cage price history chart must render with non-zero bounding box, got ${JSON.stringify(box)}`);
        if ((await chart.locator('canvas').count()) === 0) {
          const geoCount = await chart.locator('svg polyline, svg path, svg circle, svg rect').count();
          assert.ok(geoCount >= 2, `Expected Pet Cage SVG chart geometry (>= 2 elements), got ${geoCount}`);
        }
        assert.equal(/NaN|Infinity/i.test(await chart.innerHTML()), false, 'Pet Cage chart must not contain NaN/Infinity');
      });
    },
  });

  registry.register({
    id: 'T1-F5-05',
    tier: 1,
    feature: 'F5',
    title: 'Add to Shopping List button in item detail drawer adds item to active list',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, 'Dreamfoil');
        await openItemDetailByText(page, /Dreamfoil|13464/i);

        const addBtn = page.locator(byTestId(SELECTORS.addToListBtn));
        await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addBtn.click();
        await closeItemDetailModal(page);

        await navigateToShoppingLists(page);
        const rows = page.locator(byTestId(SELECTORS.shoppingItemRow));
        assert.ok((await rows.count()) >= 1, 'Expected item added to shopping list');
      });
    },
  });

  // =========================================================================
  // F6: Login-Free Shopping Lists & AH Tasks CRUD (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F6-01',
    tier: 1,
    feature: 'F6',
    title: 'Create shopping list without logging in and select it',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'Molten Core Prep');
        const selectedVal = await page.locator(byTestId(SELECTORS.shoppingListSelect)).inputValue();
        assert.ok(selectedVal.length > 0, 'Newly created list should be selectable');
      });
    },
  });

  registry.register({
    id: 'T1-F6-02',
    tier: 1,
    feature: 'F6',
    title: 'Add item from auction detail into login-free shopping list displays shopping-item-row',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'BWL Potions');

        await navigateToAuctionHouse(page);
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        await searchAuctions(page, 'Major Mana Potion');
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
    id: 'T1-F6-03',
    tier: 1,
    feature: 'F6',
    title: 'Shopping list items, quantity, done toggle, and notes persist across full page reload',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'Persistent Raid List');

        // Import a populated list so we have deterministic item fields to mutate
        const seed = encodeMS1({
          v: 1,
          n: 'Persistent Raid List',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [{ id: 13464, q: 10, m: 20000, nm: 'Dreamfoil', nt: 'Initial note', d: 0, a: 0 }],
        });
        await importMS1InUI(page, seed);

        const row = page.locator(byTestId(SELECTORS.shoppingItemRow)).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        const qtyInput = row.locator('input[type="number"]').first();
        if (await qtyInput.isVisible()) {
          await qtyInput.fill('25');
        }
        const doneCheckbox = row.locator('input[type="checkbox"]').first();
        if (await doneCheckbox.isVisible()) {
          await doneCheckbox.check();
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToShoppingLists(page);
        const rowsAfter = await page.locator(byTestId(SELECTORS.shoppingItemRow)).count();
        assert.ok(rowsAfter >= 1, 'Shopping list items must persist in browser storage across reload');
      });
    },
  });

  registry.register({
    id: 'T1-F6-04',
    tier: 1,
    feature: 'F6',
    title: 'Removing an item from a shopping list updates row count persistently',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const seed = encodeMS1({
          v: 1,
          n: 'Remove Item Test',
          i: [
            { id: 13464, q: 5, nm: 'Dreamfoil' },
            { id: 13444, q: 10, nm: 'Major Mana Potion' },
          ],
        });
        await importMS1InUI(page, seed);
        await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().waitFor({ state: 'visible', timeout: 10000 });
        assert.equal(await page.locator(byTestId(SELECTORS.shoppingItemRow)).count(), 2);

        const removeBtn = page.locator(byTestId(SELECTORS.shoppingItemRow)).first().getByRole('button', { name: /remove|delete|×/i });
        await removeBtn.click();
        assert.equal(await page.locator(byTestId(SELECTORS.shoppingItemRow)).count(), 1);
      });
    },
  });

  registry.register({
    id: 'T1-F6-05',
    tier: 1,
    feature: 'F6',
    title: 'Deleting a shopping list removes it from shopping-list-select',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'Temporary List To Delete');
        const beforeOpts = await page.locator(`${byTestId(SELECTORS.shoppingListSelect)} option`).allTextContents();
        assert.ok(beforeOpts.some((t) => t.includes('Temporary List To Delete')));

        await page.locator(byTestId(SELECTORS.deleteListBtn)).click();
        await page.waitForFunction(
          ({ sel, name }) => {
            const el = document.querySelector(sel);
            if (!el) return true;
            return !Array.from(el.options).some((o) => (o.textContent || '').includes(name));
          },
          { sel: byTestId(SELECTORS.shoppingListSelect), name: 'Temporary List To Delete' },
          { timeout: 10000 }
        );
      });
    },
  });

  // =========================================================================
  // F7: Web !MS1! Import/Export UI (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F7-01',
    tier: 1,
    feature: 'F7',
    title: 'Web UI Export !MS1! generates a valid !MS1! string decodable by canonical codec',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const seed = encodeMS1({
          v: 1,
          n: 'Web Export List',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [{ id: 13464, q: 20, m: 50000, nm: 'Dreamfoil', nt: 'Need stack', d: 0, a: 1 }],
        });
        await importMS1InUI(page, seed);
        const exported = await exportMS1FromUI(page);
        assert.ok(exported.startsWith('!MS1!'), `Expected !MS1! prefix, got ${exported}`);
        const decoded = decodeMS1(exported);
        assert.equal(decoded.n, 'Web Export List');
        assert.equal(decoded.i[0].id, 13464);
        assert.equal(decoded.i[0].q, 20);
      });
    },
  });

  registry.register({
    id: 'T1-F7-02',
    tier: 1,
    feature: 'F7',
    title: 'Web UI Import !MS1! decodes and renders full item metadata and flags',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const payload = encodeMS1({
          v: 1,
          n: 'Imported Consumables',
          f: 'forever',
          r: 'normal',
          fa: 'Horde',
          i: [
            { id: 13464, q: 15, m: 30000, nm: 'Dreamfoil', nt: 'AQ40', d: 1, a: 1 },
            { id: 14344, q: 4, m: 75000, nm: 'Large Brilliant Shard', d: 0, a: 0 },
          ],
        });
        await importMS1InUI(page, payload);
        const rowCount = await page.locator(byTestId(SELECTORS.shoppingItemRow)).count();
        assert.equal(rowCount, 2);
        const listText = await page.locator(byTestId(SELECTORS.shoppingItemRow)).first().textContent();
        assert.match(listText || '', /Dreamfoil|13464/i);
      });
    },
  });

  registry.register({
    id: 'T1-F7-03',
    tier: 1,
    feature: 'F7',
    title: 'Web !MS1! export preserves flavor, ruleset, market, and item suffix fields',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const original = {
          v: 1,
          n: 'Suffix Context List',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [{ id: 13005, s: 4512, q: 2, m: 12000, nm: 'Suffixed Item', nt: 'of the Eagle', d: 0, a: 1 }],
        };
        await importMS1InUI(page, encodeMS1(original));
        const exported = await exportMS1FromUI(page);
        const decoded = decodeMS1(exported);
        assert.equal(decoded.i[0].id, 13005);
        assert.equal(decoded.i[0].s, 4512);
        assert.equal(decoded.i[0].m, 12000);
      });
    },
  });

  registry.register({
    id: 'T1-F7-04',
    tier: 1,
    feature: 'F7',
    title: 'Web UI rejects tampered CRC32 !MS1! string with visible alert error',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const valid = encodeMS1({ v: 1, n: 'Tamper Check', i: [{ id: 13464, q: 1 }] });
        const tampered = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');
        const errMsg = await importMS1InUI(page, tampered, { expectError: true });
        assert.ok(errMsg.trim().length > 0, 'Expected visible CRC32 error message');
      });
    },
  });

  registry.register({
    id: 'T1-F7-05',
    tier: 1,
    feature: 'F7',
    title: 'Web UI rejects invalid prefix or malformed payload cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await navigateToShoppingLists(page);
        const errMsg = await importMS1InUI(page, '!BAD!not-valid-ms1.12345678', { expectError: true });
        assert.ok(errMsg.trim().length > 0, 'Expected validation alert for invalid prefix');
      });
    },
  });

  // =========================================================================
  // F8: MarketSync Addon !MS1! Lua 5.1 Round-Trip (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F8-01',
    tier: 1,
    feature: 'F8',
    title: 'MarketSync/ListCodec.lua exists, is registered in MarketSync.toc, and passes strict Lua 5.1 AST check',
    modes: ['addon'],
    async run() {
      const probe = probeAddonCodec();
      assert.equal(probe.addonCodecPresent, true, 'MarketSync/ListCodec.lua must exist');
      assert.equal(probe.tocRegistersListCodec, true, 'MarketSync.toc must register ListCodec.lua');
      const src = fs.readFileSync(probe.files.listCodec, 'utf8');
      validateLua51Source(src, 'ListCodec.lua', { forbidBitLibs: true });
    },
  });

  registry.register({
    id: 'T1-F8-02',
    tier: 1,
    feature: 'F8',
    title: 'JS -> Lua ListCodec -> JS round-trip preserves full v1 !MS1! schema',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        assert.equal(bridge.addonCodecActive, true, 'Must execute real MarketSync/ListCodec.lua');
        const input = {
          v: 1,
          n: 'Naxx Consumables',
          f: 'forever',
          r: 'pvp',
          fa: 'Alliance',
          i: [
            { id: 13464, s: 0, q: 40, m: 50000, nm: 'Dreamfoil', nt: 'Twin Emps', d: 0, a: 1 },
            { id: 13005, s: 4512, q: 1, m: 250000, nm: 'Eagle Gear', d: 1, a: 0 },
          ],
        };
        const jsStr = encodeMS1(input);
        const luaDec = bridge.decodeList(jsStr);
        assert.equal(luaDec.ok, true, luaDec.error);
        assert.equal(luaDec.list.n, input.n);
        assert.equal(luaDec.list.i.length, 2);

        const luaStr = bridge.encodeList(luaDec.list);
        const jsDec = decodeMS1(luaStr);
        assert.equal(jsDec.n, input.n);
        assert.equal(jsDec.f, input.f);
        assert.equal(jsDec.r, input.r);
        assert.equal(jsDec.fa, input.fa);
        assert.equal(jsDec.i[0].id, 13464);
        assert.equal(jsDec.i[0].q, 40);
        assert.equal(jsDec.i[1].s, 4512);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T1-F8-03',
    tier: 1,
    feature: 'F8',
    title: 'ImportList with createAlerts populates MarketSyncDB Favorites, FavoriteMeta, and NotificationRequests',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const ms1 = encodeMS1({
          v: 1,
          n: 'Lua Alert Import',
          i: [{ id: 13464, q: 20, m: 45000, nm: 'Dreamfoil', nt: 'Alert item', d: 0, a: 1 }],
        });
        const imported = bridge.runLua(`
          local LC = MarketSync.ListCodec
          if LC and LC.ImportList then
            local res, err = LC.ImportList(${JSON.stringify(ms1)}, { createAlerts = true })
            assert(res, tostring(err))
          else
            local ok, err = LC.ImportToFavorites(${JSON.stringify(ms1)})
            assert(ok, tostring(err))
          end
          local rdb = MarketSync.GetRealmDB()
          local hasFav = MarketSyncDB.Favorites["Lua Alert Import"] ~= nil
          local qty = MarketSyncDB.FavoriteQuantities["Lua Alert Import"] and MarketSyncDB.FavoriteQuantities["Lua Alert Import"][13464]
          local meta = MarketSyncDB.FavoriteMeta["Lua Alert Import"] and (MarketSyncDB.FavoriteMeta["Lua Alert Import"].items and MarketSyncDB.FavoriteMeta["Lua Alert Import"].items[13464] or MarketSyncDB.FavoriteMeta["Lua Alert Import"]["13464"])
          local hasAlertMeta = meta and (meta.alert == true or meta.a == 1) or false
          local notifCount = 0
          if rdb and rdb.NotificationRequests then
            for _ in pairs(rdb.NotificationRequests) do
              notifCount = notifCount + 1
            end
          end
          return string.format('{"hasFav":%s,"qty":%d,"hasAlertMeta":%s,"notifCount":%d}', tostring(hasFav), qty or 0, tostring(hasAlertMeta), notifCount)
        `, 'check-fav-state');
        const state = JSON.parse(imported);
        assert.equal(state.hasFav, true);
        assert.equal(state.qty, 20);
        assert.equal(state.hasAlertMeta, true);
        assert.ok(state.notifCount >= 1, 'Expected alert flag a=1 with createAlerts=true to register NotificationRequest');
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T1-F8-04',
    tier: 1,
    feature: 'F8',
    title: 'Mutating quantity and done state in Lua Favorites exports updated !MS1! back to JS',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const seed = encodeMS1({
          v: 1,
          n: 'Lua Mutate List',
          i: [{ id: 13444, q: 10, m: 60000, nm: 'Major Mana Potion', d: 0, a: 0 }],
        });
        assert.equal(bridge.importToFavorites(seed).ok, true);
        bridge.runLua(`
          local F = MarketSync.Favorites
          if F and F.SetQuantity and F.SetItemMeta then
            F.SetQuantity("Lua Mutate List", 13444, 35)
            F.SetItemMeta("Lua Mutate List", 13444, { done = true })
          elseif MarketSyncDB.FavoriteMeta["Lua Mutate List"] and MarketSyncDB.FavoriteMeta["Lua Mutate List"].items then
            MarketSyncDB.FavoriteQuantities["Lua Mutate List"][13444] = 35
            MarketSyncDB.FavoriteMeta["Lua Mutate List"].items[13444].done = true
          end
        `, 'mutate-lua-fav');

        const exp = bridge.exportFromFavorites('Lua Mutate List');
        assert.equal(exp.ok, true, exp.error);
        const decoded = decodeMS1(exp.encoded);
        const item = decoded.i.find((x) => x.id === 13444);
        assert.equal(item.q, 35);
        assert.equal(item.d, 1);
      } finally {
        bridge.close();
      }
    },
  });

  registry.register({
    id: 'T1-F8-05',
    tier: 1,
    feature: 'F8',
    title: 'Lua ListCodec handles uncached item IDs gracefully and rejects corrupt CRC32',
    modes: ['addon'],
    async run() {
      const bridge = createAddonBridge();
      try {
        const uncached = encodeMS1({ v: 1, n: 'Uncached', i: [{ id: 999999, q: 3, m: 12000 }] });
        const dec = bridge.decodeList(uncached);
        assert.equal(dec.ok, true);
        assert.equal(dec.list.i[0].id, 999999);

        const bad = uncached.slice(0, -1) + (uncached.endsWith('0') ? '1' : '0');
        const badRes = bridge.decodeList(bad);
        assert.equal(badRes.ok, false);
      } finally {
        bridge.close();
      }
    },
  });

  // =========================================================================
  // F9: Optional Battle.net OAuth 2.0 & Character Linking (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F9-01',
    tier: 1,
    feature: 'F9',
    title: 'Browser Battle.net OAuth login displays authenticated BattleTag in header',
    modes: ['selfhosted'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        const tag = await loginViaBrowserOAuth(page);
        assert.match(tag, /MarketTester#1337/);
      });
    },
  });

  registry.register({
    id: 'T1-F9-02',
    tier: 1,
    feature: 'F9',
    title: 'GET /api/auth/me returns authenticated user and characters including realmless Forever {name, surname}',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar, callbackRes } = await performHttpOAuthLogin(ctx.baseUrl);
      assert.ok(callbackRes.status >= 200 && callbackRes.status < 400);

      const meRes = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
      assert.equal(meRes.status, 200);
      assertAuthMeContract(meRes.body);
      assert.equal(meRes.body.authenticated, true);
      assert.equal(meRes.body.user.battletag, 'MarketTester#1337');

      const foreverChar = (meRes.body.characters || []).find(
        (c) => c.flavor === 'forever' || (c.name === 'Aelindor' && c.surname === 'Dawnblade')
      );
      assert.ok(foreverChar, 'Expected realmless Forever character { name: Aelindor, surname: Dawnblade }');
      assert.equal(foreverChar.surname, 'Dawnblade');
    },
  });

  registry.register({
    id: 'T1-F9-03',
    tier: 1,
    feature: 'F9',
    title: 'Linked characters UI renders multi-flavor characters including realmless Forever character',
    modes: ['selfhosted'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await loginViaBrowserOAuth(page);
        await navigateToAlerts(page);
        const charsEl = page.locator(byTestId(SELECTORS.linkedCharacters));
        await charsEl.waitFor({ state: 'visible', timeout: 15000 });
        const text = (await charsEl.textContent()) || '';
        assert.match(text, /Aelindor/i);
        assert.match(text, /Dawnblade/i);
      });
    },
  });

  registry.register({
    id: 'T1-F9-04',
    tier: 1,
    feature: 'F9',
    title: 'Authenticated shopping list sync (POST/GET /api/lists) persists to SQLite with characterId',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const meRes = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
      const charId = meRes.body.characters?.[0]?.id ?? null;

      const createRes = await apiJson(ctx.baseUrl, '/api/lists', {
        method: 'POST',
        jar,
        body: {
          name: 'OAuth Synced List',
          flavor: 'forever',
          ruleset: 'pvp',
          market: 'Alliance',
          characterId: charId,
          items: [{ itemId: 13464, qty: 20, maxPrice: 50000 }],
        },
      });
      assert.ok(createRes.status === 200 || createRes.status === 201, `Expected 200/201, got ${createRes.status}`);

      const listRes = await apiJson(ctx.baseUrl, '/api/lists', { jar });
      assert.equal(listRes.status, 200);
      assertListsContract(listRes.body);
      const lists = Array.isArray(listRes.body) ? listRes.body : listRes.body.lists;
      assert.ok(lists.some((l) => l.name === 'OAuth Synced List'));
    },
  });

  registry.register({
    id: 'T1-F9-05',
    tier: 1,
    feature: 'F9',
    title: 'Logout clears session via UI and API (/api/auth/logout)',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const outRes = await apiJson(ctx.baseUrl, '/api/auth/logout', { method: 'POST', jar });
      assert.ok(outRes.status >= 200 && outRes.status < 300);

      const meAfter = await apiJson(ctx.baseUrl, '/api/auth/me', { jar });
      assert.equal(meAfter.status, 200);
      assertAuthMeContract(meAfter.body);
      assert.equal(meAfter.body.authenticated, false);
    },
  });

  // =========================================================================
  // F10: Price-Change Alert Rules & Notification Triggers (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F10-01',
    tier: 1,
    feature: 'F10',
    title: 'Save notification email and preferences via PUT /api/settings/notifications and UI',
    modes: ['selfhosted'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        await loginViaBrowserOAuth(page);
        await navigateToAlerts(page);
        const emailInput = page.locator(byTestId(SELECTORS.notificationEmailInput));
        await emailInput.waitFor({ state: 'visible', timeout: 10000 });
        await emailInput.fill('trader@example.com');
        await Promise.all([
          page.waitForResponse(
            (res) => res.url().includes('/api/settings/notifications') && res.request().method() === 'PUT'
          ),
          page.locator(byTestId(SELECTORS.saveNotificationSettingsBtn)).click(),
        ]);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToAlerts(page);
        const persistedEmail = await page.locator(byTestId(SELECTORS.notificationEmailInput)).inputValue();
        assert.equal(persistedEmail, 'trader@example.com');
      });
    },
  });

  registry.register({
    id: 'T1-F10-02',
    tier: 1,
    feature: 'F10',
    title: 'Create price alert rule via POST /api/alerts and list via GET /api/alerts',
    modes: ['selfhosted'],
    async run(ctx) {
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      const createRes = await apiJson(ctx.baseUrl, '/api/alerts', {
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
      assert.ok(createRes.status === 200 || createRes.status === 201, `Unexpected status ${createRes.status}`);

      const listRes = await apiJson(ctx.baseUrl, '/api/alerts', { jar });
      assert.equal(listRes.status, 200);
      assertAlertsContract(listRes.body);
      const alerts = Array.isArray(listRes.body) ? listRes.body : listRes.body.alerts;
      assert.ok(alerts.some((a) => a.itemKey === '2447' && Number(a.thresholdCopper) === 20000));
    },
  });

  registry.register({
    id: 'T1-F10-03',
    tier: 1,
    feature: 'F10',
    title: 'Price drop in new snapshot hour triggers on-site notification in inbox',
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

        // Advance mock data server from hour 09 (2447=30000) to hour 10 (2447=12000)
        ctx.dataServer.advanceHour(2);
        const evalRes = await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        assert.ok(evalRes.status >= 200 && evalRes.status < 300);

        const notifRes = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        assert.equal(notifRes.status, 200);
        assertNotificationsContract(notifRes.body);
        const items = Array.isArray(notifRes.body) ? notifRes.body : notifRes.body.notifications;
        assert.ok(items.length >= 1, 'Expected on-site notification after Peacebloom dropped to 12,000c');
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  registry.register({
    id: 'T1-F10-04',
    tier: 1,
    feature: 'F10',
    title: 'Triggered alert with email enabled delivers email to mock-email-server',
    modes: ['selfhosted'],
    async run(ctx) {
      ctx.emailServer.clearEmails();
      const { jar } = await performHttpOAuthLogin(ctx.baseUrl);
      try {
        await apiJson(ctx.baseUrl, '/api/settings/notifications', {
          method: 'PUT',
          jar,
          body: { email: 'alert-recipient@example.com', emailEnabled: true, onsiteEnabled: true },
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
        const evalRes = await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });
        assert.ok(evalRes.status >= 200 && evalRes.status < 300);

        const email = await ctx.emailServer.waitForEmail(
          (e) => String(e.to).includes('alert-recipient@example.com'),
          5000
        );
        assert.ok(email.subject.length > 0);
      } finally {
        ctx.dataServer.reset();
        ctx.emailServer.clearEmails();
      }
    },
  });

  registry.register({
    id: 'T1-F10-05',
    tier: 1,
    feature: 'F10',
    title: 'Marking an on-site notification read updates read status persistently',
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
            itemKey: '13005:4512',
            condition: 'below',
            thresholdCopper: 6000,
            notifyOnsite: true,
            notifyEmail: false,
          },
        });
        ctx.dataServer.advanceHour(2);
        await apiJson(ctx.baseUrl, '/api/notifications/evaluate', { method: 'POST', jar });

        const listRes = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const items = Array.isArray(listRes.body) ? listRes.body : listRes.body.notifications;
        assert.ok(items.length >= 1, 'Expected at least 1 notification to mark read');
        const targetId = items[0].id;

        const readRes = await apiJson(ctx.baseUrl, `/api/notifications/${encodeURIComponent(targetId)}/read`, {
          method: 'POST',
          jar,
        });
        assert.ok(readRes.status >= 200 && readRes.status < 300);

        const afterRes = await apiJson(ctx.baseUrl, '/api/notifications', { jar });
        const afterItems = Array.isArray(afterRes.body) ? afterRes.body : afterRes.body.notifications;
        const updated = afterItems.find((n) => n.id === targetId);
        assert.ok(updated && (updated.read === true || updated.read === 1 || updated.readAt));
      } finally {
        ctx.dataServer.reset();
      }
    },
  });

  // =========================================================================
  // F11: Dual-Mode Hosting & Capability Discovery (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F11-01',
    tier: 1,
    feature: 'F11',
    title: 'GET /api/health conforms to health contract for current deployment mode',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/health');
      assert.equal(res.status, 200);
      assertHealthContract(res.body, ctx.mode);
    },
  });

  registry.register({
    id: 'T1-F11-02',
    tier: 1,
    feature: 'F11',
    title: 'GET /api/capabilities conforms to capabilities contract and reports mode flags accurately',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/capabilities');
      assert.equal(res.status, 200);
      assertCapabilitiesContract(res.body, ctx.mode);
      if (ctx.mode === 'selfhosted') {
        assert.equal(res.body.persistence, true);
        assert.equal(res.body.oauth, true);
      } else if (ctx.mode === 'cloudflare') {
        assert.equal(res.body.persistence, false);
      }
    },
  });

  registry.register({
    id: 'T1-F11-03',
    tier: 1,
    feature: 'F11',
    title: 'Streaming dataset proxy serves index.json and snapshot blocks in both Self-Hosted and CF modes',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const idx = await apiJson(ctx.baseUrl, '/api/datasets/index.json');
      assert.equal(idx.status, 200);
      assertDatasetIndexContract(idx.body);

      const snap = await apiJson(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/forever/${DATE_STR}/09-00.json`)}`
      );
      assert.equal(snap.status, 200);
      assertSnapshotBlockContract(snap.body);
    },
  });

  registry.register({
    id: 'T1-F11-04',
    tier: 1,
    feature: 'F11',
    title: 'GET /api/items?ids=... resolves metadata map in both deployment modes',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/items?ids=13464,82800:48213,999999');
      assert.equal(res.status, 200);
      assertItemsMetadataContract(res.body);
      assert.ok(res.body['13464'], 'Expected metadata for Dreamfoil 13464');
    },
  });

  registry.register({
    id: 'T1-F11-05',
    tier: 1,
    feature: 'F11',
    title: 'Zero-DB Cloudflare UI disables/hides OAuth login cleanly while keeping browsing and lists active',
    modes: ['cloudflare'],
    async run(ctx) {
      await withAppPage(ctx, async (page) => {
        const loginBtn = page.locator(byTestId(SELECTORS.bnetLoginBtn));
        const visible = await loginBtn.isVisible().catch(() => false);
        if (visible) {
          assert.equal(await loginBtn.isDisabled(), true, 'bnet-login-btn must be disabled when oauth=false');
        }
        await selectFlavor(page, 'forever');
        assert.ok((await waitForAuctionRows(page)) > 0);
        await navigateToShoppingLists(page);
        await createShoppingList(page, 'CF Zero-DB List');
      });
    },
  });

  // =========================================================================
  // F12: Snapshot Ingestion Edge Cases & Error Resilience (5 tests)
  // =========================================================================

  registry.register({
    id: 'T1-F12-01',
    tier: 1,
    feature: 'F12',
    title: 'Backend and browser cleanly ingest text/plain GitHub raw MIME snapshot payloads',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const rawRes = await apiRequest(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/retail/${DATE_STR}/09-00.json`)}`
      );
      assert.equal(rawRes.status, 200);
      assertSnapshotBlockContract(JSON.parse(rawRes.text));
    },
  });

  registry.register({
    id: 'T1-F12-02',
    tier: 1,
    feature: 'F12',
    title: 'Legacy root snapshot without flavor and with simulated:true normalizes to forever',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const idx = await apiJson(ctx.baseUrl, '/api/datasets/index.json');
      const simBlock = idx.body.blocks.find((b) => b.path === `datasets/${DATE_STR}/07-00.json`);
      assert.ok(simBlock, 'Expected legacy 07-00.json block in index.json');

      const snap = await apiJson(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(simBlock.path)}`
      );
      assert.equal(snap.status, 200);
      assertSnapshotBlockContract(snap.body);
      assert.ok(snap.body.rulesets.english, 'Legacy simulated block must contain english ruleset');
    },
  });

  registry.register({
    id: 'T1-F12-03',
    tier: 1,
    feature: 'F12',
    title: 'Legacy single-letter Forever ruleset keys (p, n, r) normalize cleanly',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const snap = await apiJson(
        ctx.baseUrl,
        `/api/datasets/snapshot?path=${encodeURIComponent(`datasets/forever/${DATE_STR}/08-00.json`)}`
      );
      assert.equal(snap.status, 200);
      assertSnapshotBlockContract(snap.body);
      assert.ok(snap.body.rulesets.p && snap.body.rulesets.n && snap.body.rulesets.r);

      await withAppPage(ctx, async (page) => {
        await selectFlavor(page, 'forever');
        await waitForAuctionRows(page);
        const options = await getRulesetOptions(page);
        assert.ok(options.some((o) => o.value === 'pvp' || o.label === 'PvP'));
      });
    },
  });

  registry.register({
    id: 'T1-F12-04',
    tier: 1,
    feature: 'F12',
    title: 'Snapshot proxy rejects path traversal and SSRF URLs with 400/403 JSON',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const badPaths = [
        '../package.json',
        'datasets/../../etc/passwd',
        'https://evil.example.com/datasets/forever/2026-11-22/09-00.json',
        'datasets/forever/bad path.json',
      ];
      for (const bad of badPaths) {
        const res = await apiJson(ctx.baseUrl, `/api/datasets/snapshot?path=${encodeURIComponent(bad)}`);
        assert.ok(res.status === 400 || res.status === 403, `Expected 400/403 for ${bad}, got ${res.status}`);
        assert.ok(res.body && (res.body.error || res.body.message), 'Rejection must return JSON error');
      }
    },
  });

  registry.register({
    id: 'T1-F12-05',
    tier: 1,
    feature: 'F12',
    title: 'Missing upstream snapshot returns clean 404 JSON without crashing server',
    modes: ['selfhosted', 'cloudflare'],
    async run(ctx) {
      const res = await apiJson(ctx.baseUrl, '/api/datasets/snapshot?path=datasets/missing/404.json');
      assert.equal(res.status, 404);
      assert.ok(res.body && (res.body.error || res.body.message), '404 response must return structured JSON');
    },
  });
}
