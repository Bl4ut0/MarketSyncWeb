/// <reference types="vite/client" />

import { useEffect, useRef, useState } from 'react';
import { FLAVORS, isFlavorId, type FlavorId } from '@marketsync/shared';

function configuredHarbor(): URL | null {
  const value = import.meta.env.VITE_MARKETSYNC_HARBOR_URL;
  if (!value) return null;

  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const secure = url.protocol === 'https:' || (local && url.protocol === 'http:');
    return secure && url.origin !== window.location.origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export const harborUrl = configuredHarbor();

export function HarborPanel({ url, active }: {
  url: URL;
  active: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const auctionFrame = useRef<HTMLIFrameElement>(null);
  const auction = useRef<HTMLDialogElement>(null);
  const [brokerFlavor, setBrokerFlavor] = useState<FlavorId>();

  useEffect(() => {
    if (!active) return;
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === auctionFrame.current?.contentWindow &&
          event.data?.type === 'marketsync:close-auction') {
        auction.current?.close();
        return;
      }
      if (event.origin !== url.origin || event.source !== frame.current?.contentWindow) return;
      const payload = event.data;
      if (!payload || payload.type !== 'marketsync:open-auction' || !isFlavorId(payload.flavor)) return;
      setBrokerFlavor(payload.flavor);
      if (auction.current && !auction.current.open) auction.current.showModal();
    };

    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [active, url]);

  return (
    <section className="ms-harbor" hidden={!active} aria-label="Explore the map">
      <iframe
        ref={frame}
        src={url.href}
        title="MarketSync explorable map"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        allow="fullscreen"
        referrerPolicy="no-referrer"
      />
      <a href={url.href} target="_blank" rel="noreferrer" className="ms-muted">
        Open map in a new tab ↗
      </a>
      <dialog ref={auction} className="ms-harbor-auction" aria-labelledby="harbor-auction-title">
        <div className="ms-harbor-auction-header">
          <h2 id="harbor-auction-title">{brokerFlavor ? `${FLAVORS[brokerFlavor].shortLabel} Auction House` : 'Auction House'}</h2>
          <button type="button" className="ms-btn ms-btn-ghost" onClick={() => auction.current?.close()} aria-label="Close auction house">×</button>
        </div>
        {brokerFlavor && <iframe ref={auctionFrame} src={`/harbor-auction?flavor=${brokerFlavor}`} title="Auction listings and MarketSync analytics" />}
      </dialog>
    </section>
  );
}
