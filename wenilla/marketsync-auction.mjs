const marketSyncOrigin = 'https://mstest.bl4ut0.dev';

// Wenilla emits this after the realm accepts the interaction with an auctioneer.
export function connectWenillaAuction(wenilla, flavor) {
  return wenilla.on('AUCTION_HOUSE_SHOW', () => {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'marketsync:open-auction', flavor }, marketSyncOrigin);
  });
}
