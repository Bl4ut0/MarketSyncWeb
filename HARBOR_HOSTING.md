# Host the MarketSync map

The Auction House opens by default. Public builds omit **Enter Azeroth** while the walk mode is being tested. A desktop preview can opt in by setting `VITE_MARKETSYNC_HARBOR_URL` before the build. Brokers open the Auction House over the running world, and selecting an item opens MarketSync analytics over the listings.

## Build Lantern Quay

Run `npm.cmd run build:harbor` from `MarketSyncWeb`. The bundled site in `dist/harbor` contains the original Three.js scene and its static assets. Character names and outfits are session state. The harbor uses the existing MarketSync Auction House for item data.

## Upload to the domain directory

The verified document root is `/domains/explore.bl4ut0.dev/public_html`. The PKI upload project supplies the existing VLE account and public CA certificate. The VLE endpoint and `test.pki.bl4ut0.dev` resolved to the same server. The successful FTPS session used `test.pki.bl4ut0.dev` as the TLS server name and verified its certificate against the PKI CA. Upload the hashed `assets/` files first, then publish `index.html` at the document root.

Check that public DNS resolves `explore.bl4ut0.dev` and that the site serves the map before enabling the MarketSync toggle.

## Add an auctioneer

The five Lantern Quay brokers are defined in `harbor/main.js`. They embed the edition-specific `/harbor-auction` page in a dialog. An external scene embedded by MarketSync can instead send this message after verifying that the player is within range. MarketSync then displays the same auction page in a dialog over the scene.

```js
window.parent.postMessage(
  { type: 'marketsync:open-auction', flavor: 'forever' },
  'https://mstest.bl4ut0.dev',
);
```

Supported edition values are `forever`, `classicEra`, `anniversary`, `classic`, and `retail`. MarketSync accepts the message only from its configured map frame and origin. The NPC opens the same auction browser visitors use directly, with its current data and item analytics.

## Test the offline build locally

The local source checkout at `third_party/azeroth-survivors-re` is pinned to `72048f4056e2a57d99234e4fb658179e577d1d92`. Its browser entry point runs the offline mode. The offline build can test character selection, movement, camera controls, and environment rendering without a realm. It does not exercise real realm auctioneer events, player presence, or chat. [Offline source and client data requirements](https://github.com/OutThisLife/azeroth-survivors-re#the-game-data-not-in-this-repo)

Use a WebGPU-capable browser and a local copy of the WoW 1.12.1 build 5875 `Data/` directory available for private testing. In a Linux build environment with Git, Rust and native build tools installed, run the toolchain and WASM targets separately from the imported checkout. The checkout currently contains source only. Its combined `make build` target also fetches game data, so use the separate targets with an existing local data path.

```bash
make toolchain
make wasm
cargo run --release -p wenilla-host -- --www web/dist --data /absolute/path/to/Data --bind 127.0.0.1:8090
```

Open `http://127.0.0.1:8090/`. Check character selection, walking and turning, camera zoom, and input focus after tabbing away and back. Leave the test on loopback, because the development host serves assets without authentication. [Browser build and hosting requirements](https://github.com/OutThisLife/azeroth-survivors-re/blob/main/web/README.md)

### Local MarketSync walk mode

Apply `wenilla/marketsync-walk.patch` to the pinned checkout before rebuilding the WebGPU bundle. The mode is enabled with `?marketsync_walk=1`. The existing picker sets the zone. After entering it, the character starts near a stationary auctioneer, stays within 26 yards of the starting point, and uses a close, orbiting camera. Hostile waves, automatic spells, survival progression, and its HUD are disabled in this mode.

Serve the modified bundle with the local Wenilla host on port `18093`, with the client directory mounted read-only. Run `node wenilla/local-walk-preview.mjs` from MarketSyncWeb and open `http://127.0.0.1:18094/`. This loopback gateway adds the auctioneer nameplate and the existing MarketSync auction window. Right-click the auctioneer or press **E** within four yards to open it. Its market requests go to MarketSync’s public data endpoints.

## Set up Wenilla realm hosting later

The realm tracks shared characters, NPCs, and chat. Wenilla's authenticated play service sends browser traffic to it over WebSockets, and MarketSync supplies the listings and analytics. The deployment guide uses an x86-64 Linux VM with Docker Engine and Compose v2 and recommends a starting size of 2 vCPU, 4 GB RAM, and 40 GB storage for a small realm without bots. [Wenilla realm setup](https://github.com/Arnesen/wenilla-realm/blob/main/docs/SETUP.md)

VLE was verified over SSH on November 22, 2026. It runs Ubuntu 24.04 LTS on x86-64 with 4 CPUs, 3.7 GiB RAM, no swap, and 24 GB free before the installation. Docker Engine 29.1.3 and Compose 2.40.3 were installed from Ubuntu's packages. Apache already serves ports 80 and 443. Route Explore through the existing Apache virtual host when ready, including WebSocket upgrades for realm play.

The private preview checkout is `~/marketsync-wenilla` on VLE. The project copy of its override is `wenilla/compose.loopback.yaml`. It publishes the realm web service only at `127.0.0.1:8090`. The initial stack starts MariaDB, the database initializer, and Wenilla's web service against the upstream empty-data fixture. The upstream Compose file mounts its separately managed `CLIENT_DATA` path read-only. Start the world server only when the appropriate client data and realm data are available. [Wenilla’s web-service smoke test](https://github.com/Arnesen/wenilla-realm/blob/main/.github/workflows/smoke.yml)

```bash
cd ~/marketsync-wenilla
sudo docker compose -p marketsync-wenilla -f compose.yaml -f compose.loopback.yaml ps -a
curl -fsS http://127.0.0.1:8090/healthz
```

1. Identify the Linux host, verify Docker Compose and HTTPS access, and bring up a private preview with the realm's authenticated play service. Keep the realm ports and database internal. For any public deployment, confirm permission to serve the game assets before configuring the asset endpoint.
2. Verify the HTTPS play page, the authenticated asset requests, and the WebSocket connection. Use two independent sessions to check movement, player visibility, and chat. Confirm that the play page can be embedded by `https://mstest.bl4ut0.dev` before testing the MarketSync bridge.
3. Add the auction bridge to the realm play page. Right-click an auctioneer and verify both MarketSync windows. Test closing the windows and continuing from the same position. Once the preview passes, route `explore.bl4ut0.dev` to the verified service and retain the prior origin for rollback.

### Connect the MarketSync auction window

Use a play page that emits Wenilla's `AUCTION_HOUSE_SHOW` event after the realm confirms an auctioneer interaction.

Copy `wenilla/marketsync-auction.mjs` beside the play page's `bridge.js`. Enable Wenilla's JavaScript bridge in the play page before starting the WASM module. Register the listener once with that page's MarketSync edition.

```js
import { wenilla } from './bridge.js';
import { connectWenillaAuction } from './marketsync-auction.mjs';

const disconnect = connectWenillaAuction(wenilla, 'forever');
// Call disconnect() if the page tears down and remounts the realm client.
```

For integration testing, configure a MarketSync build with the realm play URL, then enter a character and right-click an auctioneer. Verify that the auction dialog appears over the canvas and item analytics open inside it. A shared presence and chat test also needs two independent realm sessions.

## Build the frontend for the verified map URL

Run these commands in `MarketSyncWeb` only when the public map host has been verified and the entry is ready to be restored. The map URL is public build configuration. Use the existing Cloudflare CLI session for deployment and use your existing server login through SSH, SFTP, or the hosting panel when setting up the map host.

```powershell
$env:VITE_MARKETSYNC_HARBOR_URL = 'https://explore.bl4ut0.dev/'
npm.cmd run build -w @marketsync/client
& ./node_modules/.bin/wrangler.cmd deploy --dry-run
```

On the preview, verify that the Auction House opens first and **Enter Azeroth** loads the world. Open an NPC’s auction window and an item’s MarketSync analytics, then close both windows to return to the same spot. Once the preview passes, publish the frontend with the project’s existing Wrangler deployment workflow and `--keep-vars`.
