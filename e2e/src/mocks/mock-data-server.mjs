import http from 'node:http';
import {
  buildFixtureDataset,
  generateLargeForeverSnapshot,
} from '../fixtures/dataset-fixtures.mjs';

const HOURS = ['08', '09', '10'];
const GH_PREFIX = '/Bl4ut0/MarketSyncData/master';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, textOrBuffer) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(textOrBuffer);
}

export async function startMockDataServer(options = {}) {
  const initialState = () => ({
    hourIndex: options.initialHourIndex ?? 1, // '09' by default; advanceHour -> '10'
    largeForever: Boolean(options.largeForever),
    includeLegacyRoot: options.includeLegacyRoot ?? true,
    populateAnniversary: Boolean(options.populateAnniversary),
    failNextCount: 0,
    failStatus: 503,
    delayMs: 0,
    overrides: {}, // Map<relativePath, string>
  });

  let state = initialState();
  let dataset = null;
  let cachedLargeForeverBuf = null;
  const requests = [];

  function rebuildDataset() {
    const maxHour = HOURS[Math.min(Math.max(state.hourIndex, 0), HOURS.length - 1)];
    dataset = buildFixtureDataset({
      maxHour,
      includeLegacyRoot: state.includeLegacyRoot,
      populateAnniversary: state.populateAnniversary,
    });
  }

  function getLargeForeverBuffer() {
    if (!cachedLargeForeverBuf) {
      const { json } = generateLargeForeverSnapshot({ minBytes: 9_500_000 });
      cachedLargeForeverBuf = Buffer.from(json, 'utf8');
    }
    return cachedLargeForeverBuf;
  }

  rebuildDataset();

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const rawPathname = reqUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      return res.end();
    }

    // Control routes
    if (rawPathname === '/__control/advance-hour' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        if (typeof body.hourIndex === 'number') {
          state.hourIndex = Math.min(Math.max(body.hourIndex, 0), HOURS.length - 1);
        } else if (state.hourIndex < HOURS.length - 1) {
          state.hourIndex += 1;
        }
        rebuildDataset();
        return sendJson(res, 200, {
          ok: true,
          hourIndex: state.hourIndex,
          currentHour: HOURS[state.hourIndex],
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (rawPathname === '/__control/set-state' && req.method === 'POST') {
      try {
        const patch = await readJsonBody(req);
        state = {
          ...state,
          ...patch,
          overrides: {
            ...state.overrides,
            ...(patch.overrides || {}),
          },
        };
        rebuildDataset();
        return sendJson(res, 200, { ok: true, state: { ...state, currentHour: HOURS[state.hourIndex] } });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (rawPathname === '/__control/reset' && req.method === 'POST') {
      state = initialState();
      requests.length = 0;
      rebuildDataset();
      return sendJson(res, 200, { ok: true, hourIndex: state.hourIndex, currentHour: HOURS[state.hourIndex] });
    }

    if (rawPathname === '/__control/requests' && req.method === 'GET') {
      return sendJson(res, 200, { count: requests.length, requests: [...requests] });
    }

    // Record data requests
    requests.push({
      method: req.method,
      path: reqUrl.pathname + reqUrl.search,
      timestamp: Date.now(),
    });

    if (state.delayMs > 0) {
      await new Promise((r) => setTimeout(r, state.delayMs));
    }

    if (state.failNextCount > 0) {
      state.failNextCount -= 1;
      return sendText(res, state.failStatus || 503, 'Simulated upstream failure');
    }

    // Normalize optional GitHub raw prefix
    let normPath = rawPathname;
    if (normPath.startsWith(GH_PREFIX + '/')) {
      normPath = normPath.slice(GH_PREFIX.length);
    } else if (normPath === GH_PREFIX) {
      normPath = '/';
    }

    const relPath = normPath.replace(/^\/+/, '');

    if (req.method !== 'GET') {
      return sendText(res, 405, 'Method Not Allowed');
    }

    if (Object.prototype.hasOwnProperty.call(state.overrides, relPath)) {
      return sendText(res, 200, state.overrides[relPath]);
    }

    // On-demand 9+ MB forever snapshot route or flag
    const wantsLarge =
      reqUrl.searchParams.get('large') === '1' ||
      relPath === 'datasets/forever/large/00-00.json' ||
      (state.largeForever && relPath.startsWith('datasets/forever/') && relPath.endsWith('.json'));

    if (wantsLarge) {
      return sendText(res, 200, getLargeForeverBuffer());
    }

    if (dataset.files.has(relPath)) {
      return sendText(res, 200, dataset.files.get(relPath));
    }

    return sendText(res, 404, `404: Not Found (${relPath})`);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    port: addr.port,
    url,
    rawBaseUrl: `${url}${GH_PREFIX}`,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
    reset() {
      state = initialState();
      requests.length = 0;
      rebuildDataset();
    },
    advanceHour(hourIndex) {
      if (typeof hourIndex === 'number') {
        state.hourIndex = Math.min(Math.max(hourIndex, 0), HOURS.length - 1);
      } else if (state.hourIndex < HOURS.length - 1) {
        state.hourIndex += 1;
      }
      rebuildDataset();
      return { hourIndex: state.hourIndex, currentHour: HOURS[state.hourIndex] };
    },
    setState(patch) {
      state = {
        ...state,
        ...patch,
        overrides: {
          ...state.overrides,
          ...(patch.overrides || {}),
        },
      };
      rebuildDataset();
    },
    getState() {
      return { ...state, currentHour: HOURS[state.hourIndex] };
    },
    getRequests() {
      return [...requests];
    },
    clearRequests() {
      requests.length = 0;
    },
  };
}
