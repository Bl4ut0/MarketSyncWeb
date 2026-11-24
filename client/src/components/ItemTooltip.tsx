import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getCachedWowheadTooltipMeta, getWowheadEnvForFlavor, getWowheadTooltipApiUrl,
  WOWHEAD_TOOLTIP_API, type FlavorId,
} from '@marketsync/shared';
import { snapshotClient, type EnrichedAuctionRow } from '../lib/snapshotClient.js';

const allowedTags = new Set([
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'span', 'div', 'br',
  'b', 'strong', 'i', 'em', 'small', 'p', 'ul', 'ol', 'li', 'a',
]);
const ignoredTags = new Set(['script', 'style', 'template', 'iframe', 'object', 'svg', 'math', 'noscript']);

function renderNodes(nodes: NodeListOf<ChildNode>): ReactNode[] {
  return Array.from(nodes, (node, key) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const tag = node.localName;
    if (ignoredTags.has(tag)) return null;
    const children = renderNodes(node.childNodes);
    if (!allowedTags.has(tag)) return children;
    const className = [...node.classList].filter((name) =>
      /^(?:q\d?|money(?:gold|silver|copper))$/.test(name)).join(' ');
    // Rebuild provider markup without URLs, events, or inline styles.
    return createElement(tag === 'a' ? 'span' : tag, { key, className }, ...children);
  });
}

export function ItemTooltip({ html, loading }: { html?: string; loading: boolean }) {
  const content = useMemo(() => {
    if (!html) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    return renderNodes(template.content.childNodes);
  }, [html]);

  return (
    <div className="ms-inline-item-tooltip" aria-busy={loading}>
      {content ?? <p>{loading ? 'Loading item tooltip…' : 'Tooltip unavailable. View the item on Wowhead.'}</p>}
    </div>
  );
}

interface TooltipData { html?: string; icon?: string }

export function useItemTooltip(item: EnrichedAuctionRow | null, flavor: FlavorId) {
  const itemId = item?.itemId;
  const suffix = item?.suffixId ?? 0;
  const pet = item?.petSpeciesId;
  const key = item ? `${flavor}:${item.itemKey}` : null;
  const cached = itemId && !pet && !suffix ? getCachedWowheadTooltipMeta(itemId, flavor) : undefined;
  const existingHtml = cached?.tooltipHtml ?? (!pet && !suffix ? item?.tooltipHtml : undefined);
  const [result, setResult] = useState<{ key: string; data: TooltipData }>();

  useEffect(() => {
    if (!key || !itemId || existingHtml) return;
    const controller = new AbortController();
    async function load(): Promise<TooltipData> {
      if (!pet && !suffix) {
        const meta = (await snapshotClient.hydrateWowheadItems([itemId!], flavor))[itemId!];
        return { html: meta?.tooltipHtml, icon: meta?.icon };
      }
      const url = pet
        ? `${WOWHEAD_TOOLTIP_API}/${getWowheadEnvForFlavor(flavor).domainPath}tooltip/battle-pet/${pet}`
        : getWowheadTooltipApiUrl(itemId!, flavor, suffix);
      const response = await fetch(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6500)]),
      });
      if (!response.ok) return {};
      const raw = await response.json() as { tooltip?: unknown; icon?: unknown };
      return {
        html: typeof raw.tooltip === 'string' ? raw.tooltip : undefined,
        icon: typeof raw.icon === 'string' && /^[a-z0-9_]+$/i.test(raw.icon) ? raw.icon : undefined,
      };
    }

    void load().catch(() => ({})).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data });
    });
    return () => controller.abort();
  }, [key, itemId, pet, suffix, flavor, existingHtml]);

  const settled = result?.key === key;
  return {
    html: existingHtml ?? (settled ? result?.data.html : undefined),
    icon: cached?.icon ?? (settled ? result?.data.icon : undefined),
    loading: Boolean(key && !existingHtml && !settled),
  };
}
