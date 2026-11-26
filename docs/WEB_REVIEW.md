# MarketSync Web Review

Scope: MarketSyncWeb client and server, compared against the MarketSync addon and the MarketSyncData packs.
Status: review only. Nothing changed, committed, or pushed.

## 1. Feature parity

| Addon feature | Web status | Notes |
|---|---|---|
| Analytics: price trends, volume, history | Present | `MarketAnalyticsPanel.tsx`, `marketAnalytics.ts` |
| Analytics: Best Buy Time | Missing | Addon `UI_Analytics.lua` computes the cheapest half-hour bucket |
| Analytics: Data Confidence | Missing | Addon shows it in the metrics card; no equivalent in web |
| Analytics: "Insufficient historical scan data" message | Missing | Web shows empty states without the reason |
| Analytics: Price Volatility | Present, different formula | See section 2 |
| Analytics: Live Scan Feed | Missing | Addon only |
| Analytics: Recent Items | Missing | Addon only |
| Favorites | Missing | Addon `Favorites.lua` |
| Shopping lists | Present | `ShoppingListsPanel.tsx`, `shoppingListStore.ts` |
| Alerts | Present | `AlertsPanel.tsx` |
| Processing (disenchant, prospect, mill, transmute) | Missing | Addon `Processing.lua`, `UI_Processing.lua`; no web equivalent found |
| Craft profit | Present | `craftProfit.ts`, `CraftProfitPanel.tsx`; see section 2 |
| Processing data export | Unclear | Web has an export modal; addon exports processing sets. Not yet checked which data each exports |
| Movers ("Volume Movers", "Mover rankings") | Web only | Not in the addon; a web addition |
| Major price surges / benefits | Web only | Not in the addon; a web addition |
| Professions | Present for all 13 addon professions | See section 3 |

Gaps to close to match the addon: Best Buy Time, Data Confidence with its insufficient-data message, Favorites, Recent Items, Live Scan Feed, and processing (disenchant, prospect, mill, transmute).

## 2. Math checks

**Craft profit (`client/src/lib/craftProfit.ts`)**
- Sale fee: 5% is applied as `floor(unitPrice × output × 95 / 100)`. This matches the addon's `MAIN_AH_CUT_PERCENT = 5` (`Processing.lua:8`).
- Vendor sale: uses `sellPrices` with no fee, matching the addon's "Vendor Shuffle" (0% cut).
- Material cost: uses the lower of auction and vendor price per unit, and chooses between buying and crafting. This is reasonable.
- ROI: `100 × profit / cost`, guarded for zero or null cost. Correct.
- Not verified: the addon's direct, ground-up, and effective cost split (`Processing.lua:2812–2841`) is not mirrored. The web gives one profit figure per strategy.

**Price volatility**
- Addon (`UI_Analytics.lua:1614–1621`): `(max − min) ÷ mean × 100`, colour bands at 10% and 25%.
- Web (`marketAnalytics.ts:176–177`): coefficient of variation, `stddev ÷ mean`. The web shows it as "±x% spread" (`MarketAnalyticsPanel.tsx:473`).
- Both are valid, but they are different numbers under the same name. The web's value will look smaller than the addon's for the same item. Pick one and label it.

**Deal percentage**
- `dealPctOfAvg = minPrice ÷ windowMedianPrice × 100` (`marketAnalytics.ts:166`). The variable name says "avg" but it uses the median. Rename it, or switch to the mean.

**Stability score**
- `(1 − min(1, cv × 2.2)) × 75 + presence × 25`, clamped to 0–100. The formula is internally consistent. The constants (2.2, 75/25 weights) are unexplained, so document them.

**Category change**
- Weighted by `log10(max(10, marketValue))` and clamped to −95%…+200%. Reasonable for a summary, but it hides large single-item moves inside the clamp.

**Volume movers (`marketAnalytics.ts:339–343`)**
- Ranked by `totalQty × log10(minPrice)`. This is a heuristic, not a measured signal. It rewards cheap, high-stock items. Label it as a heuristic in the UI, or define it more precisely.

## 3. Profession coverage

Addon professions (`Processing.lua:624–642`): Skinning, Mining, Herbalism, Alchemy, Blacksmithing, Enchanting, Engineering, Inscription, Jewelcrafting, Leatherworking, Tailoring, Cooking, First Aid.

Recipe catalog (`datasets/<flavor>/recipes.json`), recipes per profession with unsupported count:

| Profession | Forever | Classic | Classic Era | Anniversary | Retail |
|---|---|---|---|---|---|
| Alchemy | 181 / 15 | 325 / 4 | 133 / 0 | 186 / 0 | 593 / 170 |
| Blacksmithing | 419 / 87 | 797 / 44 | 313 / 2 | 385 / 0 | 1236 / 277 |
| Cooking | 128 / 5 | 274 / 1 | 89 / 1 | 116 / 1 | 479 / 161 |
| Enchanting | 29 / 233 | 24 / 343 | 47 / 153 | 31 / 192 | 95 / 847 |
| Engineering | 195 / 80 | 351 / 26 | 192 / 6 | 249 / 1 | 615 / 268 |
| First Aid | 32 / 0 | 24 / 0 | 15 / 0 | 16 / 0 | not listed |
| Inscription | not listed | 591 / 17 | not listed | not listed | 529 / 351 |
| Jewelcrafting | not listed | 614 / 257 | not listed | 261 / 0 | 1069 / 300 |
| Leatherworking | 482 / 109 | 917 / 26 | 314 / 0 | 379 / 0 | 1498 / 297 |
| Mining | 17 / 1 | 32 / 0 | 13 / 0 | 21 / 0 | 15 / 30 |
| Tailoring | 405 / 66 | 629 / 29 | 290 / 1 | 329 / 0 | 1003 / 253 |
| Herbalism, Skinning, Fishing | gathering only, 0–6 recipes | | | | |

Format: recipes / unsupported. "not listed" means the profession is missing from that catalog's profession list.

Findings:
- Every addon profession appears in at least one catalog, but **Inscription and Jewelcrafting are absent from the Forever catalog**. Forever is the flavor the current packs cover, so this is the gap you noticed.
- **Enchanting** has most of its recipes unsupported, most likely because enchants produce no item. It can't be priced by the current model. Show it as "not priced" rather than hiding it.
- The **unsupported** definition is not confirmed. I did not find the catalog builder in `MarketSyncData/scripts`. Find it before changing the numbers.

## 4. Faction selector proposal

Proposal: a top-level Alliance / Horde switch, then playstyle (Forever) or realm (Classic, Retail) underneath.

Why it fits:
- Each Forever pack is one ruleset and one faction, with Neutral included, so the selector chooses a pack directly.
- Neutral is the same in both factions, so it should appear as its own market option in every view, not as a faction choice.
- It also matches the realm model for Classic (connected realms) and Retail (region).

Points to settle before building:
- On Forever, the faction switch changes which pack loads, so it should show a loading state.
- A faction switch on Forever may need the Neutral data to stay loaded.

## 5. Recommended order

1. Confirm the unsupported definition and whether Inscription and Jewelcrafting exist for Forever.
2. Decide one volatility metric and label it in both the addon and the web.
3. Rename the deal percentage variable, or change it to the mean.
4. Build the faction selector.
5. Add the missing analytics items: Best Buy Time, Data Confidence, Favorites, Recent Items, Live Scan Feed.
6. Decide whether processing (disenchant, prospect, mill, transmute) belongs on the web.

## Not checked

- The processing export contents on both sides.
- The recipe catalog builder and its `unsupported` rule.
- The server side (`server/src/app.ts`, 1,334 lines), beyond what the client calls.
- Anything in-game. Everything above comes from reading the code.
