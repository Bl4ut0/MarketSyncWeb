const label = document.createElement('span');
label.hidden = true;
label.textContent = 'MarketSync Auctioneer';
label.style.cssText = 'position:fixed;z-index:2;transform:translate(-50%,-100%);color:#ffe4a0;background:#23190eee;border:1px solid #c6a15c;border-radius:5px;padding:.3rem .5rem;pointer-events:none;font:600 .85rem system-ui;white-space:nowrap;';

const auction = document.createElement('dialog');
auction.setAttribute('aria-label', 'Forever Auction House');
auction.setAttribute('closedby', 'any');
auction.innerHTML = `
  <style>
    #walk-auction { width:min(70rem,90%); height:min(45rem,84%); padding:0; background:#241c14; color:#fff0ce; border:2px solid #c6a15c; border-radius:7px; }
    #walk-auction[open] { display:grid; grid-template-rows:auto minmax(0,1fr); }
    #walk-auction::backdrop { background:#0907058a; }
    #walk-auction header { display:flex; align-items:center; justify-content:space-between; padding:.4rem .7rem; font:600 1.05rem system-ui; }
    #walk-auction button { min-width:2.5rem; min-height:2.5rem; color:inherit; background:#532b22; border:1px solid #c6a15c; border-radius:4px; font-size:1.2rem; cursor:pointer; }
    #walk-auction iframe { width:100%; height:100%; border:0; }
  </style>
  <header><span>Forever Auction House</span><button type="button" aria-label="Close auction house">×</button></header>
  <iframe title="Auction listings and MarketSync analytics"></iframe>
`;
auction.id = 'walk-auction';
const close = auction.querySelector('button');
const listings = auction.querySelector('iframe');
const canvas = document.querySelector('#benilla');
let overAuctioneer = false;
close.addEventListener('click', () => auction.close());
auction.addEventListener('close', () => canvas?.focus());
canvas?.addEventListener('contextmenu', (event) => {
  if (overAuctioneer) event.preventDefault();
});
document.body.append(label, auction);

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.source === listings.contentWindow && event.data?.type === 'marketsync:close-auction') {
    auction.close();
    return;
  }
  if (event.source !== window || event.data?.type !== 'marketsync:walk-auctioneer') return;
  const { x, y, reachable, hovered, open } = event.data;
  overAuctioneer = hovered;
  label.hidden = x < 0 || y < 0 || auction.open;
  label.style.left = `${x * 100}%`;
  label.style.top = `${y * 100}%`;
  label.style.borderColor = hovered ? '#ffe4a0' : '#c6a15c';
  label.textContent = reachable ? 'Auctioneer · E or right-click' : 'MarketSync Auctioneer';
  if (open && !auction.open) {
    if (!listings.hasAttribute('src')) listings.src = '/harbor-auction?flavor=forever';
    auction.showModal();
    close.focus();
  }
});
