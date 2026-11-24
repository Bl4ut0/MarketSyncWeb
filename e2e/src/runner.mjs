import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  COVERAGE_THRESHOLDS,
  FEATURES,
  FLAVORS,
  MS1FormatError,
  assertDatasetIndexContract,
  assertSnapshotBlockContract,
  decodeMS1,
  encodeMS1,
} from './contracts.mjs';
import { startMockDataServer } from './mocks/mock-data-server.mjs';
import { startMockOAuthServer } from './mocks/mock-oauth-server.mjs';
import { startMockEmailServer } from './mocks/mock-email-server.mjs';
import { launchBrowser, runBrowserSelfTest } from './browser.mjs';
import { probeAddonCodec, runLuaBridgeSelfTest } from './addon/lua-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SUITES_DIR = path.join(__dirname, 'suites');

function parseOptionalPort(envName) {
  const raw = process.env[envName];
  if (!raw || !raw.trim()) return undefined;
  const num = Number(raw.trim());
  return Number.isInteger(num) && num >= 0 && num <= 65535 ? num : undefined;
}

function mockServerOptions() {
  return {
    data: { port: parseOptionalPort('E2E_MOCK_DATA_PORT') },
    oauth: { port: parseOptionalPort('E2E_MOCK_OAUTH_PORT') },
    email: {
      port: parseOptionalPort('E2E_MOCK_EMAIL_PORT'),
      smtpPort: parseOptionalPort('E2E_MOCK_SMTP_PORT'),
    },
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function terminateChildProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForServerHealth(url, child, label, getLogs, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `${label} exited prematurely with code ${child.exitCode}.\nLogs:\n${getLogs()}`
      );
    }
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.ok === true) {
          return;
        }
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `Timed out waiting for ${label} at ${url}/api/health (${lastErr}).\nLogs:\n${getLogs()}`
  );
}

async function spawnNodeServer({ dataServer, oauthServer, emailServer }) {
  const serverEntry = path.join(ROOT_DIR, 'server', 'dist', 'server.node.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Self-hosted server build missing at ${serverEntry}. Run "npm run build" first.`
    );
  }
  const clientIndex = path.join(ROOT_DIR, 'dist', 'client', 'index.html');
  if (!fs.existsSync(clientIndex)) {
    throw new Error(
      `Client bundle missing at ${clientIndex}. Run "npx vite build client" first.`
    );
  }

  const port = await getFreePort();
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketsync-e2e-db-'));
  const dbPath = path.join(dbDir, 'e2e.db');
  const url = `http://127.0.0.1:${port}`;
  let logs = '';

  const child = spawn(process.execPath, [serverEntry], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      MARKETSYNC_DB_PATH: dbPath,
      MARKETSYNC_DATA_BASE_URL: dataServer.rawBaseUrl,
      BNET_CLIENT_ID: 'test-client-id',
      BNET_CLIENT_SECRET: 'test-client-secret',
      BNET_OAUTH_BASE_URL: oauthServer.url,
      BNET_API_BASE_URL: oauthServer.url,
      MARKETSYNC_EMAIL_WEBHOOK_URL: emailServer.sendUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (d) => {
    logs = (logs + d.toString('utf8')).slice(-8000);
  });
  child.stderr?.on('data', (d) => {
    logs = (logs + d.toString('utf8')).slice(-8000);
  });

  try {
    await waitForServerHealth(url, child, 'self-hosted server', () => logs, 30000);
  } catch (err) {
    await terminateChildProcess(child);
    fs.rmSync(dbDir, { recursive: true, force: true });
    throw err;
  }

  return {
    url,
    async close() {
      await terminateChildProcess(child);
      fs.rmSync(dbDir, { recursive: true, force: true });
    },
  };
}

async function spawnWranglerWorker({ dataServer }) {
  const clientIndex = path.join(ROOT_DIR, 'dist', 'client', 'index.html');
  if (!fs.existsSync(clientIndex)) {
    throw new Error(
      `Client bundle missing at ${clientIndex}. Run "npx vite build client" first.`
    );
  }
  const wranglerBin = path.join(ROOT_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(wranglerBin)) {
    throw new Error(`Wrangler CLI not found at ${wranglerBin}`);
  }

  const port = await getFreePort();
  const inspectorPort = await getFreePort();
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketsync-e2e-cf-'));
  const url = `http://127.0.0.1:${port}`;
  let logs = '';

  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistDir,
      '--show-interactive-dev-session=false',
      '--log-level',
      'warn',
      '--var',
      `MARKETSYNC_DATA_BASE_URL:${dataServer.rawBaseUrl}`,
    ],
    {
      cwd: ROOT_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  child.stdout?.on('data', (d) => {
    logs = (logs + d.toString('utf8')).slice(-8000);
  });
  child.stderr?.on('data', (d) => {
    logs = (logs + d.toString('utf8')).slice(-8000);
  });

  try {
    await waitForServerHealth(url, child, 'wrangler dev', () => logs, 45000);
  } catch (err) {
    await terminateChildProcess(child);
    fs.rmSync(persistDir, { recursive: true, force: true });
    throw err;
  }

  return {
    url,
    async close() {
      await terminateChildProcess(child);
      fs.rmSync(persistDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Test Registry
// ---------------------------------------------------------------------------

export class TestRegistry {
  constructor() {
    this.tests = [];
    this.seenIds = new Set();
  }

  register(def) {
    if (!def || typeof def !== 'object') {
      throw new Error('Test definition must be an object');
    }
    if (typeof def.id !== 'string' || def.id.trim().length === 0) {
      throw new Error('Test definition requires a non-empty string "id"');
    }
    if (this.seenIds.has(def.id)) {
      throw new Error(`Duplicate test id registered: ${def.id}`);
    }
    if (![1, 2, 3, 4].includes(def.tier)) {
      throw new Error(`Test "${def.id}" has invalid tier: ${String(def.tier)} (expected 1|2|3|4)`);
    }
    if (!FEATURES.includes(def.feature)) {
      throw new Error(`Test "${def.id}" has invalid feature: ${String(def.feature)}`);
    }
    if (typeof def.title !== 'string' || def.title.trim().length === 0) {
      throw new Error(`Test "${def.id}" requires a non-empty string "title"`);
    }
    if (!Array.isArray(def.modes) || def.modes.length === 0) {
      throw new Error(`Test "${def.id}" requires a non-empty "modes" array`);
    }
    if (typeof def.run !== 'function') {
      throw new Error(`Test "${def.id}" requires a "run(ctx)" function`);
    }

    this.seenIds.add(def.id);
    this.tests.push(def);
  }
}

async function loadAllSuites() {
  const registry = new TestRegistry();
  if (!fs.existsSync(SUITES_DIR)) {
    return { registry, filesLoaded: [] };
  }
  const entries = fs
    .readdirSync(SUITES_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
    .map((d) => d.name)
    .sort();

  const filesLoaded = [];
  for (const name of entries) {
    const fullPath = path.join(SUITES_DIR, name);
    const mod = await import(pathToFileURL(fullPath).href);
    if (typeof mod.registerTests !== 'function') {
      throw new Error(`Suite file ${name} must export function registerTests(registry)`);
    }
    mod.registerTests(registry);
    filesLoaded.push(name);
  }
  return { registry, filesLoaded };
}

function summarizeCoverage(tests) {
  const byFeature = {};
  for (const f of FEATURES) {
    byFeature[f] = { tier1: 0, tier2: 0, tier3: 0, tier4: 0, total: 0 };
  }
  const byTier = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const t of tests) {
    byTier[t.tier] += 1;
    byFeature[t.feature][`tier${t.tier}`] += 1;
    byFeature[t.feature].total += 1;
  }

  const failures = [];
  for (const f of FEATURES) {
    if (byFeature[f].tier1 < COVERAGE_THRESHOLDS.tier1PerFeature) {
      failures.push(`${f} Tier 1 count ${byFeature[f].tier1} < ${COVERAGE_THRESHOLDS.tier1PerFeature}`);
    }
    if (byFeature[f].tier2 < COVERAGE_THRESHOLDS.tier2PerFeature) {
      failures.push(`${f} Tier 2 count ${byFeature[f].tier2} < ${COVERAGE_THRESHOLDS.tier2PerFeature}`);
    }
  }
  if (byTier[3] < COVERAGE_THRESHOLDS.tier3Total) {
    failures.push(`Tier 3 count ${byTier[3]} < ${COVERAGE_THRESHOLDS.tier3Total}`);
  }
  if (byTier[4] < COVERAGE_THRESHOLDS.tier4Total) {
    failures.push(`Tier 4 count ${byTier[4]} < ${COVERAGE_THRESHOLDS.tier4Total}`);
  }
  if (tests.length < COVERAGE_THRESHOLDS.totalMinimum) {
    failures.push(`Total test count ${tests.length} < ${COVERAGE_THRESHOLDS.totalMinimum}`);
  }

  return {
    total: tests.length,
    byTier,
    byFeature,
    thresholdsMet: failures.length === 0,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Infrastructure Self-Test (--self-test)
// ---------------------------------------------------------------------------

function sendRawSmtpTestEmail(port, { from, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let step = 0;
    let buf = '';
    const cmds = [
      'EHLO localhost\r\n',
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      'DATA\r\n',
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`,
      'QUIT\r\n',
    ];

    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('SMTP client timeout'));
    });
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      while (buf.includes('\n')) {
        const idx = buf.indexOf('\n');
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (/^\d{3}-/.test(line)) continue;
        if (step < cmds.length) {
          socket.write(cmds[step++]);
        } else {
          socket.end();
          resolve();
        }
      }
    });
  });
}

async function runSelfTests() {
  const results = [];
  const startedAt = Date.now();

  async function runCheck(id, title, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      const durationMs = Date.now() - t0;
      results.push({ id, title, status: 'passed', durationMs, detail });
      console.log(`  [PASS] ${id}: ${title} (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      results.push({ id, title, status: 'failed', durationMs, error: err.message });
      console.error(`  [FAIL] ${id}: ${title} (${durationMs}ms) -> ${err.message}`);
    }
  }

  console.log('Running MarketSyncWeb E2E Infrastructure Self-Tests...');

  let dataServer;
  let oauthServer;
  let emailServer;

  try {
    dataServer = await startMockDataServer();
    oauthServer = await startMockOAuthServer();
    emailServer = await startMockEmailServer();

    // 1. Mock Data Server: 5 flavors, legacy/simulated, MIME/CORS, hour advance, corrupt & 404
    await runCheck('SELFTEST-DATA-1', 'MockMarketSyncDataServer 5-flavor, legacy/simulated, advance-hour, corrupt & 404', async () => {
      // Check both root /datasets/... and /Bl4ut0/MarketSyncData/master/datasets/...
      const idxRes = await fetch(`${dataServer.url}/datasets/index.json`);
      assert.equal(idxRes.status, 200);
      assert.equal(idxRes.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(idxRes.headers.get('access-control-allow-origin'), '*');
      const idxJson = JSON.parse(await idxRes.text());
      assertDatasetIndexContract(idxJson);

      // Verify legacy !flavor + simulated block present
      assert.ok(idxJson.blocks.some((b) => !b.flavor && b.simulated === true), 'Expected legacy simulated block');
      for (const flavor of FLAVORS) {
        assert.ok(idxJson.blocks.some((b) => b.flavor === flavor), `Missing index block for flavor ${flavor}`);
      }

      // Check GitHub raw prefix alias
      const ghAliasRes = await fetch(`${dataServer.rawBaseUrl}/datasets/2026-11-22/07-00.json`);
      assert.equal(ghAliasRes.status, 200);
      const legacySimBlock = JSON.parse(await ghAliasRes.text());
      assertSnapshotBlockContract(legacySimBlock);
      assert.equal(legacySimBlock.flavor, undefined);
      assert.ok(legacySimBlock.rulesets.english, 'Legacy simulated block must include english ruleset');

      // Check Forever legacy rulesets (08) & canonical rulesets (09)
      const f08 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/forever/2026-11-22/08-00.json`)).text());
      assert.ok(f08.rulesets.p && f08.rulesets.n && f08.rulesets.r);
      assert.equal(f08.rulesets.p.Neutral['3030'].maxPrice, 99999999999);
      assert.equal(f08.rulesets.p.Alliance['90001'].minPrice, 5000000000);
      assert.ok(f08.rulesets.p.Alliance['13005:4512']);

      const f09 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/forever/2026-11-22/09-00.json`)).text());
      assert.ok(f09.rulesets.pvp && f09.rulesets.normal && f09.rulesets.roleplay && f09.rulesets.roleplaypvp);
      assert.equal(f09.rulesets.pvp.Alliance['13005:4512'].minPrice, 8999);

      // Check classicEra 23 realms & 0 listings (08 omits Alliance; 09 includes all 3)
      const ce08 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/classicEra/2026-11-22/08-00.json`)).text());
      assert.equal(Object.keys(ce08.rulesets).length, 23);
      assert.equal(ce08.rulesets.whitemane.Alliance, undefined);
      assert.equal(ce08.stats.totalItems, 0);

      // Check anniversary 4 realms (including doomhowl)
      const ann09 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/anniversary/2026-11-22/09-00.json`)).text());
      for (const r of ['dreamscythe', 'nightslayer', 'maladath', 'doomhowl']) {
        assert.ok(ann09.rulesets[r], `Missing anniversary realm ${r}`);
      }

      // Check classic Pet Cage & 64-bit copper + empty realm
      const cl08 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/classic/2026-11-22/08-00.json`)).text());
      assert.ok(cl08.rulesets.pagle.CrossFaction['82800:48213']);
      assert.equal(cl08.rulesets.pagle.CrossFaction['92426'].minPrice, 3333330000);
      assert.deepEqual(cl08.rulesets.myzrael.CrossFaction, {});

      // Advance hour to '10' and verify price drops/spikes
      const advRes = await fetch(`${dataServer.url}/__control/advance-hour`, { method: 'POST' });
      const advBody = await advRes.json();
      assert.equal(advBody.currentHour, '10');

      const f10 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/forever/2026-11-22/10-00.json`)).text());
      assert.equal(f10.rulesets.pvp.Alliance['13005:4512'].minPrice, 4500);
      assert.equal(f10.rulesets.pvp.Alliance['13464'].minPrice, 45000);

      const ret10 = JSON.parse(await (await fetch(`${dataServer.url}/datasets/retail/2026-11-22/10-00.json`)).text());
      assert.equal(ret10.rulesets.region.Commodities['2447'].minPrice, 12000);
      assert.equal(ret10.rulesets.region.Commodities['190396'].minPrice, 42000);
      assert.equal(ret10.rulesets.region.Commodities['6306'].minPrice, 29720000000);

      // Corrupt & 404 routes
      const badJsonRes = await fetch(`${dataServer.url}/datasets/corrupt/bad-json.json`);
      assert.equal(badJsonRes.status, 200);
      const badText = await badJsonRes.text();
      assert.throws(() => JSON.parse(badText), SyntaxError);

      const emptyRes = await fetch(`${dataServer.url}/datasets/corrupt/empty-body.json`);
      assert.equal(await emptyRes.text(), '');

      const wrongSchemaRes = await fetch(`${dataServer.url}/datasets/corrupt/wrong-schema.json`);
      const wrongSchemaJson = JSON.parse(await wrongSchemaRes.text());
      assert.throws(() => assertSnapshotBlockContract(wrongSchemaJson));

      const missingRes = await fetch(`${dataServer.url}/datasets/missing/404.json`);
      assert.equal(missingRes.status, 404);

      // Verify requests log & reset
      const reqLog = await (await fetch(`${dataServer.url}/__control/requests`)).json();
      assert.ok(reqLog.count > 5);
      await fetch(`${dataServer.url}/__control/reset`, { method: 'POST' });

      return { port: dataServer.port, requestsLogged: reqLog.count };
    });

    // 2. Mock Data Server: 9+ MB (>= 9,500,000 bytes) deterministic Forever snapshot
    await runCheck('SELFTEST-DATA-9MB', 'Generate & serve >= 9,500,000-byte deterministic forever snapshot', async () => {
      const res = await fetch(`${dataServer.url}/datasets/forever/large/00-00.json`);
      assert.equal(res.status, 200);
      const text = await res.text();
      const byteLength = Buffer.byteLength(text, 'utf8');
      assert.ok(byteLength >= 9_500_000, `Expected >= 9,500,000 bytes, got ${byteLength}`);
      const parsed = JSON.parse(text);
      assertSnapshotBlockContract(parsed);
      assert.equal(parsed.flavor, 'forever');
      assert.equal(parsed.rulesets.pvp.Neutral['3030'].maxPrice, 99999999999);
      assert.ok(parsed.stats.totalItems > 50000);
      return { byteLength, totalItems: parsed.stats.totalItems };
    });

    // 3. Mock Battle.net OAuth Server
    await runCheck('SELFTEST-OAUTH', 'MockBattleNetOAuthServer CSRF, replay, 24h TTL, 5 namespaces (realmless Forever), 401 expiry', async () => {
      // Missing CSRF state -> 400
      const noStateRes = await fetch(
        `${oauthServer.url}/oauth/authorize?response_type=code&client_id=test&redirect_uri=${encodeURIComponent('http://localhost/cb')}`
      );
      assert.equal(noStateRes.status, 400);

      // Valid authorize -> 302 with code & state
      const csrfState = 'csrf_state_xyz_123';
      const redirectUri = 'http://127.0.0.1:9999/api/auth/callback';
      const authRes = await fetch(
        `${oauthServer.url}/oauth/authorize?response_type=code&client_id=test&redirect_uri=${encodeURIComponent(redirectUri)}&state=${csrfState}`,
        { redirect: 'manual' }
      );
      assert.equal(authRes.status, 302);
      const loc = new URL(authRes.headers.get('location'));
      const code = loc.searchParams.get('code');
      assert.ok(code);
      assert.equal(loc.searchParams.get('state'), csrfState);

      // Exchange code for token
      const tokRes = await fetch(`${oauthServer.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      assert.equal(tokRes.status, 200);
      const tokJson = await tokRes.json();
      assert.equal(tokJson.expires_in, 86400);
      assert.ok(tokJson.access_token);

      // Replay same code -> 400 invalid_grant
      const replayRes = await fetch(`${oauthServer.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      });
      assert.equal(replayRes.status, 400);

      // Userinfo
      const uiRes = await fetch(`${oauthServer.url}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${tokJson.access_token}` },
      });
      assert.equal(uiRes.status, 200);
      const uiJson = await uiRes.json();
      assert.equal(uiJson.battletag, 'MarketTester#1337');

      // 5 Namespaces (testing both ?namespace= and Battlenet-Namespace header)
      const namespaces = [
        'profile-us',
        'profile-classic-us',
        'profile-classic1x-us',
        'profile-classicann-us',
        'profile-forever-us',
      ];
      for (const ns of namespaces) {
        const pResQuery = await fetch(`${oauthServer.url}/profile/user/wow?namespace=${ns}`, {
          headers: { Authorization: `Bearer ${tokJson.access_token}` },
        });
        assert.equal(pResQuery.status, 200, `Query namespace failed: ${ns}`);
        const pResHeader = await fetch(`${oauthServer.url}/profile/user/wow`, {
          headers: {
            Authorization: `Bearer ${tokJson.access_token}`,
            'Battlenet-Namespace': ns,
          },
        });
        assert.equal(pResHeader.status, 200, `Header namespace failed: ${ns}`);
        const pJson = await pResHeader.json();
        const ch = pJson.wow_accounts[0].characters[0];
        if (ns === 'profile-forever-us') {
          assert.equal(ch.realm, undefined, 'Forever character must be realmless');
          assert.equal(ch.name, 'Aelindor');
          assert.equal(ch.surname, 'Dawnblade');
        } else {
          assert.ok(ch.realm && ch.realm.slug, `${ns} character must include realm.slug`);
        }
      }

      // Expire tokens -> 401
      await fetch(`${oauthServer.url}/__control/expire-tokens`, { method: 'POST' });
      const expRes = await fetch(`${oauthServer.url}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${tokJson.access_token}` },
      });
      assert.equal(expRes.status, 401);

      return { port: oauthServer.port, namespacesVerified: namespaces.length };
    });

    // 4. Mock Email Server (HTTP + SMTP)
    await runCheck('SELFTEST-EMAIL', 'MockEmailServer HTTP (/send, /webhook, /emails) + SMTP capture', async () => {
      const s1 = await fetch(`${emailServer.url}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'player@example.com',
          subject: 'Dreamfoil Price Drop Alert',
          text: 'Dreamfoil dropped below 5g',
        }),
      });
      assert.equal(s1.status, 202);

      const s2 = await fetch(`${emailServer.url}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alt@example.com',
          subject: 'Peacebloom Alert',
          body: 'Peacebloom dropped below 2g',
        }),
      });
      assert.equal(s2.status, 202);

      await sendRawSmtpTestEmail(emailServer.smtpPort, {
        from: 'noreply@marketsync.local',
        to: 'smtp@example.com',
        subject: 'SMTP Capture Test',
        body: 'Hello over SMTP',
      });

      const listRes = await (await fetch(`${emailServer.url}/emails`)).json();
      assert.equal(listRes.count, 3);
      assert.ok(listRes.emails.some((e) => e.transport === 'smtp' && e.to === 'smtp@example.com'));

      const delRes = await (await fetch(`${emailServer.url}/emails`, { method: 'DELETE' })).json();
      assert.equal(delRes.cleared, 3);
      assert.equal(emailServer.getEmails().length, 0);

      return { port: emailServer.port, smtpPort: emailServer.smtpPort };
    });

    // 5. Reference !MS1! JS Codec Round-Trip + Strict Negative Validation
    await runCheck('SELFTEST-MS1-JS', 'Reference !MS1! codec round-trip & strict CRC32/schema rejection', async () => {
      const sample = {
        v: 1,
        n: 'AQ40 Consumables',
        f: 'forever',
        r: 'pvp',
        fa: 'Alliance',
        i: [
          { id: 13464, s: 0, q: 20, m: 50000, nm: 'Dreamfoil', nt: 'Need 1 stack', d: 0, a: 1 },
          { id: 13005, s: 4512, q: 1, m: 99999999999, d: 1, a: 0 },
        ],
      };
      const encoded = encodeMS1(sample);
      assert.ok(encoded.startsWith('!MS1!'));
      const decoded = decodeMS1(encoded);
      assert.deepEqual(decoded, sample);

      // Tamper CRC32
      const badCrc = encoded.slice(0, -1) + (encoded.endsWith('a') ? 'b' : 'a');
      assert.throws(() => decodeMS1(badCrc), (e) => e instanceof MS1FormatError && e.code === 'BAD_CRC32');

      // Bad prefix
      assert.throws(() => decodeMS1('!MS2!abc.00000000'), (e) => e instanceof MS1FormatError && e.code === 'BAD_PREFIX');

      // Invalid base64url padding
      assert.throws(() => decodeMS1('!MS1!eyJ2IjoxfQ==.00000000'), (e) => e instanceof MS1FormatError && e.code === 'BAD_BASE64URL');

      // Name > 64 chars
      assert.throws(() => encodeMS1({ v: 1, n: 'x'.repeat(65), i: [{ id: 13464, q: 1 }] }), (e) => e instanceof MS1FormatError && e.code === 'BAD_SCHEMA');

      return { encodedLength: encoded.length };
    });

    // 6. Browser Headless Launch (playwright-core)
    await runCheck('SELFTEST-BROWSER', 'Playwright-core headless Chromium launch on HTML+SVG page with zero errors', async () => {
      const info = await runBrowserSelfTest();
      // Also verify error tracking catches intentional pageerror in an isolated page
      const launcher = await launchBrowser();
      try {
        await launcher.withPage(async (session) => {
          await session.page.setContent('<!doctype html><script>setTimeout(() => { throw new Error("expected_probe_err"); }, 0);</script>');
          await session.page.waitForTimeout(100);
          assert.equal(session.pageErrors.length, 1);
          assert.throws(() => session.assertNoErrors(), /expected_probe_err/);
        });
      } finally {
        await launcher.close();
      }
      return info;
    });

    // 7. Lua 5.1 fengari + luaparse Bridge & ListCodec.lua Probe
    await runCheck('SELFTEST-LUA-BRIDGE', 'fengari + luaparse Lua 5.1 AST/VM bridge & ListCodec.lua probe', async () => {
      const probe = probeAddonCodec();
      const res = runLuaBridgeSelfTest();
      if (!probe.addonCodecPresent) {
        console.log('    [INFO] MarketSync/ListCodec.lua not present yet (M2 pending); ran embedded pure-Lua-5.1 !MS1! harness + Favorites.lua/Notifications.lua.');
      }
      return res;
    });
  } finally {
    await Promise.allSettled([
      dataServer?.close(),
      oauthServer?.close(),
      emailServer?.close(),
    ]);
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const report = {
    command: 'self-test',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    passed,
    failed,
    skipped: 0,
    results,
  };

  console.log(`\nSelf-test summary: ${passed} passed, ${failed} failed (${report.durationMs}ms)`);
  return { report, exitCode: failed === 0 ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// Dry-Run (--dry-run)
// ---------------------------------------------------------------------------

async function runDryRun({ allowPartial = false } = {}) {
  const startedAt = Date.now();
  const { registry, filesLoaded } = await loadAllSuites();
  const summary = summarizeCoverage(registry.tests);

  console.log('MarketSyncWeb E2E Suite Dry-Run Summary');
  console.log(`  Suite files loaded (${filesLoaded.length}): ${filesLoaded.length ? filesLoaded.join(', ') : '(none yet)'}`);
  console.log(`  Total tests registered: ${summary.total} (minimum required: ${COVERAGE_THRESHOLDS.totalMinimum})`);
  console.log(`  Tier counts: T1=${summary.byTier[1]}, T2=${summary.byTier[2]}, T3=${summary.byTier[3]} (min ${COVERAGE_THRESHOLDS.tier3Total}), T4=${summary.byTier[4]} (min ${COVERAGE_THRESHOLDS.tier4Total})`);
  console.log('  Feature coverage:');
  for (const f of FEATURES) {
    const fc = summary.byFeature[f];
    console.log(`    ${f}: T1=${fc.tier1}/5  T2=${fc.tier2}/5  T3=${fc.tier3}  T4=${fc.tier4}  Total=${fc.total}`);
  }

  if (!summary.thresholdsMet) {
    console.log(`  Threshold check: INCOMPLETE (${summary.failures.length} gaps)`);
    for (const gap of summary.failures.slice(0, 8)) {
      console.log(`    - ${gap}`);
    }
    if (summary.failures.length > 8) {
      console.log(`    ... and ${summary.failures.length - 8} more`);
    }
  } else {
    console.log('  Threshold check: PASS (all tier & feature minimums satisfied)');
  }

  const exitCode = summary.thresholdsMet || allowPartial ? 0 : 1;
  return {
    report: {
      command: 'dry-run',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      filesLoaded,
      ...summary,
      allowPartial,
    },
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Live E2E Execution (--mode selfhosted|cloudflare|both --tier 1|2|3|4|all)
// ---------------------------------------------------------------------------

async function runLiveSuites({ mode, tier, baseUrl, cfUrl, filter }) {
  const startedAt = Date.now();
  const { registry } = await loadAllSuites();

  if (registry.tests.length === 0) {
    throw new Error('No E2E test suites found in e2e/src/suites/. Run --self-test or implement Tier 1-4 suites first.');
  }

  const targetModes = mode === 'both' ? ['selfhosted', 'cloudflare'] : [mode];
  const tierFilter = tier === 'all' ? null : Number(tier);

  const selectedTests = registry.tests.filter((t) => {
    if (tierFilter && t.tier !== tierFilter) return false;
    if (filter && !(`${t.id} ${t.feature} ${t.title}`.toLowerCase().includes(filter.toLowerCase()))) {
      return false;
    }
    return targetModes.some((m) => t.modes.includes(m) || t.modes.includes('addon'));
  });

  const mockOpts = mockServerOptions();
  const dataServer = await startMockDataServer(mockOpts.data);
  const oauthServer = await startMockOAuthServer(mockOpts.oauth);
  const emailServer = await startMockEmailServer(mockOpts.email);
  const browser = await launchBrowser();
  const spawnedServers = [];
  const results = [];

  try {
    let resolvedSelfHostedUrl = baseUrl;
    let resolvedCloudflareUrl = mode === 'cloudflare' ? (cfUrl || baseUrl) : cfUrl;

    const needsSelfHosted =
      targetModes.includes('selfhosted') &&
      selectedTests.some((t) => t.modes.includes('selfhosted'));
    if (needsSelfHosted && !resolvedSelfHostedUrl) {
      console.log('Spawning self-hosted Node server wired to in-process mocks...');
      const spawnedNode = await spawnNodeServer({ dataServer, oauthServer, emailServer });
      spawnedServers.push(spawnedNode);
      resolvedSelfHostedUrl = spawnedNode.url;
      console.log(`  Self-hosted Node server ready at ${resolvedSelfHostedUrl}`);
    }

    const needsCloudflare =
      targetModes.includes('cloudflare') &&
      selectedTests.some((t) => t.modes.includes('cloudflare'));
    if (needsCloudflare && !resolvedCloudflareUrl) {
      console.log('Spawning Cloudflare Worker (wrangler dev) wired to in-process mock data server...');
      const spawnedCf = await spawnWranglerWorker({ dataServer });
      spawnedServers.push(spawnedCf);
      resolvedCloudflareUrl = spawnedCf.url;
      console.log(`  Cloudflare Worker ready at ${resolvedCloudflareUrl}`);
    }

    for (const targetMode of targetModes) {
      const resolvedUrl =
        targetMode === 'cloudflare' ? resolvedCloudflareUrl : resolvedSelfHostedUrl;
      const modeTests = selectedTests.filter(
        (t) => t.modes.includes(targetMode) || (targetMode === targetModes[0] && t.modes.includes('addon'))
      );

      for (const testCase of modeTests) {
        const t0 = Date.now();
        try {
          if (!resolvedUrl && !testCase.modes.includes('addon')) {
            throw new Error(`Missing URL for mode "${targetMode}" (provide --base-url / --cf-url or omit to auto-spawn)`);
          }
          await testCase.run({
            mode: targetMode,
            baseUrl: resolvedUrl,
            dataServer,
            oauthServer,
            emailServer,
            browser,
          });
          results.push({
            id: testCase.id,
            mode: targetMode,
            tier: testCase.tier,
            feature: testCase.feature,
            title: testCase.title,
            status: 'passed',
            durationMs: Date.now() - t0,
          });
          console.log(`  [PASS] [${targetMode}] ${testCase.id}: ${testCase.title}`);
        } catch (err) {
          results.push({
            id: testCase.id,
            mode: targetMode,
            tier: testCase.tier,
            feature: testCase.feature,
            title: testCase.title,
            status: 'failed',
            durationMs: Date.now() - t0,
            error: err.message,
          });
          console.error(`  [FAIL] [${targetMode}] ${testCase.id}: ${testCase.title} -> ${err.message}`);
        }
      }
    }
  } finally {
    await Promise.allSettled([
      ...spawnedServers.map((s) => s.close()),
      browser.close(),
      dataServer.close(),
      oauthServer.close(),
      emailServer.close(),
    ]);
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const durationMs = Date.now() - startedAt;
  for (const m of targetModes) {
    const mr = results.filter((r) => r.mode === m);
    const mp = mr.filter((r) => r.status === 'passed').length;
    const mf = mr.filter((r) => r.status === 'failed').length;
    console.log(`  [${m}] summary: ${mp} passed, ${mf} failed (${mr.length} total)`);
  }
  console.log(`\nE2E summary: ${passed} passed, ${failed} failed (${durationMs}ms)`);
  return {
    report: {
      command: 'e2e',
      timestamp: new Date().toISOString(),
      durationMs,
      mode,
      tier,
      passed,
      failed,
      skipped: 0,
      results,
    },
    exitCode: failed === 0 ? 0 : 1,
  };
}

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

function writeJsonReport(outPath, report) {
  if (!outPath) return;
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2), 'utf8');
  console.log(`JSON report written to ${resolved}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      'self-test': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'allow-partial': { type: 'boolean', default: false },
      spawn: { type: 'boolean', default: false },
      mode: { type: 'string', default: 'selfhosted' },
      tier: { type: 'string', default: 'all' },
      'base-url': { type: 'string', default: process.env.E2E_BASE_URL || '' },
      'cf-url': { type: 'string', default: process.env.E2E_CF_URL || '' },
      filter: { type: 'string', default: '' },
      json: { type: 'string', default: '' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(`MarketSyncWeb E2E Runner
Usage:
  node src/runner.mjs --self-test [--json <path>]
  node src/runner.mjs --dry-run [--allow-partial] [--json <path>]
  node src/runner.mjs --mode <selfhosted|cloudflare|both> --tier <1|2|3|4|all> [--spawn] [--base-url <url>] [--cf-url <url>] [--filter <str>] [--json <path>]`);
    process.exit(0);
  }

  const rawArgs = process.argv.slice(2);
  const hasExplicitLiveArgs =
    values.spawn ||
    Boolean(values['base-url']) ||
    Boolean(values['cf-url']) ||
    rawArgs.some(
      (a) =>
        a === '--mode' ||
        a.startsWith('--mode=') ||
        a === '--tier' ||
        a.startsWith('--tier=') ||
        a === '--filter' ||
        a.startsWith('--filter=')
    );

  let outcome;
  if (values['dry-run']) {
    outcome = await runDryRun({ allowPartial: values['allow-partial'] });
  } else if (values['self-test'] || !hasExplicitLiveArgs) {
    outcome = await runSelfTests();
  } else {
    outcome = await runLiveSuites({
      mode: values.mode,
      tier: values.tier,
      baseUrl: values['base-url'],
      cfUrl: values['cf-url'],
      filter: values.filter,
    });
  }

  writeJsonReport(values.json, outcome.report);
  process.exit(outcome.exitCode);
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
