import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ITEM_ICON,
  getCachedWowheadTooltipMeta,
  getItemIconUrl,
  getWowheadItemUrl,
  type FlavorId,
  type WowheadTooltipMeta,
} from '@marketsync/shared';
import {
  createCraftEvaluator,
  CRAFT_SALE_FEE,
  describeUnpricedRecipes,
  loadRecipeCatalog,
  visibleProfessions,
  type CraftEstimate,
  type CraftMaterial,
  type CraftQuotes,
  type CraftStrategy,
  type RecipeCatalog,
} from '../lib/craftProfit.js';
import { snapshotClient } from '../lib/snapshotClient.js';
import { CopperDisplay } from './CopperDisplay.js';
import { ItemTooltip } from './ItemTooltip.js';

const PAGE_SIZE = 50;
const EMPTY_QUOTES: CraftQuotes = {};

const PROFESSION_ICONS: Record<number, string> = {
  40: 'ability_poisons',
  129: 'spell_holy_sealofsacrifice',
  164: 'trade_blacksmithing',
  165: 'inv_misc_armorkit_17',
  171: 'trade_alchemy',
  182: 'trade_herbalism',
  185: 'inv_misc_food_15',
  186: 'trade_mining',
  197: 'trade_tailoring',
  202: 'trade_engineering',
  333: 'trade_engraving',
  356: 'trade_fishing',
  393: 'inv_misc_pelt_wolf_01',
  755: 'inv_misc_gem_01',
  773: 'inv_inscription_tradeskill01',
  794: 'trade_archaeology',
};

const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d',
  1: '#f0f4fa',
  2: '#1eff00',
  3: '#4da3ff',
  4: '#c668ff',
  5: '#ff9429',
  6: '#e6cc80',
  7: '#00ccff',
};

const SOURCE_LABELS: Record<CraftMaterial['source'], string> = {
  auction: 'Buy AH',
  vendor: 'Vendor',
  craft: 'Craft Sub-Recipe',
  surplus: 'Surplus',
  missing: 'Unpriced',
};

const STRATEGIES: Record<CraftStrategy, string> = {
  lowest: 'Optimal (Lowest Cost)',
  buy: 'Buy All Reagents',
  craft: 'Craft Sub-Components',
};

type CraftSortKey = 'profit_desc' | 'roi_desc' | 'cost_asc' | 'name_asc';
type CraftSaleTarget = 'ah' | 'vendor';

function Amount({ value }: { value: number | null }) {
  if (value === null) return <span className="ms-muted" aria-label="Unavailable">—</span>;
  return (
    <span>
      {value < 0 ? '−' : ''}
      <CopperDisplay copper={Math.abs(value)} />
    </span>
  );
}

function collectMaterialItemIds(materials: CraftMaterial[], out: Set<number>): void {
  for (const m of materials) {
    out.add(m.itemId);
    if (m.craft) collectMaterialItemIds(m.craft.materials, out);
  }
}

interface ItemVisual {
  iconUrl: string;
  quality: number;
  tooltipHtml?: string;
}

function resolveVisual(
  itemId: number,
  flavor: FlavorId,
  quotes: CraftQuotes | undefined,
  hydrated: Record<number, WowheadTooltipMeta>,
): ItemVisual {
  const meta = hydrated[itemId] ?? getCachedWowheadTooltipMeta(itemId, flavor);
  const quote = quotes?.[itemId];
  const icon = meta?.icon ?? quote?.icon ?? DEFAULT_ITEM_ICON;
  const quality = meta?.quality ?? quote?.quality ?? 1;
  return {
    iconUrl: getItemIconUrl(icon),
    quality,
    tooltipHtml: meta?.tooltipHtml,
  };
}

function MaterialsTree({
  materials,
  catalog,
  flavor,
  quotes,
  hydrated,
  onJumpToItem,
  craftableItems,
}: {
  materials: CraftMaterial[];
  catalog: RecipeCatalog;
  flavor: FlavorId;
  quotes: CraftQuotes | undefined;
  hydrated: Record<number, WowheadTooltipMeta>;
  onJumpToItem: (itemId: number) => void;
  craftableItems: ReadonlySet<number>;
}) {
  return (
    <ul className="ms-craft-tree">
      {materials.map((material) => {
        const vis = resolveVisual(material.itemId, flavor, quotes, hydrated);
        const qColor = QUALITY_COLORS[vis.quality] ?? QUALITY_COLORS[1];
        const canJump = craftableItems.has(material.itemId);
        return (
          <li key={material.itemId}>
            <div className="ms-craft-material">
              <div className="ms-craft-mat-left">
                <img src={vis.iconUrl} alt="" className="ms-craft-mini-icon" style={{ borderColor: qColor }} />
                <div>
                  <a
                    href={getWowheadItemUrl(material.itemId, catalog.flavor)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: qColor }}
                    data-disable-wowhead-touch-tooltip="true"
                  >
                    {catalog.items[material.itemId] ?? `Item #${material.itemId}`}
                  </a>
                  <span> × {material.quantity.toLocaleString()}</span>
                  <small>
                    {material.craft
                      ? `Craft ${material.craft.batches.toLocaleString()} × ${material.craft.name} (yields ${material.craft.output.toLocaleString()})`
                      : SOURCE_LABELS[material.source]}
                    {material.reused ? ` · ${material.reused.toLocaleString()} from surplus` : ''}
                    {canJump && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="ms-craft-jump-link"
                          onClick={() => onJumpToItem(material.itemId)}
                        >
                          Inspect recipe →
                        </button>
                      </>
                    )}
                  </small>
                </div>
              </div>
              <Amount value={material.cost} />
            </div>
            {material.craft && (
              <MaterialsTree
                materials={material.craft.materials}
                catalog={catalog}
                flavor={flavor}
                quotes={quotes}
                hydrated={hydrated}
                onJumpToItem={onJumpToItem}
                craftableItems={craftableItems}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CraftProfitPanel({
  flavor,
  path,
  partitionKey,
  faction,
}: {
  flavor: FlavorId;
  path: string;
  partitionKey: string;
  faction: string;
}) {
  const [catalogState, setCatalogState] = useState<{ flavor: FlavorId; catalog?: RecipeCatalog; error?: string }>();
  const [quoteState, setQuoteState] = useState<{ key: string; quotes?: CraftQuotes; error?: string }>();
  const [hydrated, setHydrated] = useState<Record<number, WowheadTooltipMeta>>({});
  const [tooltipLoadingId, setTooltipLoadingId] = useState<number | null>(null);
  const [professionId, setProfessionId] = useState(171);
  const [search, setSearch] = useState('');
  const [batches, setBatches] = useState(1);
  const [strategy, setStrategy] = useState<CraftStrategy>('lowest');
  const [saleTarget, setSaleTarget] = useState<CraftSaleTarget>('ah');
  const [sortBy, setSortBy] = useState<CraftSortKey>('profit_desc');
  const [pricedOnly, setPricedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number>();
  const marketKey = JSON.stringify([path, flavor, partitionKey, faction]);

  useEffect(() => {
    setHydrated({});
  }, [flavor]);

  useEffect(() => {
    let current = true;
    void loadRecipeCatalog(flavor)
      .then((catalog) => {
        if (current) setCatalogState({ flavor, catalog });
      })
      .catch((error: Error) => {
        if (current) setCatalogState({ flavor, error: error.message });
      });
    return () => {
      current = false;
    };
  }, [flavor]);

  useEffect(() => {
    if (!path) return;
    let current = true;
    void snapshotClient
      .getCraftQuotes({ flavor, path, partitionKey, faction })
      .then((quotes) => {
        if (current) setQuoteState({ key: marketKey, quotes });
      })
      .catch((error: Error) => {
        if (current) setQuoteState({ key: marketKey, error: error.message });
      });
    return () => {
      current = false;
    };
  }, [flavor, path, partitionKey, faction, marketKey]);

  const catalog = catalogState?.flavor === flavor ? catalogState.catalog : undefined;
  const quotes = !path ? EMPTY_QUOTES : quoteState?.key === marketKey ? quoteState.quotes : undefined;
  const error =
    (catalogState?.flavor === flavor ? catalogState.error : undefined) ??
    (quoteState?.key === marketKey ? quoteState.error : undefined);

  const professions = useMemo(() => (catalog ? visibleProfessions(catalog) : []), [catalog]);
  const profession =
    professions.find((entry) => entry.id === professionId) ??
    professions.find((entry) => entry.recipeCount > 0) ??
    professions[0];
  const unpricedNote = profession ? describeUnpricedRecipes(profession) : null;

  const craftableItems = useMemo(() => {
    const ids = new Set<number>();
    for (const r of catalog?.recipes ?? []) ids.add(r.itemId);
    return ids;
  }, [catalog]);

  const evaluate = useMemo(
    () => (catalog && quotes ? createCraftEvaluator(catalog, quotes) : undefined),
    [catalog, quotes],
  );

  const allProfessionResults = useMemo(() => {
    if (!catalog || !evaluate || !profession) return [];
    const query = search.trim().toLowerCase();
    return catalog.recipes
      .filter((recipe) => recipe.profession === profession.id)
      .filter(
        (recipe) =>
          !query ||
          recipe.name.toLowerCase().includes(query) ||
          catalog.items[recipe.itemId]?.toLowerCase().includes(query) ||
          recipe.reagents.some(([itemId]) => catalog.items[itemId]?.toLowerCase().includes(query)),
      )
      .map((recipe) => evaluate(recipe, batches, strategy));
  }, [catalog, evaluate, profession, search, batches, strategy]);

  const pricedCount = useMemo(
    () =>
      allProfessionResults.filter((r) =>
        saleTarget === 'vendor' ? r.vendorProfit !== null : r.profit !== null,
      ).length,
    [allProfessionResults, saleTarget],
  );

  const results = useMemo(() => {
    const activeProfit = (r: CraftEstimate) => (saleTarget === 'vendor' ? r.vendorProfit : r.profit);
    const activeRoi = (r: CraftEstimate) => (saleTarget === 'vendor' ? r.vendorRoi : r.roi);
    const filtered = pricedOnly
      ? allProfessionResults.filter((r) => activeProfit(r) !== null)
      : allProfessionResults;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === 'roi_desc') {
        return (activeRoi(b) ?? -Infinity) - (activeRoi(a) ?? -Infinity) || a.recipe.name.localeCompare(b.recipe.name);
      }
      if (sortBy === 'cost_asc') {
        return (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.recipe.name.localeCompare(b.recipe.name);
      }
      if (sortBy === 'name_asc') {
        return a.recipe.name.localeCompare(b.recipe.name);
      }
      return (activeProfit(b) ?? -Infinity) - (activeProfit(a) ?? -Infinity) || a.recipe.name.localeCompare(b.recipe.name);
    });
    return sorted;
  }, [allProfessionResults, pricedOnly, saleTarget, sortBy]);

  const selectedEntry: CraftEstimate | undefined = useMemo(() => {
    if (!results.length) return undefined;
    return results.find((r) => r.recipe.id === selectedRecipeId) ?? results[0];
  }, [results, selectedRecipeId]);

  const visibleSlice = useMemo(() => results.slice(0, limit), [results, limit]);

  // Hydrate icons & item tooltip metadata for visible recipes + selected schematic
  useEffect(() => {
    if (!catalog) return;
    const needed = new Set<number>();
    for (const entry of visibleSlice.slice(0, 30)) {
      const id = entry.recipe.itemId;
      if (!getCachedWowheadTooltipMeta(id, flavor) && !quotes?.[id]?.icon) {
        needed.add(id);
      }
    }
    if (selectedEntry) {
      const outId = selectedEntry.recipe.itemId;
      if (!getCachedWowheadTooltipMeta(outId, flavor)?.tooltipHtml) {
        needed.add(outId);
      }
      const matIds = new Set<number>();
      collectMaterialItemIds(selectedEntry.materials, matIds);
      for (const id of matIds) {
        if (!getCachedWowheadTooltipMeta(id, flavor)) needed.add(id);
      }
    }
    if (needed.size === 0) return;

    let active = true;
    const targetOutId = selectedEntry?.recipe.itemId ?? null;
    if (targetOutId && needed.has(targetOutId)) setTooltipLoadingId(targetOutId);

    void snapshotClient
      .hydrateWowheadItems([...needed].slice(0, 36), flavor)
      .then((fetched) => {
        if (!active) return;
        setHydrated((prev) => ({ ...prev, ...fetched }));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setTooltipLoadingId(null);
      });
    return () => {
      active = false;
    };
  }, [catalog, flavor, visibleSlice, selectedEntry, quotes]);

  const jumpToCraftedItem = (itemId: number) => {
    if (!catalog) return;
    const match = catalog.recipes.find((r) => r.itemId === itemId);
    if (!match) return;
    if (match.profession !== profession?.id) {
      setProfessionId(match.profession);
      setSearch('');
      setPricedOnly(false);
    }
    setSelectedRecipeId(match.id);
  };

  const selectedOutputVisual = selectedEntry
    ? resolveVisual(selectedEntry.recipe.itemId, flavor, quotes, hydrated)
    : undefined;
  const selectedOutputQuote = selectedEntry ? quotes?.[selectedEntry.recipe.itemId] : undefined;
  const hasNestedCrafts = Boolean(selectedEntry?.materials.some((m) => m.craft));
  const optimalSavings =
    selectedEntry &&
    selectedEntry.cost !== null &&
    selectedEntry.directCost != null &&
    selectedEntry.directCost > selectedEntry.cost
      ? selectedEntry.directCost - selectedEntry.cost
      : 0;

  return (
    <section className="ms-panel ms-craft-profit" aria-label="Professions & Crafting Schematic">
      <header className="ms-craft-heading-row">
        <div className="ms-craft-heading">
          <h2>Professions &amp; Crafting Schematic</h2>
          <p>
            Select a profession and recipe to inspect the crafted item, required reagents, and live ground-up profit
            after the {CRAFT_SALE_FEE}% Auction House cut.
          </p>
        </div>
        {catalog && (
          <span className="ms-craft-build-badge">
            Build {catalog.build} · {results.length.toLocaleString()} recipes ({pricedCount.toLocaleString()} priced)
          </span>
        )}
      </header>

      {error ? (
        <div className="ms-alert-error" role="alert">{error}</div>
      ) : !catalog ? (
        <p role="status">Loading profession catalog…</p>
      ) : (
        <>
          {/* WoW Forever Profession Skill Strip */}
          <div className="ms-prof-strip" role="tablist" aria-label="Professions">
            {professions
              .map((entry) => {
                const active = entry.id === profession?.id;
                const iconName = PROFESSION_ICONS[entry.id] ?? DEFAULT_ITEM_ICON;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={entry.unsupportedCount
                      ? `${entry.recipeCount.toLocaleString()} priced · ${entry.unsupportedCount.toLocaleString()} not priced`
                      : undefined}
                    className={`ms-prof-pill ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      setProfessionId(entry.id);
                      setLimit(PAGE_SIZE);
                      setSelectedRecipeId(undefined);
                    }}
                  >
                    <img src={getItemIconUrl(iconName)} alt="" className="ms-prof-pill-icon" />
                    <span>{entry.name}</span>
                    <small>{entry.recipeCount}</small>
                  </button>
                );
              })}
          </div>

          {/* Search, Strategy & Sort Toolbar */}
          <div className="ms-craft-controls">
            <label className="ms-craft-search-field">
              Search recipe or reagent
              <input
                className="ms-input"
                type="search"
                placeholder="e.g. Flask, Thorium, Lionheart…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLimit(PAGE_SIZE);
                }}
              />
            </label>
            <label>
              Sale target
              <select
                className="ms-select"
                value={saleTarget}
                onChange={(event) => setSaleTarget(event.target.value as CraftSaleTarget)}
              >
                <option value="ah">Auction House (−{CRAFT_SALE_FEE}% Cut)</option>
                <option value="vendor">Bulk Vendor Shuffle (0% Cut)</option>
              </select>
            </label>
            <label>
              Reagent strategy
              <select
                className="ms-select"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value as CraftStrategy)}
              >
                {Object.entries(STRATEGIES).map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
              </select>
            </label>
            <label>
              Sort recipes
              <select
                className="ms-select"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as CraftSortKey)}
              >
                <option value="profit_desc">Highest Net Profit</option>
                <option value="roi_desc">Highest ROI %</option>
                <option value="cost_asc">Lowest Craft Cost</option>
                <option value="name_asc">Recipe Name (A–Z)</option>
              </select>
            </label>
            <div className="ms-craft-filter-toggle">
              <button
                type="button"
                className={`ms-btn ${pricedOnly ? 'ms-btn-primary' : 'ms-btn-secondary'}`}
                aria-pressed={pricedOnly}
                onClick={() => setPricedOnly((v) => !v)}
              >
                {pricedOnly ? '✓ Priced Recipes Only' : 'Show Priced Only'}
              </button>
            </div>
          </div>

          {!path && <p role="status">No auction capture is available for this edition.</p>}
          {unpricedNote && (
            <p className="ms-craft-unpriced-note" role="note" data-testid="craft-unpriced-note">
              <strong>Not priced:</strong> {unpricedNote}
            </p>
          )}
          {!quotes ? (
            <p role="status">Loading auction market quotes…</p>
          ) : !results.length ? (
            <div className="ms-empty-box" role="status">
              {profession && profession.recipeCount === 0 ? (
                <p><strong>No priced recipes</strong> in {profession.name}.</p>
              ) : (
                <>
                  <p><strong>No matching recipes</strong> in {profession?.name ?? 'this profession'}.</p>
                  <p className="ms-muted">Try clearing your search or disabling the Priced Only filter.</p>
                </>
              )}
            </div>
          ) : (
            /* WoW Forever 2-Column Professions Split Workspace */
            <div className="ms-forever-prof-workspace">
              {/* LEFT PANE: Recipe Directory */}
              <aside className="ms-forever-recipe-pane" aria-label="Recipe List">
                <div className="ms-forever-pane-header">
                  <span>{profession?.name} Recipes</span>
                  <small>{results.length.toLocaleString()} shown</small>
                </div>
                <div className="ms-forever-recipe-scroll">
                  {visibleSlice.map((entry) => {
                    const isSelected = entry.recipe.id === selectedEntry?.recipe.id;
                    const vis = resolveVisual(entry.recipe.itemId, flavor, quotes, hydrated);
                    const qColor = QUALITY_COLORS[vis.quality] ?? QUALITY_COLORS[1];
                    return (
                      <button
                        key={entry.recipe.id}
                        type="button"
                        className={`ms-forever-recipe-row ${isSelected ? 'is-selected' : ''}`}
                        aria-current={isSelected ? 'true' : undefined}
                        onClick={() => setSelectedRecipeId(entry.recipe.id)}
                      >
                        <span className="ms-forever-recipe-icon-wrap" style={{ borderColor: qColor }}>
                          <img src={vis.iconUrl} alt="" className="ms-forever-recipe-icon" />
                          {entry.recipe.yield > 1 && (
                            <span className="ms-forever-stack-count">{entry.recipe.yield}</span>
                          )}
                        </span>
                        <span className="ms-forever-recipe-title">
                          <strong style={{ color: qColor }}>
                            {catalog.items[entry.recipe.itemId] ?? entry.recipe.name}
                          </strong>
                          {catalog.items[entry.recipe.itemId] &&
                            catalog.items[entry.recipe.itemId] !== entry.recipe.name && (
                              <small>{entry.recipe.name}</small>
                            )}
                        </span>
                        {(() => {
                          const rowProfit = saleTarget === 'vendor' ? entry.vendorProfit : entry.profit;
                          const rowRoi = saleTarget === 'vendor' ? entry.vendorRoi : entry.roi;
                          return (
                            <span
                              className={`ms-forever-recipe-profit ${
                                rowProfit === null ? 'is-muted' : rowProfit >= 0 ? 'is-profit' : 'is-loss'
                              }`}
                            >
                              <Amount value={rowProfit} />
                              {rowRoi !== null && (
                                <small>{rowRoi >= 0 ? '+' : ''}{Math.round(rowRoi)}% {saleTarget === 'vendor' ? 'Vendor' : 'ROI'}</small>
                              )}
                            </span>
                          );
                        })()}
                      </button>
                    );
                  })}
                  {limit < results.length && (
                    <button
                      type="button"
                      className="ms-btn ms-btn-secondary ms-craft-more"
                      onClick={() => setLimit((visible) => visible + PAGE_SIZE)}
                    >
                      Show more ({(results.length - limit).toLocaleString()} remaining)
                    </button>
                  )}
                </div>
              </aside>

              {/* RIGHT PANE: WoW Forever Crafted Item & Reagent Schematic */}
              {selectedEntry && selectedOutputVisual && (
                <div className="ms-forever-schematic" aria-live="polite">
                  <div className="ms-forever-schematic-top">
                    <div className="ms-forever-item-hero">
                      <div
                        className="ms-forever-hero-icon-box"
                        style={{
                          borderColor: QUALITY_COLORS[selectedOutputVisual.quality] ?? '#f0f4fa',
                          boxShadow: `0 0 16px ${(QUALITY_COLORS[selectedOutputVisual.quality] ?? '#c89b3c')}38`,
                        }}
                      >
                        <img
                          src={selectedOutputVisual.iconUrl}
                          alt=""
                          className="ms-forever-hero-icon"
                        />
                        {selectedEntry.output > 1 && (
                          <span className="ms-forever-hero-qty">{selectedEntry.output.toLocaleString()}</span>
                        )}
                      </div>
                      <div className="ms-forever-hero-meta">
                        <span className="ms-forever-prof-kicker">
                          {profession?.name} · Yields {selectedEntry.recipe.yield} per craft
                        </span>
                        <h3
                          className="ms-forever-hero-name"
                          style={{ color: QUALITY_COLORS[selectedOutputVisual.quality] ?? '#f0f4fa' }}
                        >
                          {catalog.items[selectedEntry.recipe.itemId] ?? selectedEntry.recipe.name}
                        </h3>
                        <div className="ms-forever-hero-links">
                          <span className="ms-forever-supply-pill">
                            {selectedOutputQuote
                              ? `${selectedOutputQuote.quantity.toLocaleString()} available on AH`
                              : 'No active AH listings'}
                          </span>
                          {selectedEntry.vendorProfit !== null && selectedEntry.vendorProfit > 0 && (
                            <span className="ms-forever-shuffle-pill">
                              ★ Bulk Vendor Shuffle (+<CopperDisplay copper={selectedEntry.vendorProfit} />)
                            </span>
                          )}
                          <a
                            href={getWowheadItemUrl(selectedEntry.recipe.itemId, flavor)}
                            target="_blank"
                            rel="noreferrer"
                            data-disable-wowhead-touch-tooltip="true"
                          >
                            Wowhead ↗
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Quantity Stepper (Forever Craft Count) */}
                    <div className="ms-forever-qty-box">
                      <span className="ms-forever-qty-label">Craft Batches</span>
                      <div className="ms-forever-qty-stepper">
                        <button
                          type="button"
                          className="ms-btn ms-btn-secondary ms-btn-xs"
                          onClick={() => setBatches((b) => Math.max(1, b - 1))}
                          aria-label="Decrease craft batches"
                        >
                          −
                        </button>
                        <input
                          className="ms-input ms-forever-qty-input"
                          type="number"
                          min={1}
                          max={999}
                          aria-label="Craft batches"
                          value={batches}
                          onChange={(e) =>
                            setBatches(Math.max(1, Math.min(999, Math.trunc(Number(e.target.value)) || 1)))
                          }
                        />
                        <button
                          type="button"
                          className="ms-btn ms-btn-secondary ms-btn-xs"
                          onClick={() => setBatches((b) => Math.min(999, b + 1))}
                          aria-label="Increase craft batches"
                        >
                          +
                        </button>
                      </div>
                      <small>{selectedEntry.output.toLocaleString()} total items</small>
                    </div>
                  </div>

                  {/* Economics KPI Strip */}
                  <div className="ms-forever-kpi-grid">
                    <div className="ms-forever-kpi">
                      <small>Unit AH Buyout</small>
                      <strong><Amount value={selectedEntry.unitSalePrice} /></strong>
                    </div>
                    <div className="ms-forever-kpi">
                      <small>Optimal Craft Cost</small>
                      <strong><Amount value={selectedEntry.cost} /></strong>
                      {optimalSavings > 0 && (
                        <span className="ms-forever-savings-tag">
                          Saves <CopperDisplay copper={optimalSavings} /> vs direct buy
                        </span>
                      )}
                    </div>
                    <div className="ms-forever-kpi">
                      <small>Net Sale (−{CRAFT_SALE_FEE}% AH Cut)</small>
                      <strong><Amount value={selectedEntry.netSale} /></strong>
                    </div>
                    <div
                      className={`ms-forever-kpi ${
                        selectedEntry.profit === null
                          ? ''
                          : selectedEntry.profit >= 0
                            ? 'is-profit'
                            : 'is-loss'
                      }`}
                    >
                      <small>Estimated AH Profit</small>
                      <strong><Amount value={selectedEntry.profit} /></strong>
                      {selectedEntry.roi !== null && (
                        <span className="ms-forever-roi-tag">
                          {selectedEntry.roi >= 0 ? '+' : ''}
                          {Math.round(selectedEntry.roi).toLocaleString()}% ROI
                        </span>
                      )}
                    </div>
                    <div
                      className={`ms-forever-kpi ${
                        selectedEntry.vendorProfit === null
                          ? ''
                          : selectedEntry.vendorProfit >= 0
                            ? 'is-profit'
                            : 'is-loss'
                      }`}
                    >
                      <small>Bulk Vendor Shuffle (0% Cut)</small>
                      <strong><Amount value={selectedEntry.vendorProfit} /></strong>
                      <span className="ms-forever-roi-tag">
                        {selectedEntry.vendorSale !== null ? (
                          <>
                            Sells <CopperDisplay copper={selectedEntry.vendorSale} />
                            {selectedEntry.vendorRoi !== null && (
                              <> ({selectedEntry.vendorRoi >= 0 ? '+' : ''}{Math.round(selectedEntry.vendorRoi)}%)</>
                            )}
                          </>
                        ) : (
                          'Not vendorable'
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Two-Column Schematic Body: Item Tooltip Card + Reagent Slots */}
                  <div className="ms-forever-schematic-body">
                    <div className="ms-forever-item-card-section">
                      <h4>Crafted Item Preview</h4>
                      <div className="ms-forever-tooltip-card">
                        <ItemTooltip
                          html={selectedOutputVisual.tooltipHtml}
                          loading={tooltipLoadingId === selectedEntry.recipe.itemId && !selectedOutputVisual.tooltipHtml}
                        />
                      </div>
                    </div>

                    <div className="ms-forever-reagents-section">
                      <h4>Required Reagents ({selectedEntry.materials.length})</h4>
                      <div className="ms-forever-reagent-grid">
                        {selectedEntry.materials.map((mat) => {
                          const vis = resolveVisual(mat.itemId, flavor, quotes, hydrated);
                          const qColor = QUALITY_COLORS[vis.quality] ?? QUALITY_COLORS[1];
                          const canJump = craftableItems.has(mat.itemId);
                          return (
                            <div key={mat.itemId} className="ms-forever-reagent-slot">
                              <div className="ms-forever-reagent-icon-box" style={{ borderColor: qColor }}>
                                <img src={vis.iconUrl} alt="" className="ms-forever-reagent-icon" />
                                <span className="ms-forever-reagent-qty">×{mat.quantity.toLocaleString()}</span>
                              </div>
                              <div className="ms-forever-reagent-info">
                                <a
                                  href={getWowheadItemUrl(mat.itemId, flavor)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ms-forever-reagent-name"
                                  style={{ color: qColor }}
                                  data-disable-wowhead-touch-tooltip="true"
                                >
                                  {catalog.items[mat.itemId] ?? `Item #${mat.itemId}`}
                                </a>
                                <div className="ms-forever-reagent-sub">
                                  <span className={`ms-forever-src-badge is-${mat.source}`}>
                                    {mat.craft ? `Craft (${mat.craft.batches}×)` : SOURCE_LABELS[mat.source]}
                                  </span>
                                  <Amount value={mat.cost} />
                                </div>
                                {canJump && (
                                  <button
                                    type="button"
                                    className="ms-craft-jump-link"
                                    onClick={() => jumpToCraftedItem(mat.itemId)}
                                  >
                                    Open sub-recipe →
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Multi-Tier Ground-Up Crafting Tree (when sub-crafts exist) */}
                  {hasNestedCrafts && (
                    <div className="ms-craft-breakdown">
                      <div className="ms-craft-breakdown-heading">
                        <h3>Multi-Tier Ground-Up Crafting Chain</h3>
                        <span>Sub-components crafted from raw materials for optimal cost</span>
                      </div>
                      <MaterialsTree
                        materials={selectedEntry.materials}
                        catalog={catalog}
                        flavor={flavor}
                        quotes={quotes}
                        hydrated={hydrated}
                        onJumpToItem={jumpToCraftedItem}
                        craftableItems={craftableItems}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
