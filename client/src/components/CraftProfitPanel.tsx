import { useEffect, useMemo, useState } from 'react';
import { getWowheadItemUrl, type FlavorId } from '@marketsync/shared';
import {
  createCraftEvaluator, CRAFT_SALE_FEE, loadRecipeCatalog,
  type CraftMaterial, type CraftQuotes, type CraftStrategy, type RecipeCatalog,
} from '../lib/craftProfit.js';
import { snapshotClient } from '../lib/snapshotClient.js';
import { CopperDisplay } from './CopperDisplay.js';

const PAGE_SIZE = 40;
const EMPTY_QUOTES: CraftQuotes = {};
const sources: Record<CraftMaterial['source'], string> = {
  auction: 'Buy at auction', vendor: 'Buy from vendor', craft: 'Craft',
  surplus: 'Use surplus', missing: 'Price or supply unavailable',
};
const strategies: Record<CraftStrategy, string> = {
  lowest: 'Lowest quoted cost', buy: 'Buy reagents', craft: 'Craft components',
};

function Amount({ value }: { value: number | null }) {
  if (value === null) return <span aria-label="Unavailable">—</span>;
  return <span>{value < 0 ? '−' : ''}<CopperDisplay copper={Math.abs(value)} /></span>;
}

function Materials({ materials, catalog }: { materials: CraftMaterial[]; catalog: RecipeCatalog }) {
  return (
    <ul className="ms-craft-tree">
      {materials.map((material) => (
        <li key={material.itemId}>
          <div className="ms-craft-material">
            <div>
              <a href={getWowheadItemUrl(material.itemId, catalog.flavor)} target="_blank" rel="noreferrer"
                data-disable-wowhead-touch-tooltip="true">
                {catalog.items[material.itemId] ?? `Item #${material.itemId}`}
              </a>
              <span> × {material.quantity.toLocaleString()}</span>
              <small>
                {material.craft
                  ? `Craft ${material.craft.batches.toLocaleString()} × ${material.craft.name} · yields ${material.craft.output.toLocaleString()}`
                  : sources[material.source]}
                {material.reused ? ` · ${material.reused.toLocaleString()} from surplus` : ''}
              </small>
            </div>
            <Amount value={material.cost} />
          </div>
          {material.craft && <Materials materials={material.craft.materials} catalog={catalog} />}
        </li>
      ))}
    </ul>
  );
}

export function CraftProfitPanel({ flavor, path, partitionKey, faction }: {
  flavor: FlavorId; path: string; partitionKey: string; faction: string;
}) {
  const [catalogState, setCatalogState] = useState<{ flavor: FlavorId; catalog?: RecipeCatalog; error?: string }>();
  const [quoteState, setQuoteState] = useState<{ key: string; quotes?: CraftQuotes; error?: string }>();
  const [professionId, setProfessionId] = useState(171);
  const [search, setSearch] = useState('');
  const [batches, setBatches] = useState(1);
  const [strategy, setStrategy] = useState<CraftStrategy>('lowest');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<number>();
  const marketKey = JSON.stringify([path, flavor, partitionKey, faction]);

  useEffect(() => {
    let current = true;
    void loadRecipeCatalog(flavor).then((catalog) => {
      if (current) setCatalogState({ flavor, catalog });
    }).catch((error: Error) => {
      if (current) setCatalogState({ flavor, error: error.message });
    });
    return () => { current = false; };
  }, [flavor]);

  useEffect(() => {
    if (!path) return;
    let current = true;
    void snapshotClient.getCraftQuotes({ flavor, path, partitionKey, faction }).then((quotes) => {
      if (current) setQuoteState({ key: marketKey, quotes });
    }).catch((error: Error) => {
      if (current) setQuoteState({ key: marketKey, error: error.message });
    });
    return () => { current = false; };
  }, [flavor, path, partitionKey, faction, marketKey]);

  const catalog = catalogState?.flavor === flavor ? catalogState.catalog : undefined;
  const quotes = !path ? EMPTY_QUOTES : quoteState?.key === marketKey ? quoteState.quotes : undefined;
  const error = (catalogState?.flavor === flavor ? catalogState.error : undefined) ??
    (quoteState?.key === marketKey ? quoteState.error : undefined);
  const profession = catalog?.professions.find((entry) => entry.id === professionId) ??
    catalog?.professions.find((entry) => entry.recipeCount > 0);
  const evaluate = useMemo(() => catalog && quotes ? createCraftEvaluator(catalog, quotes) : undefined, [catalog, quotes]);
  const results = useMemo(() => {
    if (!catalog || !evaluate || !profession) return [];
    const query = search.trim().toLowerCase();
    return catalog.recipes
      .filter((recipe) => recipe.profession === profession.id)
      .filter((recipe) => !query || recipe.name.toLowerCase().includes(query) ||
        catalog.items[recipe.itemId]?.toLowerCase().includes(query) ||
        recipe.reagents.some(([itemId]) => catalog.items[itemId]?.toLowerCase().includes(query)))
      .map((recipe) => evaluate(recipe, batches, strategy))
      .sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || a.recipe.name.localeCompare(b.recipe.name));
  }, [catalog, evaluate, profession, search, batches, strategy]);
  const pricedCount = results.filter((result) => result.profit !== null).length;

  return (
    <section className="ms-panel ms-craft-profit" aria-label="Profession profitability">
      <header className="ms-craft-heading">
        <h2>Profession profitability</h2>
        <p>Compare finished items with the cost of buying reagents or crafting each component.</p>
      </header>
      {error ? <p role="alert">{error}</p> : !catalog ? <p role="status">Loading recipes…</p> : (
        <>
          <div className="ms-craft-controls">
            <label>Profession
              <select className="ms-select" value={profession?.id ?? ''} onChange={(event) => {
                setProfessionId(Number(event.target.value)); setLimit(PAGE_SIZE); setExpandedId(undefined);
              }}>
                {catalog.professions.map((entry) => <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.recipeCount})
                </option>)}
              </select>
            </label>
            <label>Reagent strategy
              <select className="ms-select" value={strategy} onChange={(event) => setStrategy(event.target.value as CraftStrategy)}>
                {Object.entries(strategies).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </select>
            </label>
            <label>Crafts
              <input className="ms-input" type="number" min={1} max={999} value={batches}
                onChange={(event) => setBatches(Math.max(1, Math.min(999, Math.trunc(Number(event.target.value)) || 1)))} />
            </label>
            <label>Find by recipe or material
              <input className="ms-input" type="search" value={search}
                onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} />
            </label>
          </div>
          <p className="ms-craft-note">
            Build {catalog.build} · Fixed-reagent crafts with a known item yield
            {profession?.unsupportedCount ? ` · ${profession.unsupportedCount} other recipe entries excluded` : ''}
          </p>
          <p className="ms-craft-note">
            Estimates use the selected auction house’s lowest listed unit prices, known vendor prices and a {CRAFT_SALE_FEE}% sale cut.
            Profit requires prices for the output and every reagent in the plan.
          </p>
          {!path && <p role="status">No auction capture is available for this edition.</p>}
          {!quotes ? <p role="status">Loading auction prices…</p>
            : !results.length ? <p>No fixed-yield recipes match this selection.</p> : (
            <>
              <div className="ms-craft-results-label">{results.length.toLocaleString()} recipes · {pricedCount.toLocaleString()} priced</div>
              <div className="ms-craft-list">
                {results.slice(0, limit).map((entry) => {
                  const expanded = entry.recipe.id === expandedId;
                  return (
                    <article key={entry.recipe.id} className="ms-craft-recipe">
                      <button type="button" className="ms-craft-recipe-button" aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? undefined : entry.recipe.id)}>
                        <span className="ms-craft-recipe-name"><strong>{entry.recipe.name}</strong><small>{entry.output.toLocaleString()} crafted</small></span>
                        <span><small>Materials</small><Amount value={entry.cost} /></span>
                        <span><small>Net sale</small><Amount value={entry.netSale} /></span>
                        <span className={entry.profit === null ? '' : entry.profit >= 0 ? 'is-profit' : 'is-loss'}>
                          <small>Profit</small><Amount value={entry.profit} />
                        </span>
                      </button>
                      {expanded && (
                        <div className="ms-craft-breakdown">
                          <div className="ms-craft-breakdown-heading">
                            <h3>Crafting chain</h3>
                            {entry.roi !== null && <span>{Math.round(entry.roi).toLocaleString()}% return on cost</span>}
                            <a href={getWowheadItemUrl(entry.recipe.itemId, flavor)} target="_blank" rel="noreferrer"
                              data-disable-wowhead-touch-tooltip="true">View crafted item ↗</a>
                          </div>
                          <Materials materials={entry.materials} catalog={catalog} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              {limit < results.length && (
                <button type="button" className="ms-btn ms-btn-secondary ms-craft-more"
                  onClick={() => setLimit((visible) => visible + PAGE_SIZE)}>Show more recipes</button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
