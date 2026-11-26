import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { DEFAULT_ITEM_ICON, getCachedWowheadTooltipMeta, getItemIconUrl, getWowheadItemUrl, type FlavorId } from '@marketsync/shared';
import type { HistoryHours } from '../lib/priceHistory.js';
import { describeVolatility, VOLUME_MOVERS_RANKING, type ItemAnalyticsDetails } from '../lib/marketAnalytics.js';
import { snapshotClient } from '../lib/snapshotClient.js';
import type {
  EnrichedAuctionRow,
  MarketAnalyticsItem,
  MarketAnalyticsPayload,
} from '../lib/snapshotClient.js';
import { CopperDisplay } from './CopperDisplay.js';

export interface MarketAnalyticsPanelProps {
  variant: 'desktop' | 'mobile';
  flavor: FlavorId;
  eraLabel: string;
  marketLabel: string;
  faction: string;
  analytics: MarketAnalyticsPayload | null;
  loading: boolean;
  error?: string | null;
  windowHours: HistoryHours;
  onWindowHoursChange: (hours: HistoryHours) => void;
  activeCategory: string;
  onCategoryChange: (catId: string) => void;
  onSelectItem: (row: EnrichedAuctionRow, comparison?: ItemAnalyticsDetails) => void;
  /** Desktop "Money Makers" view; the tab is shown only when this is provided. */
  moneyMakers?: ReactNode;
}

type AnalyticsSection = 'overview' | 'movers' | 'stable' | 'volume' | 'money';
type MobileSection = 'map' | 'deals' | 'gainers' | 'stable' | 'volume';
type Leaderboard = Exclude<MobileSection, 'map'>;
type MapMetric = 'gold' | 'units';

interface TreemapRect {
  item: MarketAnalyticsItem;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  areaPct: number;
}

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

/**
 * Bruls-Huizing-van Wijk squarified treemap layout in normalized percentage space.
 */
function computeSquarifiedTreemap(
  items: MarketAnalyticsItem[],
  metric: MapMetric,
  aspectWidth = 1000,
  aspectHeight = 540,
): TreemapRect[] {
  const weighted = items
    .map((item) => {
      const raw =
        metric === 'gold'
          ? Math.max(1, item.marketValueCopper)
          : Math.max(1, item.row.totalQty);
      // Dampened perceptual scaling (0.56 exponent) keeps major commodities dominant
      // while ensuring mid-cap movers remain legible and clickable.
      return { item, weight: Math.pow(raw, 0.56) };
    })
    .filter((d) => d.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 32);

  if (weighted.length === 0) return [];

  const totalWeight = weighted.reduce((sum, d) => sum + d.weight, 0);
  const totalArea = aspectWidth * aspectHeight;
  const nodes = weighted.map((d) => ({
    item: d.item,
    area: (d.weight / totalWeight) * totalArea,
  }));

  const rects: TreemapRect[] = [];
  let rx = 0;
  let ry = 0;
  let rw = aspectWidth;
  let rh = aspectHeight;

  const worstAspect = (row: typeof nodes, side: number): number => {
    if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
    let sum = 0;
    let minA = Number.POSITIVE_INFINITY;
    let maxA = 0;
    for (const n of row) {
      sum += n.area;
      if (n.area < minA) minA = n.area;
      if (n.area > maxA) maxA = n.area;
    }
    const s2 = sum * sum;
    const w2 = side * side;
    return Math.max((w2 * maxA) / s2, s2 / (w2 * minA));
  };

  const layoutRow = (row: typeof nodes) => {
    const sum = row.reduce((acc, n) => acc + n.area, 0);
    if (sum <= 0 || rw <= 0 || rh <= 0) return;
    const horizontal = rw >= rh;
    if (horizontal) {
      const stripW = sum / rh;
      let cy = ry;
      for (const n of row) {
        const ch = n.area / stripW;
        rects.push({
          item: n.item,
          xPct: (rx / aspectWidth) * 100,
          yPct: (cy / aspectHeight) * 100,
          wPct: (stripW / aspectWidth) * 100,
          hPct: (ch / aspectHeight) * 100,
          areaPct: (n.area / totalArea) * 100,
        });
        cy += ch;
      }
      rx += stripW;
      rw = Math.max(0, rw - stripW);
    } else {
      const stripH = sum / rw;
      let cx = rx;
      for (const n of row) {
        const cw = n.area / stripH;
        rects.push({
          item: n.item,
          xPct: (cx / aspectWidth) * 100,
          yPct: (ry / aspectHeight) * 100,
          wPct: (cw / aspectWidth) * 100,
          hPct: (stripH / aspectHeight) * 100,
          areaPct: (n.area / totalArea) * 100,
        });
        cx += cw;
      }
      ry += stripH;
      rh = Math.max(0, rh - stripH);
    }
  };

  let currentRow: typeof nodes = [];
  for (const node of nodes) {
    const shortSide = Math.min(rw, rh);
    if (currentRow.length === 0) {
      currentRow.push(node);
      continue;
    }
    const candidate = [...currentRow, node];
    if (worstAspect(candidate, shortSide) <= worstAspect(currentRow, shortSide)) {
      currentRow = candidate;
    } else {
      layoutRow(currentRow);
      currentRow = [node];
    }
  }
  if (currentRow.length > 0) {
    layoutRow(currentRow);
  }

  return rects;
}

function getTileTone(pct: number, observations: number): {
  bg: string;
  border: string;
  badgeColor: string;
} {
  if (observations < 2) {
    return {
      bg: 'linear-gradient(145deg, rgba(26, 33, 48, 0.96), rgba(17, 22, 33, 0.98))',
      border: 'rgba(200, 155, 60, 0.34)',
      badgeColor: '#d7b56d',
    };
  }
  if (pct >= 18) {
    return {
      bg: 'linear-gradient(145deg, rgba(18, 86, 54, 0.95), rgba(11, 54, 34, 0.98))',
      border: 'rgba(52, 211, 153, 0.65)',
      badgeColor: '#6ee7b7',
    };
  }
  if (pct >= 3.5) {
    return {
      bg: 'linear-gradient(145deg, rgba(20, 62, 43, 0.94), rgba(13, 40, 29, 0.98))',
      border: 'rgba(34, 197, 94, 0.45)',
      badgeColor: '#86efac',
    };
  }
  if (pct <= -18) {
    return {
      bg: 'linear-gradient(145deg, rgba(96, 24, 34, 0.95), rgba(58, 14, 21, 0.98))',
      border: 'rgba(248, 113, 113, 0.65)',
      badgeColor: '#fca5a5',
    };
  }
  if (pct <= -3.5) {
    return {
      bg: 'linear-gradient(145deg, rgba(69, 24, 32, 0.94), rgba(43, 15, 21, 0.98))',
      border: 'rgba(239, 68, 68, 0.45)',
      badgeColor: '#fda4af',
    };
  }
  return {
    bg: 'linear-gradient(145deg, rgba(27, 33, 46, 0.95), rgba(17, 21, 31, 0.98))',
    border: 'rgba(200, 155, 60, 0.32)',
    badgeColor: '#cbd5e1',
  };
}

function formatSignedPct(pct: number, observations: number): string {
  if (observations < 2) return '1 scan';
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function MarketAnalyticsPanel({
  variant,
  flavor,
  eraLabel,
  marketLabel,
  faction,
  analytics,
  loading,
  error,
  windowHours,
  onWindowHoursChange,
  activeCategory,
  onCategoryChange,
  onSelectItem,
  moneyMakers,
}: MarketAnalyticsPanelProps) {
  const displayRow = (row: EnrichedAuctionRow): EnrichedAuctionRow => {
    if (row.isPetCage || row.icon !== DEFAULT_ITEM_ICON) return row;
    const meta = getCachedWowheadTooltipMeta(row.itemId, flavor);
    if (!meta) return row;
    return {
      ...row,
      name: row.isFallback && meta.name ? meta.name : row.name,
      quality: meta.quality ?? row.quality,
      icon: meta.icon ?? row.icon,
      iconUrl: meta.icon ? getItemIconUrl(meta.icon) : row.iconUrl,
    };
  };
  const itemLink = (row: EnrichedAuctionRow, comparison: ItemAnalyticsDetails) => ({
    href: getWowheadItemUrl(row.itemId, flavor, row.petSpeciesId, row.suffixId),
    'data-disable-wowhead-touch-tooltip': 'true',
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onSelectItem(row, comparison);
    },
  });
  const [section, setSection] = useState<AnalyticsSection>('overview');
  const [moversView, setMoversView] = useState<'deals' | 'gainers'>('deals');
  const [mobileSection, setMobileSection] = useState<MobileSection>('map');
  const [mapMetric, setMapMetric] = useState<MapMetric>('gold');
  const [mobileCatSheet, setMobileCatSheet] = useState(false);
  const [, refreshIcons] = useState(0);

  const mapSource = useMemo(() => {
    if (!analytics) return [];
    return mapMetric === 'gold'
      ? analytics.blockMapByGold
      : analytics.blockMapByUnits;
  }, [analytics, mapMetric]);

  useEffect(() => {
    if (!analytics) return;
    const lists = {
      deals: analytics.deals,
      gainers: analytics.gainers,
      stable: analytics.stableAnchors,
      volume: analytics.volumeMovers,
      map: mapSource,
    };
    let items: MarketAnalyticsItem[];
    if (variant === 'mobile') items = lists[mobileSection];
    else if (section === 'overview') {
      items = [...mapSource, ...lists.deals.slice(0, 7), ...lists.gainers.slice(0, 7),
        ...lists.stable.slice(0, 7), ...lists.volume.slice(0, 7)];
    } else if (section === 'movers') items = lists[moversView];
    else if (section === 'money') items = [...lists.deals, ...lists.stable, ...lists.gainers];
    else items = lists[section];

    const ids = [...new Set(items.map(({ row }) => row)
      .filter((row) => row.icon === DEFAULT_ITEM_ICON && !row.isPetCage &&
        !getCachedWowheadTooltipMeta(row.itemId, flavor))
      .map((row) => row.itemId))];
    let active = true;
    const hydrate = async () => {
      for (let i = 0; active && i < ids.length; i += 12) {
        const hydrated = await snapshotClient.hydrateWowheadItems(ids.slice(i, i + 12), flavor);
        if (active && Object.keys(hydrated).length > 0) refreshIcons((version) => version + 1);
      }
    };
    void hydrate().catch(() => undefined);
    return () => { active = false; };
  }, [analytics, flavor, mapSource, mobileSection, moversView, section, variant]);

  const itemAnalytics = ({ row, ...metrics }: MarketAnalyticsItem, source: ItemAnalyticsDetails['source']): ItemAnalyticsDetails =>
    ({ ...metrics, hours: windowHours, source });

  const treemapRects = useMemo(
    () =>
      computeSquarifiedTreemap(
        mapSource,
        mapMetric,
        variant === 'mobile' ? 600 : 1000,
        variant === 'mobile' ? 460 : 460,
      ),
    [mapSource, mapMetric, variant],
  );

  const totalGlobalGold = useMemo(() => {
    if (!analytics) return 1;
    return Math.max(
      1,
      analytics.categories.reduce((acc, c) => acc + c.totalMarketValue, 0),
    );
  }, [analytics]);

  const activeCategoryLabel = useMemo(() => {
    if (activeCategory === 'all') return 'All Sectors';
    return (
      analytics?.categories.find((c) => c.id === activeCategory)?.label ??
      activeCategory
    );
  }, [activeCategory, analytics]);

  const windowLabel =
    windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d';

  const renderBlockMap = (isMobile: boolean) => {
    if (treemapRects.length === 0) {
      return (
        <div className="ms-an-empty">
          No commodity block data available for this market slice.
        </div>
      );
    }
    return (
      <div
        className={`ms-an-treemap ${isMobile ? 'is-mobile' : ''}`}
        role="region"
        aria-label="Commodity and traffic block map"
      >
        {treemapRects.map((rect) => {
          const { item } = rect;
          const row = displayRow(item.row);
          const tone = getTileTone(item.priceChangePct, item.observations);
          const qColor = QUALITY_COLORS[row.quality] ?? '#f0f4fa';
          const iconSrc =
            row.iconUrl || getItemIconUrl(row.icon ?? DEFAULT_ITEM_ICON);
          const isLarge = rect.wPct >= 16 && rect.hPct >= 20;
          const isMedium = rect.wPct >= 10 && rect.hPct >= 13;
          const isTiny = rect.wPct < 7 || rect.hPct < 10;

          return (
            <a
              key={row.itemKey}
              className="ms-an-tile"
              {...itemLink(row, itemAnalytics(item, 'block'))}
              style={{
                left: `${rect.xPct}%`,
                top: `${rect.yPct}%`,
                width: `${rect.wPct}%`,
                height: `${rect.hPct}%`,
              }}
              aria-label={`${row.name}, ${row.totalQty.toLocaleString()} listed`}
            >
              <div
                className="ms-an-tile-inner"
                style={{
                  background: tone.bg,
                  borderColor: tone.border,
                }}
              >
                {!isTiny && (
                  <div className="ms-an-tile-head">
                    <img
                      src={iconSrc}
                      alt=""
                      className="ms-an-tile-icon"
                      style={{ borderColor: qColor }}
                      loading="lazy"
                    />
                    <span
                      className="ms-an-tile-name"
                      style={{ color: qColor }}
                    >
                      {row.name}
                    </span>
                  </div>
                )}
                {isTiny && (
                  <img
                    src={iconSrc}
                    alt={row.name}
                    className="ms-an-tile-icon is-solo"
                    style={{ borderColor: qColor }}
                    loading="lazy"
                  />
                )}
                {(isLarge || isMedium) && (
                  <div className="ms-an-tile-foot">
                    {isLarge && (
                      <span className="ms-an-tile-price">
                        <CopperDisplay copper={row.minPrice} />
                      </span>
                    )}
                    <span
                      className="ms-an-tile-delta"
                      style={{ color: tone.badgeColor }}
                    >
                      {mapMetric === 'units' && !isLarge
                        ? `x${row.totalQty.toLocaleString()}`
                        : formatSignedPct(
                            item.priceChangePct,
                            item.observations,
                          )}
                    </span>
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>
    );
  };

  // ================================================================
  // DEDICATED MOBILE ANALYTICS VIEW
  // ================================================================
  if (variant === 'mobile') {
    const macro = analytics?.macro;
    const renderMobileRows = (
      items: MarketAnalyticsItem[],
      mode: Leaderboard,
      emptyMsg: string,
      note?: string,
    ) => {
      if (items.length === 0) {
        return <div className="ms-m-pager">{emptyMsg}</div>;
      }
      return (
        <div>
          {note && <div className="ms-m-pager ms-an-ranking-note">{note}</div>}
          {items.map((it) => {
            const row = displayRow(it.row);
            const color = QUALITY_COLORS[row.quality] ?? '#ffffff';
            const iconSrc =
              row.iconUrl || getItemIconUrl(row.icon ?? DEFAULT_ITEM_ICON);

            let badge = '';
            let badgeColor = '#cbd5e1';
            let metaLine: ReactNode = '';

            if (mode === 'deals') {
              badge = `${it.dealPctOfMedian}% of median`;
              badgeColor = '#6ee7b7';
              metaLine = `${formatSignedPct(it.priceChangePct, it.observations)} vs ${windowLabel} · x${row.totalQty.toLocaleString()}`;
            } else if (mode === 'gainers') {
              badge = formatSignedPct(it.priceChangePct, it.observations);
              badgeColor = '#fca5a5';
              metaLine = `${row.category} · x${row.totalQty.toLocaleString()} listed`;
            } else if (mode === 'stable') {
              badge = `${it.stabilityScore}% Stable`;
              badgeColor = '#f3d078';
              const volatility = describeVolatility(it.volatilityPct);
              metaLine = (
                <>
                  Volatility <span style={{ color: volatility.color }}>{volatility.text}</span>
                  {` · x${row.totalQty.toLocaleString()}`}
                </>
              );
            } else {
              badge = `x${row.totalQty.toLocaleString()}`;
              badgeColor = '#93c5fd';
              const deltaStr =
                it.observations >= 2 && it.qtyDelta !== 0
                  ? `${it.qtyDelta > 0 ? '+' : ''}${it.qtyDelta.toLocaleString()} qty · `
                  : '';
              metaLine = `${deltaStr}${row.listings} listings`;
            }

            return (
              <a
                key={row.itemKey}
                className="ms-m-row ms-an-item-link"
                {...itemLink(row, itemAnalytics(it, mode))}
              >
                <img
                  src={iconSrc}
                  alt=""
                  className="ms-m-icon"
                  style={{ borderColor: color }}
                  loading="lazy"
                />
                <div className="ms-m-row-mid">
                  <div className="ms-m-item-name" style={{ color }}>
                    {row.name}
                  </div>
                  <div className="ms-m-item-meta">{metaLine}</div>
                </div>
                <div className="ms-m-row-right">
                  <div className="ms-m-price">
                    <CopperDisplay copper={row.minPrice} />
                  </div>
                  <div
                    className="ms-m-qty"
                    style={{ color: badgeColor, fontWeight: 700 }}
                  >
                    {badge}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      );
    };

    return (
      <div className="ms-an-mobile-wrap" data-testid="mobile-analytics-panel">
        <div className="ms-m-search-strip">
          <div className="ms-m-chips">
            {([24, 168, 720] as const).map((hrs) => (
              <button
                key={hrs}
                type="button"
                className={`ms-m-chip ${windowHours === hrs ? 'is-active' : ''}`}
                onClick={() => onWindowHoursChange(hrs)}
              >
                {hrs === 24 ? '24h' : hrs === 168 ? '7d' : '30d'}
              </button>
            ))}
            <button
              type="button"
              className={`ms-m-chip ${activeCategory !== 'all' ? 'is-active' : ''}`}
              onClick={() => setMobileCatSheet(true)}
            >
              {activeCategoryLabel} ▾
            </button>
            {mobileSection === 'map' && (
              <button
                type="button"
                className="ms-m-chip is-active"
                onClick={() =>
                  setMapMetric((m) => (m === 'gold' ? 'units' : 'gold'))
                }
              >
                Size: {mapMetric === 'gold' ? 'Gold Cap' : 'Unit Traffic'}
              </button>
            )}
          </div>

          <div className="ms-m-chips">
            {(
              [
                ['map', 'Block Map'],
                ['deals', 'Deals (% of median)'],
                ['gainers', 'Price Surges'],
                ['stable', 'Stable Staples'],
                ['volume', 'Big Volume'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ms-m-chip ${mobileSection === key ? 'is-active' : ''}`}
                onClick={() => setMobileSection(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && !analytics ? (
          <div className="ms-m-pager">Loading {windowLabel} market analytics...</div>
        ) : error ? (
          <div className="ms-m-pager">{error}</div>
        ) : !analytics || !macro ? (
          <div className="ms-m-pager">No analytics data available.</div>
        ) : mobileSection === 'map' ? (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="ms-an-m-kpis">
              <div className="ms-an-m-kpi">
                <span className="ms-an-kpi-lbl">Market Cap</span>
                <strong className="ms-an-kpi-val">
                  <CopperDisplay copper={macro.totalMarketValue} />
                </strong>
              </div>
              <div className="ms-an-m-kpi">
                <span className="ms-an-kpi-lbl">Active Supply</span>
                <strong className="ms-an-kpi-val">
                  {macro.totalUnits.toLocaleString()} units
                </strong>
              </div>
              <div className="ms-an-m-kpi">
                <span className="ms-an-kpi-lbl">Breadth ({windowLabel})</span>
                <strong className="ms-an-kpi-val" style={{ fontSize: '12px' }}>
                  <span style={{ color: '#6ee7b7' }}>▲{macro.risingCount}</span>{' '}
                  · <span style={{ color: '#94a3b8' }}>●{macro.stableCount}</span>{' '}
                  · <span style={{ color: '#fca5a5' }}>▼{macro.fallingCount}</span>
                </strong>
              </div>
              <div className="ms-an-m-kpi">
                <span className="ms-an-kpi-lbl">Captures</span>
                <strong className="ms-an-kpi-val">
                  {macro.sampledCaptures} scans
                </strong>
              </div>
            </div>

            {renderBlockMap(true)}

            <div className="ms-an-legend">
              <span>Tap any block for full chart</span>
              <span>
                <i style={{ background: '#15803d' }} /> Rising
                <i style={{ background: '#334155', marginLeft: 8 }} /> Stable
                <i style={{ background: '#991b1b', marginLeft: 8 }} /> Dip Deal
              </span>
            </div>

            <div className="ms-an-sector-card">
              <div className="ms-an-card-title">Sector Money Share</div>
              {analytics.categories.slice(0, 8).map((cat) => {
                const share = Math.round(
                  (cat.totalMarketValue / totalGlobalGold) * 100,
                );
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`ms-an-sector-row ${activeCategory === cat.id ? 'is-active' : ''}`}
                    onClick={() =>
                      onCategoryChange(activeCategory === cat.id ? 'all' : cat.id)
                    }
                  >
                    <span>{cat.label}</span>
                    <span style={{ color: '#9fb0c7', fontSize: '11px' }}>
                      {cat.totalUnits.toLocaleString()} qty · {share}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : mobileSection === 'deals' ? (
          renderMobileRows(
            analytics.deals,
            'deals',
            macro.sampledCaptures < 2
              ? 'Need at least 2 historical captures in this window to compare prices with the median.'
              : 'No items currently trading significantly below their window median.',
          )
        ) : mobileSection === 'gainers' ? (
          renderMobileRows(
            analytics.gainers,
            'gainers',
            macro.sampledCaptures < 2
              ? 'Need at least 2 historical captures in this window to rank price surges.'
              : 'No major upward price spikes detected in this slice.',
          )
        ) : mobileSection === 'stable' ? (
          renderMobileRows(
            analytics.stableAnchors,
            'stable',
            'No high-supply structurally stable items matched this filter.',
          )
        ) : (
          renderMobileRows(
            analytics.volumeMovers,
            'volume',
            'No high-volume commodities matched this filter.',
            VOLUME_MOVERS_RANKING,
          )
        )}

        {mobileCatSheet && analytics && (
          <div
            className="ms-m-sheet-backdrop"
            onClick={() => setMobileCatSheet(false)}
          >
            <div className="ms-m-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="ms-m-sheet-header">
                <strong style={{ color: '#f3d078' }}>Analytics Sector</strong>
                <button
                  type="button"
                  className="ms-m-pill-btn"
                  onClick={() => setMobileCatSheet(false)}
                >
                  Done
                </button>
              </div>
              <div className="ms-m-sheet-body">
                <button
                  type="button"
                  className={`ms-m-cat-item ${activeCategory === 'all' ? 'is-active' : ''}`}
                  onClick={() => {
                    onCategoryChange('all');
                    setMobileCatSheet(false);
                  }}
                >
                  <span>All Sectors</span>
                </button>
                {analytics.categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`ms-m-cat-item ${activeCategory === cat.id ? 'is-active' : ''}`}
                    onClick={() => {
                      onCategoryChange(cat.id);
                      setMobileCatSheet(false);
                    }}
                  >
                    <span>{cat.label}</span>
                    <span style={{ color: '#9fb0c7' }}>
                      {cat.itemCount} items
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================================================================
  // DESKTOP ANALYTICS WORKSPACE (AH-Style Layout + TSM / Block Map)
  // ================================================================
  const macro = analytics?.macro;

  const renderDesktopTable = (
    title: string,
    subtitle: string,
    items: MarketAnalyticsItem[],
    mode: Leaderboard,
    limit?: number,
  ) => {
    const list = limit ? items.slice(0, limit) : items;
    return (
      <section className="ms-an-card">
        <div className="ms-an-card-head">
          <div>
            <h3 className="ms-an-card-title">{title}</h3>
            <p className="ms-an-card-sub">{subtitle}</p>
          </div>
          {limit && items.length > limit && (
            <button
              type="button"
              className="ms-btn"
              onClick={() => {
                if (mode === 'deals' || mode === 'gainers') {
                  setMoversView(mode);
                  setSection('movers');
                } else setSection(mode);
              }}
            >
              View All
            </button>
          )}
        </div>

        {list.length === 0 ? (
          <div className="ms-an-empty-inline">
            {macro && macro.sampledCaptures < 2 &&
            (mode === 'deals' || mode === 'gainers')
              ? 'Waiting for additional hourly captures in this window to calculate multi-snapshot price deltas.'
              : 'No items matched this filter.'}
          </div>
        ) : (
          <div className="ms-an-table-wrap">
            <table className={`ms-table ms-an-table${limit ? ' ms-an-table-compact' : ''}`}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit Price</th>
                  {!limit && <th>
                    {mode === 'stable'
                      ? `${windowLabel} Avg`
                      : mode === 'volume'
                        ? 'Market Cap'
                        : `${windowLabel} Median`}
                  </th>}
                  {!limit && <th>Supply</th>}
                  <th className="ms-an-signal">
                    {mode === 'deals'
                      ? '% of median'
                      : mode === 'gainers'
                        ? `${windowLabel} Surge`
                        : mode === 'stable'
                          ? 'Stability'
                          : 'Unit change'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => {
                  const row = displayRow(it.row);
                  const details = itemAnalytics(it, mode);
                  const qColor = QUALITY_COLORS[row.quality] ?? '#ffffff';
                  const iconSrc =
                    row.iconUrl ||
                    getItemIconUrl(row.icon ?? DEFAULT_ITEM_ICON);

                  return (
                    <tr
                      key={row.itemKey}
                      className="ms-row-clickable"
                      onClick={() => onSelectItem(row, details)}
                    >
                      <td>
                        <a className="ms-an-item-cell ms-an-item-link" {...itemLink(row, details)}>
                          <img
                            src={iconSrc}
                            alt=""
                            className="ms-an-row-icon"
                            style={{ borderColor: qColor }}
                            loading="lazy"
                          />
                          <div className="ms-an-item-text">
                            <span
                              className="ms-an-item-title"
                              style={{ color: qColor }}
                            >
                              {row.name}
                            </span>
                            <span className="ms-an-item-cat">
                              {row.category}
                            </span>
                          </div>
                        </a>
                      </td>
                      <td>
                        <CopperDisplay copper={row.minPrice} />
                      </td>
                      {!limit && <td>
                        <CopperDisplay
                          copper={
                            mode === 'stable'
                              ? it.windowAvgPrice
                              : mode === 'volume'
                                ? it.marketValueCopper
                                : it.windowMedianPrice
                          }
                        />
                      </td>}
                      {!limit && <td className="ms-an-supply">
                        {row.totalQty.toLocaleString()}
                        <span className="ms-an-muted">
                          {row.listings.toLocaleString()} listings
                        </span>
                      </td>}
                      <td className="ms-an-signal">
                        {mode === 'deals' && (
                          <span className="ms-an-value is-deal">
                            {it.dealPctOfMedian}%
                          </span>
                        )}
                        {mode === 'gainers' && (
                          <span className="ms-an-value is-surge">
                            {formatSignedPct(it.priceChangePct, it.observations)}
                          </span>
                        )}
                        {mode === 'stable' && (() => {
                          const volatility = describeVolatility(it.volatilityPct);
                          return (
                            <>
                              <span className="ms-an-value is-stable">
                                {it.stabilityScore}%
                              </span>
                              <span className="ms-an-muted" title="Price volatility: (max − min) ÷ mean of observed prices">
                                Volatility <span style={{ color: volatility.color }}>{volatility.text}</span>
                              </span>
                            </>
                          );
                        })()}
                        {mode === 'volume' && (
                          <span className="ms-an-value is-vol">
                            {it.observations >= 2
                              ? `${it.qtyDelta > 0 ? '+' : ''}${it.qtyDelta.toLocaleString()}`
                              : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  return (
    <section
      className="ms-panel ms-an-desktop"
      aria-label="Market Analytics Workspace"
      data-testid="desktop-analytics-panel"
    >
      {/* Top Toolbar */}
      <div className="ms-an-toolbar">
        <div className="ms-an-tabs" role="tablist" aria-label="Analytics Views">
          {(
            [
              ['overview', 'Overview & Block Map'],
              ['movers', 'Major Movers & Below-Median Deals'],
              ['stable', 'Structurally Stable'],
              ['volume', 'Large Quantity & Money Flow'],
              ...(moneyMakers ? [['money', 'Money Makers'] as const] : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              className={`ms-an-tab-btn ${section === key ? 'is-active' : ''}`}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ms-an-controls">
          {section === 'overview' && <div className="ms-an-seg" role="group" aria-label="Block Map Sizing">
            <button
              type="button"
              className={`ms-an-seg-btn ${mapMetric === 'gold' ? 'is-active' : ''}`}
              onClick={() => setMapMetric('gold')}
            >
              Gold Cap
            </button>
            <button
              type="button"
              className={`ms-an-seg-btn ${mapMetric === 'units' ? 'is-active' : ''}`}
              onClick={() => setMapMetric('units')}
            >
              Unit Traffic
            </button>
          </div>}

          <div className="ms-an-seg" role="group" aria-label="Historical Window">
            {([24, 168, 720] as const).map((hrs) => (
              <button
                key={hrs}
                type="button"
                className={`ms-an-seg-btn ${windowHours === hrs ? 'is-active' : ''}`}
                onClick={() => onWindowHoursChange(hrs)}
              >
                {hrs === 24 ? '24h' : hrs === 168 ? '7d' : '30d'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Macro KPI Strip */}
      {macro && (
        <div className="ms-an-kpi-grid">
          <div className="ms-an-kpi-card">
            <span className="ms-an-kpi-lbl">
              {activeCategory === 'all' ? 'Total Market Value' : `${activeCategoryLabel} Value`}
            </span>
            <strong className="ms-an-kpi-val">
              <CopperDisplay copper={macro.totalMarketValue} />
            </strong>
            <span className="ms-an-kpi-sub">
              {eraLabel} · {marketLabel} · {faction}
            </span>
          </div>

          <div className="ms-an-kpi-card">
            <span className="ms-an-kpi-lbl">Active Commodity Supply</span>
            <strong className="ms-an-kpi-val">
              {macro.totalUnits.toLocaleString()} units
            </strong>
            <span className="ms-an-kpi-sub">
              {macro.totalListings.toLocaleString()} listings across{' '}
              {macro.uniqueItems.toLocaleString()} items
            </span>
          </div>

          <div className="ms-an-kpi-card">
            <span className="ms-an-kpi-lbl">Market Breadth ({windowLabel})</span>
            <strong className="ms-an-kpi-val">
              <span style={{ color: '#4ade80' }}>▲ {macro.risingCount}</span>
              {'  '}
              <span style={{ color: '#94a3b8' }}>● {macro.stableCount}</span>
              {'  '}
              <span style={{ color: '#f87171' }}>▼ {macro.fallingCount}</span>
            </strong>
            <span className="ms-an-kpi-sub">
              Rising vs stable vs below-median items
            </span>
          </div>

          <div className="ms-an-kpi-card">
            <span className="ms-an-kpi-lbl">Historical Window</span>
            <strong className="ms-an-kpi-val">
              {macro.sampledCaptures}{' '}
              {macro.sampledCaptures === 1 ? 'capture' : 'captures'}
            </strong>
            <span className="ms-an-kpi-sub">
              Sampled over {windowLabel} rolling horizon
            </span>
          </div>
        </div>
      )}

      {/* AH-Style 2-Column Workspace: Sector Sidebar + Main Analytics */}
      <div className="ms-an-workspace">
        <aside className="ms-an-sidebar" aria-label="Market Sectors">
          <div className="ms-an-sidebar-head">
            <span>Sectors</span>
            <span>Gold Share</span>
          </div>
          <button
            type="button"
            className={`ms-an-cat-btn ${activeCategory === 'all' ? 'is-active' : ''}`}
            onClick={() => onCategoryChange('all')}
          >
            <div className="ms-an-cat-top">
              <span>All Sectors</span>
              <span>100%</span>
            </div>
          </button>

          {analytics?.categories.map((cat) => {
            const share = Math.max(
              1,
              Math.round((cat.totalMarketValue / totalGlobalGold) * 100),
            );
            return (
              <button
                key={cat.id}
                type="button"
                className={`ms-an-cat-btn ${activeCategory === cat.id ? 'is-active' : ''}`}
                onClick={() =>
                  onCategoryChange(activeCategory === cat.id ? 'all' : cat.id)
                }
              >
                <div className="ms-an-cat-top">
                  <span>{cat.label}</span>
                  <span>{share}%</span>
                </div>
                <div className="ms-an-cat-sub">
                  <span>{cat.totalUnits.toLocaleString()} qty</span>
                  <span
                    style={{
                      color:
                        cat.avgChangePct > 2
                          ? '#4ade80'
                          : cat.avgChangePct < -2
                            ? '#f87171'
                            : '#94a3b8',
                    }}
                  >
                    {cat.avgChangePct > 0 ? '+' : ''}
                    {cat.avgChangePct.toFixed(1)}%
                  </span>
                </div>
                <div className="ms-an-cat-bar">
                  <div style={{ width: `${Math.min(100, share)}%` }} />
                </div>
              </button>
            );
          })}
        </aside>

        <div className="ms-an-content">
          {section === 'money' && moneyMakers ? (
            moneyMakers
          ) : loading && !analytics ? (
            <div className="ms-an-empty">
              Loading {windowLabel} market analytics...
            </div>
          ) : error ? (
            <div className="ms-an-empty">{error}</div>
          ) : !analytics ? (
            <div className="ms-an-empty">No market snapshot selected.</div>
          ) : section === 'overview' ? (
            <>
              <section className="ms-an-card">
                <div className="ms-an-card-head">
                  <div>
                    <h3 className="ms-an-card-title">
                      Commodity &amp; Traffic Block Map ({activeCategoryLabel})
                    </h3>
                    <p className="ms-an-card-sub">
                      Block size reflects{' '}
                      {mapMetric === 'gold'
                        ? 'total listed gold value (unit price × supply)'
                        : 'total listed unit traffic'}
                      ; color reflects {windowLabel} price movement. Click any block to inspect history.
                    </p>
                  </div>
                  <div className="ms-an-legend">
                    <span>
                      <i style={{ background: '#15803d' }} /> Surge (+15%+)
                    </span>
                    <span>
                      <i style={{ background: '#166534' }} /> Up
                    </span>
                    <span>
                      <i style={{ background: '#334155' }} /> Stable
                    </span>
                    <span>
                      <i style={{ background: '#7f1d1d' }} /> Below Median (Deal)
                    </span>
                  </div>
                </div>
                {renderBlockMap(false)}
              </section>

              <div className="ms-an-two-col">
                {renderDesktopTable(
                  'Below-Median Deals (% of median price)',
                  `Liquid items whose lowest price is below their ${windowLabel} median price, shown as a percentage of that median.`,
                  analytics.deals,
                  'deals',
                  7,
                )}
                {renderDesktopTable(
                  'Major Price Surges',
                  `Items with the steepest upward price movement vs their ${windowLabel} baseline.`,
                  analytics.gainers,
                  'gainers',
                  7,
                )}
              </div>

              <div className="ms-an-two-col">
                {renderDesktopTable(
                  'Structurally Stable Staples',
                  'Consistently stocked items with steady prices (low spread (CV)) — reliable farming & crafting anchors.',
                  analytics.stableAnchors,
                  'stable',
                  7,
                )}
                {renderDesktopTable(
                  'High-Volume Money Movers',
                  VOLUME_MOVERS_RANKING,
                  analytics.volumeMovers,
                  'volume',
                  7,
                )}
              </div>
            </>
          ) : section === 'movers' ? (
            <>
              <div className="ms-an-movers-switch" role="group" aria-label="Mover rankings">
                <button type="button" className="ms-an-tab-btn" aria-pressed={moversView === 'deals'}
                  onClick={() => setMoversView('deals')}>Below-median deals</button>
                <button type="button" className="ms-an-tab-btn" aria-pressed={moversView === 'gainers'}
                  onClick={() => setMoversView('gainers')}>Price surges</button>
              </div>
              {moversView === 'deals'
                ? renderDesktopTable('Below-median deals', `Lowest prices as a share of their ${windowLabel} median.`, analytics.deals, 'deals')
                : renderDesktopTable('Major price surges', `Largest increases over the earlier ${windowLabel} median.`, analytics.gainers, 'gainers')}
            </>
          ) : section === 'stable' ? (
            renderDesktopTable(
              'Structurally Stable Anchors',
              `High-presence items ranked by stability score: steady ${windowLabel} prices (low spread (CV)) and consistent presence. Volatility is shown the addon's way: (max − min) ÷ mean.`,
              analytics.stableAnchors,
              'stable',
            )
          ) : (
            renderDesktopTable(
              'Large Quantity & Gold Volume Movers',
              VOLUME_MOVERS_RANKING,
              analytics.volumeMovers,
              'volume',
            )
          )}
        </div>
      </div>
    </section>
  );
}
