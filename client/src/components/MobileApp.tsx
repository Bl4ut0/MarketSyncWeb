import { useState } from 'react';
import { CopperDisplay } from './CopperDisplay.js';

export interface MobileRowItem {
  itemKey: string;
  name: string;
  quality: number;
  iconUrl: string;
  categoryLabel: string;
  itemLevel?: number;
  unitPrice: number;
  quantity: number;
}

export interface MobileCategory {
  id: string;
  label: string;
  count: number;
}

export interface MobileEraOption {
  id: string;
  label: string;
}

export interface MobileRealmOption {
  label: string;
  count: number;
}

export interface MobileAppProps {
  eraLabel: string;
  activeFlavor: string;
  eras: MobileEraOption[];
  onSelectFlavor: (flavorId: string) => void;
  realmLabel: string;
  realms: MobileRealmOption[];
  onSelectRealm: (realm: string) => void;
  faction: string;
  onCycleFaction: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortChange: (sort: 'price_asc' | 'high_desc' | 'qty_desc' | 'name_asc') => void;
  rows: MobileRowItem[];
  loading: boolean;
  marketError?: string | null;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  categories: MobileCategory[];
  activeCategory: string;
  onSelectCategory: (catId: string) => void;
  activeQuality: string;
  onSelectQuality: (quality: string) => void;
  onSelectItem: (itemKey: string) => void;
  activeTab: 'market' | 'analytics' | 'craft' | 'shopping' | 'alerts';
  onTabChange: (tab: MobileAppProps['activeTab']) => void;
  shoppingCount: number;
  alertsCount: number;
  renderSecondaryTab?: () => React.ReactNode;
}

function FactionIcon({ faction }: { faction: string }) {
  const f = faction.toLowerCase();
  if (f === 'alliance') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 4.2l4 1.6v3.29c0 3.16-1.72 6.13-4 7.18-2.28-1.05-4-4.02-4-7.18V7.8l4-1.6z" />
      </svg>
    );
  }
  if (f === 'horde') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C9.5 5 7 6.5 4 7c1 4 3 7.5 8 15 5-7.5 7-11 8-15-3-.5-5.5-2-8-5zm0 6.5c1.5 1.8 3 2.7 4.5 3.2-.8 2.4-2.1 4.5-4.5 7.3-2.4-2.8-3.7-4.9-4.5-7.3 1.5-.5 3-1.4 4.5-3.2z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm-1 3v2H9v2h2v4h2v-4h2v-2h-2V8h-2z" />
    </svg>
  );
}

const FLAVOR_LOGOS = new Set([
  'anniversary',
  'classic',
  'classicEra',
  'forever',
  'retail',
]);

function FlavorIcon({ flavor }: { flavor: string }) {
  const file = FLAVOR_LOGOS.has(flavor) ? `${flavor}-logo.png` : 'wow-logo.png';
  return (
    <img
      src={`/assets/blizzard-trademarks/${file}`}
      alt=""
      className="ms-m-flavor-logo"
    />
  );
}

const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d',
  1: '#ffffff',
  2: '#1eff00',
  3: '#0070dd',
  4: '#a335ee',
  5: '#ff8000',
  6: '#e6cc80',
  7: '#00ccff',
};

export function MobileApp({
  eraLabel,
  activeFlavor,
  eras,
  onSelectFlavor,
  realmLabel,
  realms,
  onSelectRealm,
  faction,
  onCycleFaction,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  rows,
  loading,
  marketError,
  page,
  totalPages,
  onPageChange,
  categories,
  activeCategory,
  onSelectCategory,
  activeQuality,
  onSelectQuality,
  onSelectItem,
  activeTab,
  onTabChange,
  shoppingCount,
  alertsCount,
  renderSecondaryTab,
}: MobileAppProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [realmPickerOpen, setRealmPickerOpen] = useState(false);
  const [flavorMenuOpen, setFlavorMenuOpen] = useState(false);

  const factionClass =
    faction.toLowerCase() === 'horde'
      ? 'is-horde'
      : faction.toLowerCase() === 'alliance'
        ? 'is-alliance'
        : '';

  return (
    <div className="ms-mobile-shell" data-testid="mobile-app-shell">
      {/* Sticky Compact Top Bar */}
      <header className="ms-m-topbar">
        <div className="ms-m-brand-wrap">
          <button
            type="button"
            className="ms-m-brand"
            onClick={() => setFlavorMenuOpen((open) => !open)}
            title={`Edition: ${eraLabel}`}
            aria-expanded={flavorMenuOpen}
          >
            <div className="ms-m-emblem">
              <FlavorIcon flavor={activeFlavor} />
            </div>
            <div className="ms-m-title-wrap">
              <span className="ms-m-title">MarketSync</span>
              <span className="ms-m-sub">{eraLabel} ▾</span>
            </div>
          </button>

          {flavorMenuOpen && (
            <div className="ms-m-flavor-dropdown" role="menu">
              {eras.map((e) => {
                const isWip = e.id === 'anniversary' || e.id === 'classicEra';
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="menuitem"
                    className={`ms-m-flavor-option ${activeFlavor === e.id ? 'is-active' : ''} ${isWip ? 'is-wip' : ''}`}
                    onClick={() => {
                      onSelectFlavor(e.id);
                      setFlavorMenuOpen(false);
                    }}
                  >
                    <FlavorIcon flavor={e.id} />
                    <span>{e.label}</span>
                    {isWip && <span className="ms-wip-tag">In Dev</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="ms-m-top-pills">
          <button
            type="button"
            className="ms-m-pill-btn"
            onClick={() => setRealmPickerOpen(true)}
          >
            {realmLabel}
          </button>
          <button
            type="button"
            className={`ms-m-pill-btn ${factionClass}`}
            onClick={onCycleFaction}
            title={`Faction: ${faction}`}
            aria-label={`Switch faction (current: ${faction})`}
          >
            <FactionIcon faction={faction} />
            <span>{faction === 'Neutral' ? 'Blackwater' : faction}</span>
          </button>
        </div>
      </header>

      {/* Search + Quick Sort Chips (Market Tab) */}
      {activeTab === 'market' && (
        <div className="ms-m-search-strip">
          <input
            type="search"
            aria-label="Search items or ID"
            className="ms-m-search-input"
            placeholder="Search items or ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <div className="ms-m-chips">
            <button
              type="button"
              className={`ms-m-chip ${sortBy === 'price_asc' ? 'is-active' : ''}`}
              onClick={() => onSortChange('price_asc')}
            >
              Lowest Price
            </button>
            <button
              type="button"
              className={`ms-m-chip ${sortBy === 'qty_desc' ? 'is-active' : ''}`}
              onClick={() => onSortChange('qty_desc')}
            >
              Most Qty
            </button>
            <button
              type="button"
              className={`ms-m-chip ${sortBy === 'high_desc' ? 'is-active' : ''}`}
              onClick={() => onSortChange('high_desc')}
            >
              High Price
            </button>
            <button
              type="button"
              className={`ms-m-chip ${sortBy === 'name_asc' ? 'is-active' : ''}`}
              onClick={() => onSortChange('name_asc')}
            >
              Name A–Z
            </button>
          </div>
        </div>
      )}

      {/* Main Scrollable Feed */}
      <main className="ms-m-main">
        {activeTab === 'market' &&
          (activeFlavor === 'anniversary' || activeFlavor === 'classicEra') && (
            <div className="ms-sticky-note" role="note">
              <strong>{eraLabel} — Data Collection In Progress</strong>
              Blizzard does not provide a public Auction House API for {eraLabel}.
              We&apos;re working on a community addon method to gather and sync
              auction data from players.
            </div>
          )}
        {activeTab !== 'market' && renderSecondaryTab ? (
          renderSecondaryTab()
        ) : marketError ? (
          <div className="ms-m-pager" role="alert">{marketError}</div>
        ) : loading ? (
          <div className="ms-m-pager">Loading auction snapshot...</div>
        ) : rows.length === 0 ? (
          <div className="ms-m-pager">No matching items found.</div>
        ) : (
          <>
            {rows.map((row) => {
              const color = QUALITY_COLORS[row.quality] ?? '#ffffff';
              return (
                <button
                  type="button"
                  key={row.itemKey}
                  className="ms-m-row"
                  onClick={() => onSelectItem(row.itemKey)}
                >
                  <img
                    src={row.iconUrl}
                    alt=""
                    className="ms-m-icon"
                    style={{ borderColor: color }}
                    loading="lazy"
                  />
                  <span className="ms-m-row-mid">
                    <span className="ms-m-item-name" style={{ color }}>
                      {row.name}
                    </span>
                    <span className="ms-m-item-meta">
                      {row.categoryLabel}
                      {row.itemLevel ? ` · iLvl ${row.itemLevel}` : ''}
                    </span>
                  </span>
                  <span className="ms-m-row-right">
                    <span className="ms-m-price">
                      <CopperDisplay copper={row.unitPrice} />
                    </span>
                    <span className="ms-m-qty">x{row.quantity}</span>
                  </span>
                </button>
              );
            })}

            {totalPages > 1 && (
              <div className="ms-m-pager">
                <button
                  type="button"
                  className="ms-m-pill-btn"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  Prev
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="ms-m-pill-btn"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating Gold Filter Button (Circle) */}
      {activeTab === 'market' && (
        <button
          type="button"
          className="ms-m-fab"
          onClick={() => setFilterOpen(true)}
          aria-label="Open filters"
          title="Filters"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 4h18v2l-7 8v6l-4-2v-4L3 6V4z" />
          </svg>
        </button>
      )}

      {/* Bottom Native-Style Navigation Bar */}
      <nav className="ms-m-bottomnav" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`ms-m-nav-btn ${activeTab === 'market' ? 'is-active' : ''}`}
          onClick={() => onTabChange('market')}
        >
          <span>Market</span>
        </button>
        <button
          type="button"
          className={`ms-m-nav-btn ${activeTab === 'analytics' ? 'is-active' : ''}`}
          onClick={() => onTabChange('analytics')}
        >
          <span>Analytics</span>
        </button>
        <button
          type="button"
          className={`ms-m-nav-btn ${activeTab === 'craft' ? 'is-active' : ''}`}
          onClick={() => onTabChange('craft')}
        >
          <span>Craft</span>
        </button>
        <button
          type="button"
          className={`ms-m-nav-btn ${activeTab === 'shopping' ? 'is-active' : ''}`}
          onClick={() => onTabChange('shopping')}
        >
          <span>Shopping{shoppingCount > 0 ? ` (${shoppingCount})` : ''}</span>
        </button>
        <button
          type="button"
          className={`ms-m-nav-btn ${activeTab === 'alerts' ? 'is-active' : ''}`}
          onClick={() => onTabChange('alerts')}
        >
          <span>Alerts{alertsCount > 0 ? ` (${alertsCount})` : ''}</span>
        </button>
      </nav>

      {/* Category & Rarity Filter Bottom Sheet */}
      {filterOpen && (
        <div
          className="ms-m-sheet-backdrop"
          onClick={() => setFilterOpen(false)}
        >
          <div className="ms-m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-m-sheet-header">
              <strong style={{ color: '#f3d078' }}>Filters</strong>
              <button
                type="button"
                className="ms-m-pill-btn"
                onClick={() => setFilterOpen(false)}
              >
                Done
              </button>
            </div>
            <div className="ms-m-sheet-body">
              <div style={{ fontSize: '12px', color: '#8b9bb4', fontWeight: 600 }}>
                Rarity
              </div>
              <div className="ms-m-chips" style={{ flexWrap: 'wrap' }}>
                {[
                  { id: 'all', label: 'All' },
                  { id: '1', label: 'Common' },
                  { id: '2', label: 'Uncommon' },
                  { id: '3', label: 'Rare' },
                  { id: '4', label: 'Epic' },
                  { id: '5', label: 'Legendary' },
                ].map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={`ms-m-chip ${activeQuality === q.id ? 'is-active' : ''}`}
                    onClick={() => onSelectQuality(q.id)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: '12px', color: '#8b9bb4', fontWeight: 600, marginTop: '4px' }}>
                Categories
              </div>
              <button
                type="button"
                className={`ms-m-cat-item ${activeCategory === 'all' ? 'is-active' : ''}`}
                onClick={() => {
                  onSelectCategory('all');
                  setFilterOpen(false);
                }}
              >
                <span>All Categories</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`ms-m-cat-item ${activeCategory === cat.id ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelectCategory(cat.id);
                    setFilterOpen(false);
                  }}
                >
                  <span>{cat.label}</span>
                  <span style={{ color: '#9fb0c7' }}>{cat.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Era & Realm Picker Bottom Sheet */}
      {realmPickerOpen && (
        <div
          className="ms-m-sheet-backdrop"
          onClick={() => setRealmPickerOpen(false)}
        >
          <div className="ms-m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-m-sheet-header">
              <strong style={{ color: '#f3d078' }}>Era &amp; Realm</strong>
              <button
                type="button"
                className="ms-m-pill-btn"
                onClick={() => setRealmPickerOpen(false)}
              >
                Done
              </button>
            </div>
            <div className="ms-m-sheet-body">
              <div style={{ fontSize: '12px', color: '#8b9bb4', fontWeight: 600 }}>
                Era
              </div>
              <div className="ms-m-chips" style={{ flexWrap: 'wrap' }}>
                {eras.map((e) => {
                  const isWip = e.id === 'anniversary' || e.id === 'classicEra';
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={`ms-m-chip ${activeFlavor === e.id ? 'is-active' : ''} ${isWip ? 'is-wip' : ''}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => onSelectFlavor(e.id)}
                    >
                      <FlavorIcon flavor={e.id} />
                      <span>{e.label}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: '12px', color: '#8b9bb4', fontWeight: 600, marginTop: '4px' }}>
                Realm
              </div>
              {realms.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`ms-m-cat-item ${realmLabel === r.label ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelectRealm(r.label);
                    setRealmPickerOpen(false);
                  }}
                >
                  <span>{r.label}</span>
                  <span style={{ color: '#9fb0c7' }}>({r.count.toLocaleString()})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
