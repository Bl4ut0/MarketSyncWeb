import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { formatCopper, type PriceHistoryPoint } from '@marketsync/shared';
import { HISTORY_RANGES, HISTORY_RANGE_LABELS, type HistoryHours } from '../lib/priceHistory.js';

const captureDate = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const numberFormat = new Intl.NumberFormat();
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const shortTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
});

interface ItemHistoryProps {
  points: PriceHistoryPoint[];
  loading: boolean;
  failedCaptures: number;
  hours: HistoryHours;
  onHoursChange: (hours: HistoryHours) => void;
}

export function ItemHistory({ points, loading, failedCaptures, hours, onHoursChange }: ItemHistoryProps) {
  const [metric, setMetric] = useState<'price' | 'supply'>('price');
  const [highlightedTime, setHighlightedTime] = useState<number>();
  const [width, setWidth] = useState(620);
  const plotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const resize = () => {
      if (plot.clientWidth > 0) setWidth(plot.clientWidth);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);
  const first = points[0]!;
  const latest = points[points.length - 1]!;
  const valueA = (point: PriceHistoryPoint) => metric === 'price' ? point.minPrice : point.totalQty;
  const valueB = (point: PriceHistoryPoint) => metric === 'price' ? point.maxPrice : point.listings;
  const formatValue = (value: number) => metric === 'price'
    ? formatCopper(value, { compact: true })
    : numberFormat.format(value);
  const seriesA = metric === 'price' ? 'Lowest unit price' : 'Available quantity';
  const seriesB = metric === 'price' ? 'Highest unit price' : 'Listings';
  const values = points.flatMap((point) => [valueA(point), valueB(point)]);
  const upper = Math.max(...values);
  const lower = metric === 'price' ? Math.min(...values) : 0;
  const selected = points.find((point) => point.timestamp === highlightedTime) ?? latest;
  const change = points.length > 1 && first.minPrice > 0
    ? (latest.minPrice - first.minPrice) / first.minPrice
    : undefined;

  const compactChart = width < 440;
  const height = compactChart ? 204 : 190;
  const tickValues = Array.from(new Set([upper, Math.round((upper + lower) / 2), lower]));
  const formatAxis = (value: number) => {
    if (!compactChart) return formatValue(value);
    if (metric === 'price' && value >= 10000000) return `${compactNumber.format(value / 10000)}g`;
    if (metric === 'supply' && value >= 10000) return compactNumber.format(value);
    return formatValue(value);
  };
  const axisDate = !compactChart
    ? captureDate
    : shortDate.format(first.timestamp * 1000) === shortDate.format(latest.timestamp * 1000) ? shortTime : shortDate;
  const longestTick = Math.max(...tickValues.map((value) => formatAxis(value).length));
  const plotLeft = Math.ceil(longestTick * 7) + 12;
  const plotRight = width - 12;
  const plotTop = 16;
  const plotBottom = height - 34;
  const x = (timestamp: number) => latest.timestamp === first.timestamp
    ? (plotLeft + plotRight) / 2
    : plotLeft + (plotRight - plotLeft) * (timestamp - first.timestamp) / (latest.timestamp - first.timestamp);
  const y = (value: number) => upper === lower
    ? (plotTop + plotBottom) / 2
    : plotBottom - (plotBottom - plotTop) * (value - lower) / (upper - lower);
  const line = (value: (point: PriceHistoryPoint) => number) => points.map((point) =>
    `${x(point.timestamp).toFixed(1)},${y(value(point)).toFixed(1)}`,
  ).join(' ');
  const selectNearest = (event: PointerEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    const position = (event.clientX - bounds.left) * width / bounds.width;
    const nearest = points.reduce((best, point) =>
      Math.abs(x(point.timestamp) - position) < Math.abs(x(best.timestamp) - position) ? point : best);
    setHighlightedTime(nearest.timestamp);
  };

  return (
    <section className="ms-history-section" aria-label="Item market history">
      <div className="ms-section-head ms-history-head">
        <h3>Market history</h3>
        <div className="ms-history-controls">
          <div className="ms-inline-row" role="group" aria-label="History metric">
            <button type="button" className="ms-btn ms-btn-secondary ms-btn-xs" aria-pressed={metric === 'price'} onClick={() => setMetric('price')}>Prices</button>
            <button type="button" className="ms-btn ms-btn-secondary ms-btn-xs" aria-pressed={metric === 'supply'} onClick={() => setMetric('supply')}>Supply</button>
          </div>
          <div className="ms-inline-row" role="group" aria-label="History range">
            {HISTORY_RANGES.map((range) => (
              <button key={range} type="button" className="ms-btn ms-btn-secondary ms-btn-xs"
                aria-pressed={hours === range} onClick={() => onHoursChange(range)}>
                {HISTORY_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ms-chart-frame" data-testid="price-history-chart" data-history-loading={String(loading)} aria-busy={loading}>
        <div className="ms-history-summary" role="status">
          <span>{loading ? 'Loading history…' : `${points.length} sampled ${points.length === 1 ? 'observation' : 'observations'}`}</span>
          {!loading && metric === 'price' && change !== undefined && (
            <span>Lowest unit price from first to last sample <strong>{percentFormat.format(change)}</strong></span>
          )}
          {failedCaptures > 0 && <span>{failedCaptures} unavailable {failedCaptures === 1 ? 'capture' : 'captures'}</span>}
        </div>
        <div ref={plotRef}>
          <svg viewBox={`0 0 ${width} ${height}`} className="ms-history-svg" role="img" aria-label={`${seriesA} and ${seriesB} by capture date`}
            onPointerDown={selectNearest} onPointerMove={selectNearest}>
            {tickValues.map((value) => (
              <g key={value}>
                <line x1={plotLeft} y1={y(value)} x2={plotRight} y2={y(value)} className="ms-chart-grid" />
                <text x={plotLeft - 8} y={y(value)} dy=".35em" textAnchor="end" className="ms-chart-axis-text">
                  {formatAxis(value)}
                </text>
              </g>
            ))}
            {points.length > 1 && (
              <>
                <line x1={x(selected.timestamp)} y1={plotTop} x2={x(selected.timestamp)} y2={plotBottom} className="ms-chart-cursor" />
                <polyline points={line(valueA)} className="ms-chart-line-min" fill="none" />
                <polyline points={line(valueB)} className="ms-chart-line-max" fill="none" />
              </>
            )}
            {points.map((point) => {
              const left = x(point.timestamp);
              return (
                <g key={point.timestamp}>
                  <circle cx={left} cy={y(valueA(point))} r={selected === point ? 5 : 3.5} className="ms-chart-dot-min" />
                  {valueA(point) !== valueB(point) && (
                    <circle cx={left} cy={y(valueB(point))} r={selected === point ? 5 : 3.5} className="ms-chart-dot-max" />
                  )}
                  <title>{captureDate.format(point.timestamp * 1000)} · {formatValue(valueA(point))} / {formatValue(valueB(point))}</title>
                </g>
              );
            })}
            <text x={plotLeft} y={height - 10} className="ms-chart-axis-text">
              {axisDate.format(first.timestamp * 1000)}
            </text>
            {points.length > 1 && <text x={plotRight} y={height - 10} textAnchor="end" className="ms-chart-axis-text">
              {axisDate.format(latest.timestamp * 1000)}
            </text>}
          </svg>
        </div>
        <div className="ms-history-legend">
          <time dateTime={selected.isoDate}>{captureDate.format(selected.timestamp * 1000)}</time>
          <span><i className="ms-series-a" />{seriesA} <strong>{formatValue(valueA(selected))}</strong></span>
          <span><i className="ms-series-b" />{seriesB} <strong>{formatValue(valueB(selected))}</strong></span>
        </div>
      </div>
      {points.length > 1 && (
        <details className="ms-history-data">
          <summary>View observations</summary>
          <table className="ms-table">
            <thead><tr><th scope="col">Captured</th><th scope="col">{seriesA}</th><th scope="col">{seriesB}</th></tr></thead>
            <tbody>{points.map((point) => (
              <tr key={point.timestamp}>
                <td><time dateTime={point.isoDate}>{captureDate.format(point.timestamp * 1000)}</time></td>
                <td>{formatValue(valueA(point))}</td>
                <td>{formatValue(valueB(point))}</td>
              </tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}
