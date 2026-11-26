import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEFAULT_ITEM_ICON,
  getItemIconUrl,
  getWowheadItemUrl,
  type FactionPartition,
  type FlavorId,
  type PriceHistoryPoint,
} from '@marketsync/shared';
import type { EnrichedAuctionRow } from '../lib/snapshotClient.js';
import { CopperDisplay } from './CopperDisplay.js';
import { ItemBadge } from './ItemBadge.js';
import { ItemHistory } from './ItemHistory.js';
import { ItemTooltip, useItemTooltip } from './ItemTooltip.js';
import { HISTORY_RANGE_LABELS, type HistoryHours } from '../lib/priceHistory.js';
import { describeVolatility, type ItemAnalyticsDetails } from '../lib/marketAnalytics.js';

const formatChange = new Intl.NumberFormat(undefined, {
  style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero',
});

interface ItemDetailModalProps {
  item: EnrichedAuctionRow | null;
  flavor: FlavorId;
  partitionKey: string;
  partitionLabel: string;
  faction: FactionPartition;
  historyPoints: PriceHistoryPoint[];
  historyLoading: boolean;
  historyFailures: number;
  historyHours: HistoryHours;
  onHistoryHoursChange: (hours: HistoryHours) => void;
  captureTimestamp?: number;
  headerBottom?: number;
  onClose: () => void;
  mobile: boolean;
  returnLabel: string;
  comparison?: ItemAnalyticsDetails;
  onViewVariant?: (item: EnrichedAuctionRow) => void;
  onViewParent?: () => void;
  onAddToShoppingList?: (item: EnrichedAuctionRow, qty: number, maxPriceCopper?: number) => void;
  showAnalyticsTitle?: boolean;
  canCreateAlert: boolean;
  onQuickAlert?: (item: EnrichedAuctionRow, maxPriceCopper: number) => void;
}

export function ItemDetailModal({
  item,
  flavor,
  partitionKey,
  partitionLabel,
  faction,
  historyPoints,
  historyLoading,
  historyFailures,
  historyHours,
  onHistoryHoursChange,
  captureTimestamp,
  headerBottom,
  onClose,
  mobile,
  returnLabel,
  comparison,
  onViewVariant,
  onViewParent,
  onAddToShoppingList,
  showAnalyticsTitle,
  canCreateAlert,
  onQuickAlert,
}: ItemDetailModalProps) {
  const [qty, setQty] = useState(1);
  const [addedFeedback, setAddedFeedback] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mobileBack = useRef<HTMLButtonElement>(null);
  const tooltipSection = useRef<HTMLElement>(null);
  const itemKey = item?.itemKey;
  const isOpen = Boolean(item);
  const tooltip = useItemTooltip(mobile ? item : null, flavor);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!mobile || !isOpen || !sheet) return;
    sheet.showModal();
    return () => {
      if (sheet.open) sheet.close();
    };
  }, [isOpen, mobile]);

  useLayoutEffect(() => {
    if (!mobile || !itemKey) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    mobileBack.current?.focus({ preventScroll: true });
  }, [mobile, itemKey]);

  useEffect(() => {
    setQty(1);
    setAddedFeedback(false);
  }, [itemKey, item?.variants]);

  useEffect(() => {
    if (mobile || !itemKey || !showAnalyticsTitle) return;
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [mobile, itemKey, showAnalyticsTitle]);

  useEffect(() => {
    if (mobile || !isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobile, isOpen, onClose]);

  if (!item) return null;

  const timestamp = captureTimestamp ?? item.time;
  const observedPrice: PriceHistoryPoint = {
    timestamp,
    isoDate: new Date(timestamp * 1000).toISOString(),
    minPrice: item.minPrice,
    maxPrice: item.maxPrice,
    totalQty: item.totalQty,
    listings: item.listings,
  };
  const tooltipIcon = item.icon === DEFAULT_ITEM_ICON ? tooltip.icon : undefined;
  const volatility = describeVolatility(comparison?.volatilityPct);

  const body = (
    <div className="ms-detail-body" ref={bodyRef}>
      <div className="ms-modal-header">
        <div className="ms-detail-title-wrap">
          <ItemBadge
            quality={item.quality}
            category={item.category}
            isPetCage={item.isPetCage}
            icon={tooltipIcon ?? item.icon}
            iconUrl={tooltipIcon ? getItemIconUrl(tooltipIcon) : item.iconUrl}
            size="lg"
          />
          <div>
            {showAnalyticsTitle && <div id="item-analytics-label" className="ms-detail-analytics-label">MarketSync analytics</div>}
            <h2
              id="item-detail-title"
              className={`ms-detail-title ms-quality-text-${item.quality}`}
            >
              {item.name}
            </h2>
            <div className="ms-detail-meta">
              <span>Key: {item.itemKey}</span>
              <span>•</span>
              <span>
                {item.category}
                {item.subCategory ? ` (${item.subCategory})` : ''}
              </span>
              {item.itemLevel !== undefined && (
                <>
                  <span>•</span>
                  <span>iLvl {item.itemLevel}</span>
                </>
              )}
              {item.reqLevel !== undefined && (
                <>
                  <span>•</span>
                  <span>Req Lv {item.reqLevel}</span>
                </>
              )}
              <span>•</span>
              <span>
                {flavor} / {partitionLabel || partitionKey} / {faction}
              </span>
              <a className="ms-wowhead-link" href={getWowheadItemUrl(item.itemId, flavor, item.petSpeciesId, item.suffixId)}
                target="_blank" rel="noreferrer" data-disable-wowhead-tooltip="true">
                View on Wowhead ↗
              </a>
            </div>
            {mobile && (
              <button type="button" className="ms-btn ms-btn-ghost ms-detail-tooltip-jump"
                onClick={() => tooltipSection.current?.scrollIntoView({ block: 'start' })}>
                Item tooltip ↓
              </button>
            )}
          </div>
        </div>
        {!mobile && <button
          ref={closeButton}
          type="button"
          className="ms-btn ms-btn-ghost"
          onClick={onClose}
          aria-label="Close item details"
        >
          ✕
        </button>}
      </div>

      {!mobile && onViewParent && (
        <button type="button" className="ms-btn ms-btn-secondary ms-detail-back" onClick={onViewParent}>
          ← Back to item
        </button>
      )}

      {comparison && (
        <section className="ms-detail-comparison" aria-label="Item analytics">
          <div>
            <h3>Item analytics · {HISTORY_RANGE_LABELS[comparison.hours]}</h3>
            <span>{comparison.observations} {comparison.observations === 1 ? 'observation' : 'observations'}</span>
          </div>
          <dl className="ms-detail-analytics-metrics">
            <div>
              <dt>Price change</dt>
              <dd>{comparison.observations > 1 ? formatChange.format(comparison.priceChangePct / 100) : '—'}</dd>
            </div>
            <div>
              <dt>Earlier price median</dt>
              <dd>{comparison.observations > 1 ? <CopperDisplay copper={comparison.baselinePrice} /> : '—'}</dd>
            </div>
            <div>
              <dt>Window price median</dt>
              <dd><CopperDisplay copper={comparison.windowMedianPrice} /></dd>
            </div>
            {comparison.source === 'deals' && (
              <div><dt>% of window median</dt><dd>{comparison.dealPctOfMedian}%</dd></div>
            )}
            {comparison.source === 'stable' && (
              <>
                <div><dt>Stability score</dt><dd>{comparison.stabilityScore}%</dd></div>
                <div>
                  <dt>Price volatility</dt>
                  <dd style={{ color: volatility.color }}>{volatility.text}</dd>
                </div>
                <div><dt>Price spread (CV)</dt><dd>{(comparison.volatilityCv * 100).toFixed(1)}%</dd></div>
                <div><dt>Average unit price</dt><dd><CopperDisplay copper={comparison.windowAvgPrice} /></dd></div>
              </>
            )}
            {comparison.source === 'volume' && (
              <>
                <div><dt>Listed value</dt><dd><CopperDisplay copper={comparison.marketValueCopper} /></dd></div>
                <div>
                  <dt>Supply change</dt>
                  <dd>{comparison.observations > 1
                    ? `${comparison.qtyDelta > 0 ? '+' : ''}${comparison.qtyDelta.toLocaleString()} (${formatChange.format(comparison.qtyChangePct / 100)})`
                    : '—'}</dd>
                </div>
                <div><dt>Earlier median supply</dt><dd>{comparison.observations > 1 ? comparison.baselineQty.toLocaleString() : '—'}</dd></div>
              </>
            )}
          </dl>
          <p>{comparison.observations > 1
            ? `${comparison.source === 'block' ? 'The block map percentage' : 'Price change'} compares the latest lowest unit price with the median of earlier observations.`
            : 'An earlier observation is needed to calculate a change.'}</p>
          {comparison.source === 'deals' && (
            <p><strong>{comparison.dealPctOfMedian}% of median</strong> means the current lowest price is {comparison.dealPctOfMedian}% of the median price across all samples in the window.</p>
          )}
          {comparison.source === 'stable' && <p>Price volatility is (highest − lowest) ÷ average of the observed prices, as in the addon. The stability score combines the price spread (CV, standard deviation ÷ average) with how often the item appeared in the captures.</p>}
          {comparison.source === 'volume' && <p>Listed value uses the lowest unit price and current quantity. Supply change compares quantity with the earlier median.</p>}
        </section>
      )}

      <div className="ms-detail-stats-grid">
        <div className="ms-stat-card">
          <span className="ms-stat-label">Lowest unit price</span>
          <strong className="ms-stat-value">
            <CopperDisplay copper={item.minPrice} />
          </strong>
        </div>
        <div className="ms-stat-card">
          <span className="ms-stat-label">Highest unit price</span>
          <strong className="ms-stat-value">
            <CopperDisplay copper={item.maxPrice} />
          </strong>
        </div>
        <div className="ms-stat-card">
          <span className="ms-stat-label">Total Quantity</span>
          <strong className="ms-stat-value">
            {item.totalQty.toLocaleString('en-US')}
          </strong>
        </div>
        <div className="ms-stat-card">
          <span className="ms-stat-label">Listings</span>
          <strong className="ms-stat-value">
            {item.listings.toLocaleString('en-US')}
          </strong>
        </div>
      </div>

      <ItemHistory
        key={item.variants ? `group-${item.itemKey}` : item.itemKey}
        points={historyPoints.length ? historyPoints : [observedPrice]}
        loading={historyLoading}
        failedCaptures={historyFailures}
        hours={historyHours}
        onHoursChange={onHistoryHoursChange}
      />

      {mobile && (
        <section ref={tooltipSection} className="ms-detail-tooltip" aria-labelledby="item-tooltip-heading">
          <h3 id="item-tooltip-heading">Item tooltip</h3>
          <ItemTooltip html={tooltip.html} loading={tooltip.loading} />
        </section>
      )}

      {item.variants && onViewVariant && (
        <details className="ms-detail-variants" open={!mobile ? true : undefined}>
          <summary>Listings by variant ({item.variants.length})</summary>
          {item.variants.map((variant) => (
            <button
              key={variant.itemKey}
              type="button"
              className="ms-btn ms-btn-secondary ms-detail-variant"
              onClick={() => onViewVariant(variant)}
            >
              <span>{variant.suffixId ? `Variant #${variant.suffixId}` : 'Base item'}</span>
              <span><CopperDisplay copper={variant.minPrice} /> · {variant.totalQty.toLocaleString('en-US')} available</span>
            </button>
          ))}
        </details>
      )}

      {!item.variants && onAddToShoppingList && <div className="ms-detail-actions">
        <div className="ms-inline-field">
          <label htmlFor="detail-add-qty">Qty</label>
          <input
            id="detail-add-qty"
            type="number"
            min={1}
            max={9999}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="ms-input ms-input-sm"
          />
        </div>

        <button
          type="button"
          className="ms-btn ms-btn-primary"
          data-testid="add-to-list-btn"
          onClick={() => {
            onAddToShoppingList(item, qty, item.minPrice);
            setAddedFeedback(true);
          }}
        >
          {addedFeedback ? 'Added to Shopping List ✓' : 'Add to Shopping List'}
        </button>

        {canCreateAlert && onQuickAlert && (
          <button
            type="button"
            className="ms-btn ms-btn-secondary"
            onClick={() => onQuickAlert(item, item.minPrice)}
          >
            Create Price Alert
          </button>
        )}
      </div>}
    </div>
  );

  if (mobile) {
    return (
      <dialog
        ref={sheetRef}
        className="ms-detail-sheet"
        aria-labelledby="item-detail-title"
        onCancel={(event) => { event.preventDefault(); onClose(); }}
      >
        <div className="ms-detail-sheet-nav">
          <button type="button" ref={mobileBack} className="ms-btn ms-btn-ghost" onClick={onViewParent ?? onClose}>
            <span aria-hidden="true">←</span> {onViewParent ? 'Back to item' : returnLabel}
          </button>
          {onViewParent && (
            <button type="button" className="ms-btn ms-btn-ghost" onClick={onClose} aria-label="Close item details">✕</button>
          )}
        </div>
        {body}
      </dialog>
    );
  }

  return (
    <div
      className="ms-modal-backdrop ms-detail-backdrop"
      role="dialog"
      style={{ top: headerBottom }}
      aria-modal={showAnalyticsTitle || undefined}
      aria-labelledby={showAnalyticsTitle ? 'item-analytics-label item-detail-title' : 'item-detail-title'}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="ms-modal ms-detail-modal">{body}</div>
    </div>
  );
}
