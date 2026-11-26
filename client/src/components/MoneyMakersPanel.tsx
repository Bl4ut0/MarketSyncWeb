import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_ITEM_ICON,
  getCachedWowheadTooltipMeta,
  getItemIconUrl,
  getWowheadItemUrl,
  type FlavorId,
} from '@marketsync/shared';
import {
  CRAFT_SALE_FEE,
  loadRecipeCatalog,
  PROFESSION_ICONS,
  type CraftQuotes,
  type RecipeCatalog,
} from '../lib/craftProfit.js';
import type { EnrichedAuctionRow } from '../lib/auctionRows.js';
import type { MarketAnalyticsPayload } from '../lib/marketAnalytics.js';
import {
  auctionToVendorFlips,
  bestOverall,
  buyLowDeals,
  craftForAuction,
  disenchantFlips,
  evaluateAllRecipes,
  isThinMarket,
  marketSignals,
  vendorCrafts,
  type MarketSignal,
  type Opportunity,
  type OpportunityKind,
} from '../lib/moneyMakers.js';
import { snapshotClient } from '../lib/snapshotClient.js';
import { CopperDisplay } from './CopperDisplay.js';

type Section = 'best' | 'craft' | 'vendorCraft' | 'vendorFlip' | 'disenchant' | 'buyLow' | 'signals';

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: 'best', label: 'Best Overall',
    blurb: 'The most profitable single actions right now, across every method below.' },
  { id: 'craft', label: 'Craft & Sell',
    blurb: `Crafts that sell on the Auction House for more than their reagents cost, after the ${CRAFT_SALE_FEE}% cut. Reagents are bought at their lowest listing or from a vendor.` },
  { id: 'vendorCraft', label: 'Vendor Crafts',
    blurb: 'Crafts whose vendor sell price beats their bought reagent cost. Merchants pay instantly with no cut.' },
  { id: 'vendorFlip', label: 'AH → Vendor',
    blurb: 'Auctions listed below what a merchant pays for the item. Only items with a known vendor price (the recipe catalog) are checked.' },
  { id: 'disenchant', label: 'Disenchant',
    blurb: `Weapons and armor worth more as disenchanted materials, sold after the ${CRAFT_SALE_FEE}% cut. Uses the addon's disenchant tables; unlisted materials count as zero.` },
  { id: 'buyLow', label: 'Buy Low',
    blurb: `Steady items listed well under their normal (median) price for this window. Resale is assumed at the median after the ${CRAFT_SALE_FEE}% cut.` },
  { id: 'signals', label: 'Market Signals',
    blurb: 'Buy, sell or avoid, judged against each item\'s normal (median) price. This is a return-to-normal estimate, not a demand forecast.' },
];

const KIND_LABELS: Record<OpportunityKind, string> = {
  craft: 'Craft & Sell',
  vendorCraft: 'Vendor Craft',
  vendorFlip: 'AH → Vendor',
  disenchant: 'Disenchant',
  buyLow: 'Buy Low',
};

const REVENUE_LABELS: Record<OpportunityKind, string> = {
  craft: `Sells for (−${CRAFT_SALE_FEE}%)`,
  vendorCraft: 'Vendor pays',
  vendorFlip: 'Vendor pays',
  disenchant: `Materials (−${CRAFT_SALE_FEE}%)`,
  buyLow: `Resell at median (−${CRAFT_SALE_FEE}%)`,
};

const COST_LABELS: Record<OpportunityKind, string> = {
  craft: 'Reagents',
  vendorCraft: 'Reagents',
  vendorFlip: 'Buy',
  disenchant: 'Buy item',
  buyLow: 'Buy',
};

const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d', 1: '#f0f4fa', 2: '#1eff00', 3: '#4da3ff', 4: '#c668ff', 5: '#ff9429', 6: '#e6cc80', 7: '#00ccff',
};

const PAGE = 60;
const EMPTY_QUOTES: CraftQuotes = {};

export interface MoneyMakersPanelProps {
  flavor: FlavorId;
  path: string;
  partitionKey: string;
  faction: string;
  analytics: MarketAnalyticsPayload | null;
  windowLabel: string;
  onSelectItem: (row: EnrichedAuctionRow) => void;
}

function Money({ value }: { value: number }) {
  return (
    <span>
      {value < 0 ? '−' : ''}
      <CopperDisplay copper={Math.abs(Math.round(value))} />
    </span>
  );
}

function iconFor(flavor: FlavorId, itemId: number, icon?: string, iconUrl?: string): string {
  const cached = getCachedWowheadTooltipMeta(itemId, flavor)?.icon;
  if (iconUrl && !iconUrl.includes(DEFAULT_ITEM_ICON)) return iconUrl;
  return getItemIconUrl(icon ?? cached ?? DEFAULT_ITEM_ICON);
}

export function MoneyMakersPanel({
  flavor, path, partitionKey, faction, analytics, windowLabel, onSelectItem,
}: MoneyMakersPanelProps) {
  const [section, setSection] = useState<Section>('best');
  const [profession, setProfession] = useState<number | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [catalogState, setCatalogState] = useState<{ flavor: FlavorId; catalog?: RecipeCatalog; error?: string }>();
  const [quoteState, setQuoteState] = useState<{ key: string; quotes?: CraftQuotes; error?: string }>();
  const marketKey = `${flavor}|${path}|${partitionKey}|${faction}`;

  useEffect(() => {
    let current = true;
    void loadRecipeCatalog(flavor)
      .then((catalog) => { if (current) setCatalogState({ flavor, catalog }); })
      .catch((error: Error) => { if (current) setCatalogState({ flavor, error: error.message }); });
    return () => { current = false; };
  }, [flavor]);

  useEffect(() => {
    if (!path) return;
    let current = true;
    void snapshotClient
      .getCraftQuotes({ flavor, path, partitionKey, faction })
      .then((quotes) => { if (current) setQuoteState({ key: marketKey, quotes }); })
      .catch((error: Error) => { if (current) setQuoteState({ key: marketKey, error: error.message }); });
    return () => { current = false; };
  }, [flavor, path, partitionKey, faction, marketKey]);

  useEffect(() => { setLimit(PAGE); }, [section, profession, marketKey]);
  useEffect(() => { setProfession('all'); }, [flavor]);

  const catalog = catalogState?.flavor === flavor ? catalogState.catalog : undefined;
  const catalogError = catalogState?.flavor === flavor ? catalogState.error : undefined;
  const quotes = !path ? EMPTY_QUOTES : quoteState?.key === marketKey ? quoteState.quotes : undefined;
  const quoteError = quoteState?.key === marketKey ? quoteState.error : undefined;

  const estimates = useMemo(
    () => (catalog && quotes ? evaluateAllRecipes(catalog, quotes) : []),
    [catalog, quotes],
  );
  const lists = useMemo(() => {
    const craft = catalog && quotes ? craftForAuction(catalog, quotes, estimates) : [];
    const vendorCraft = catalog && quotes ? vendorCrafts(catalog, quotes, estimates) : [];
    const vendorFlip = catalog && quotes ? auctionToVendorFlips(catalog, quotes) : [];
    const disenchant = quotes ? disenchantFlips(flavor, quotes) : [];
    const buyLow = buyLowDeals(analytics);
    return { craft, vendorCraft, vendorFlip, disenchant, buyLow,
      best: bestOverall([craft, vendorCraft, vendorFlip, disenchant, buyLow]) };
  }, [catalog, quotes, estimates, flavor, analytics]);
  const signals = useMemo(() => marketSignals(analytics), [analytics]);

  const professionNames = useMemo(
    () => new Map((catalog?.professions ?? []).map((p) => [p.id, p.name])),
    [catalog],
  );
  const usesProfessions = section === 'craft' || section === 'vendorCraft';
  const professionChips = useMemo(() => {
    if (!usesProfessions) return [];
    const counts = new Map<number, number>();
    for (const o of lists[section as 'craft' | 'vendorCraft']) {
      if (o.profession !== undefined) counts.set(o.profession, (counts.get(o.profession) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: professionNames.get(id) ?? `Profession ${id}` }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [usesProfessions, lists, section, professionNames]);

  const visible: Opportunity[] = useMemo(() => {
    if (section === 'signals') return [];
    const list = lists[section];
    return usesProfessions && profession !== 'all' ? list.filter((o) => o.profession === profession) : list;
  }, [lists, section, usesProfessions, profession]);

  // Load Wowhead icons for visible items that are not cached yet, as the other
  // analytics views do, then re-render.
  const [, refreshIcons] = useState(0);
  const visibleIconIds = useMemo(() => {
    const items = section === 'signals'
      ? signals.slice(0, limit).map((s) => ({ itemId: s.item.row.itemId, icon: undefined, iconUrl: s.item.row.iconUrl }))
      : visible.slice(0, limit);
    const ids = new Set<number>();
    for (const o of items) {
      const usesDefault = o.iconUrl ? o.iconUrl.includes(DEFAULT_ITEM_ICON) : !o.icon;
      if (usesDefault && !getCachedWowheadTooltipMeta(o.itemId, flavor)) ids.add(o.itemId);
    }
    for (const o of visible.slice(0, limit)) {
      for (const d of o.drops ?? []) if (!getCachedWowheadTooltipMeta(d.itemId, flavor)) ids.add(d.itemId);
    }
    return [...ids];
  }, [section, signals, visible, limit, flavor]);
  useEffect(() => {
    if (visibleIconIds.length === 0) return;
    let active = true;
    void (async () => {
      for (let i = 0; active && i < visibleIconIds.length; i += 12) {
        const hydrated = await snapshotClient.hydrateWowheadItems(visibleIconIds.slice(i, i + 12), flavor);
        if (active && Object.keys(hydrated).length > 0) refreshIcons((n) => n + 1);
      }
    })().catch(() => undefined);
    return () => { active = false; };
  }, [visibleIconIds, flavor]);

  const loadingPrices = Boolean(path) && !quotes && !quoteError;
  const needsCatalog = section === 'craft' || section === 'vendorCraft' || section === 'vendorFlip';
  const needsAnalytics = section === 'buyLow' || section === 'signals';
  const active = SECTIONS.find((s) => s.id === section)!;

  const materialName = (id: number) => catalog?.items[id] ?? quotes?.[id]?.name ?? `Item #${id}`;

  const renderCard = (o: Opportunity) => {
    const color = QUALITY_COLORS[o.quality ?? 1] ?? QUALITY_COLORS[1];
    const openable = Boolean(o.analytics);
    return (
      <article key={o.key} className="ms-mm-card" data-kind={o.kind}>
        <header className="ms-mm-card-head">
          <img className="ms-mm-icon" src={iconFor(flavor, o.itemId, o.icon, o.iconUrl)} alt="" width={32} height={32} />
          <div className="ms-mm-title">
            {openable ? (
              <button type="button" className="ms-mm-name" style={{ color }}
                onClick={() => onSelectItem(o.analytics!.row)}>
                {o.name}
              </button>
            ) : (
              <a className="ms-mm-name" style={{ color }} href={getWowheadItemUrl(o.itemId, flavor)}
                target="_blank" rel="noopener noreferrer">
                {o.name}
              </a>
            )}
            <span className="ms-mm-sub">
              {section === 'best' && <span className="ms-mm-kind">{KIND_LABELS[o.kind]}</span>}
              {o.profession !== undefined && (
                <span className="ms-mm-prof">
                  {PROFESSION_ICONS[o.profession] && (
                    <img src={getItemIconUrl(PROFESSION_ICONS[o.profession]!, 'small')} alt="" width={14} height={14} />
                  )}
                  {professionNames.get(o.profession) ?? ''}
                </span>
              )}
            </span>
          </div>
        </header>
        <div className="ms-mm-profit">
          <span className="ms-mm-profit-value">+<Money value={o.profit} /></span>
          <span className="ms-mm-roi">{Math.round(o.roi).toLocaleString()}% return</span>
        </div>
        {isThinMarket(o) && (
          <span className="ms-mm-thin" title="One or two listings set this sale price; it may not sell at it.">
            Thin market: {o.supply ?? 0} listed
          </span>
        )}
        <dl className="ms-mm-facts">
          <div><dt>{COST_LABELS[o.kind]}</dt><dd><Money value={o.cost} /></dd></div>
          <div><dt>{REVENUE_LABELS[o.kind]}</dt><dd><Money value={o.revenue} /></dd></div>
          {o.supply !== undefined && <div><dt>Listed</dt><dd>{o.supply.toLocaleString()}</dd></div>}
          {o.estimate && o.estimate.output > 1 && <div><dt>Makes</dt><dd>{o.estimate.output}</dd></div>}
        </dl>
        {o.drops && (
          <ul className="ms-mm-drops">
            {o.drops.map((d) => (
              <li key={d.itemId}>
                <span>{d.expected.toFixed(2)}× {materialName(d.itemId)}</span>
                <span>{d.price === null ? <span className="ms-muted">not listed</span> : <Money value={d.price} />}</span>
              </li>
            ))}
          </ul>
        )}
      </article>
    );
  };

  const renderSignal = (s: MarketSignal) => {
    const { row } = s.item;
    const color = QUALITY_COLORS[row.quality ?? 1] ?? QUALITY_COLORS[1];
    return (
      <article key={row.itemKey} className="ms-mm-card" data-signal={s.kind}>
        <header className="ms-mm-card-head">
          <img className="ms-mm-icon" src={iconFor(flavor, row.itemId, undefined, row.iconUrl)} alt="" width={32} height={32} />
          <div className="ms-mm-title">
            <button type="button" className="ms-mm-name" style={{ color }} onClick={() => onSelectItem(row)}>
              {row.name}
            </button>
            <span className={`ms-mm-signal is-${s.kind}`}>{s.kind.toUpperCase()}</span>
          </div>
        </header>
        <p className="ms-mm-reason">{s.reason}</p>
        <dl className="ms-mm-facts">
          <div><dt>Now</dt><dd><Money value={row.minPrice} /></dd></div>
          <div><dt>Normal (median)</dt><dd><Money value={s.normalPrice} /></dd></div>
          <div><dt>Now vs normal</dt><dd>{Math.round(s.pctOfNormal)}%</dd></div>
          <div>
            <dt>Back to normal</dt>
            <dd className={s.moveToNormalPct >= 0 ? 'is-up' : 'is-down'}>
              {s.moveToNormalPct >= 0 ? '+' : ''}{Math.round(s.moveToNormalPct)}%
            </dd>
          </div>
        </dl>
      </article>
    );
  };

  let body: ReactNode;
  if (needsCatalog && catalogError) {
    body = <div className="ms-an-empty">{catalogError}</div>;
  } else if (quoteError && !needsAnalytics) {
    body = <div className="ms-an-empty">{quoteError}</div>;
  } else if ((loadingPrices || (needsCatalog && !catalog)) && !needsAnalytics) {
    body = <div className="ms-an-empty">Loading current prices and recipes...</div>;
  } else if (needsAnalytics && !analytics) {
    body = <div className="ms-an-empty">Loading {windowLabel} market history...</div>;
  } else if (section === 'signals') {
    body = signals.length === 0
      ? <div className="ms-an-empty">No clear signals in the {windowLabel} window yet. Signals need at least three captures per item.</div>
      : <div className="ms-mm-grid">{signals.slice(0, limit).map(renderSignal)}</div>;
  } else if (visible.length === 0) {
    body = <div className="ms-an-empty">Nothing profitable here at current prices.</div>;
  } else {
    body = <div className="ms-mm-grid">{visible.slice(0, limit).map(renderCard)}</div>;
  }
  const total = section === 'signals' ? signals.length : visible.length;

  return (
    <section className="ms-an-card ms-mm" aria-label="Money Makers" data-testid="money-makers">
      <div className="ms-mm-tabs" role="tablist" aria-label="Money maker methods">
        {SECTIONS.map((s) => {
          const count = s.id === 'signals' ? signals.length : lists[s.id].length;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id}
              className={`ms-an-seg-btn ${section === s.id ? 'is-active' : ''}`}
              onClick={() => setSection(s.id)}>
              {s.label}
              {count > 0 && <span className="ms-mm-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <p className="ms-mm-blurb">{active.blurb}</p>

      {usesProfessions && professionChips.length > 0 && (
        <div className="ms-mm-profs" role="group" aria-label="Filter by profession">
          <button type="button" className={`ms-mm-chip ${profession === 'all' ? 'is-active' : ''}`}
            onClick={() => setProfession('all')}>
            All <span className="ms-mm-count">{lists[section as 'craft' | 'vendorCraft'].length}</span>
          </button>
          {professionChips.map((p) => (
            <button key={p.id} type="button" className={`ms-mm-chip ${profession === p.id ? 'is-active' : ''}`}
              onClick={() => setProfession(p.id)}>
              {PROFESSION_ICONS[p.id] && (
                <img src={getItemIconUrl(PROFESSION_ICONS[p.id]!, 'small')} alt="" width={16} height={16} />
              )}
              {p.name} <span className="ms-mm-count">{p.count}</span>
            </button>
          ))}
        </div>
      )}

      {body}

      {total > limit && (
        <button type="button" className="ms-btn ms-btn-ghost ms-mm-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show more ({(total - limit).toLocaleString()} left)
        </button>
      )}
      <p className="ms-mm-note">
        Estimates use the lowest current listing. Buying moves prices, and only the cheapest listing is
        guaranteed at the quoted price; check an item&apos;s history before buying in bulk.
      </p>
    </section>
  );
}
