import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertCapabilitiesContract,
  assertDatasetIndexContract,
  assertGraceful501Contract,
  assertHealthContract,
  assertItemsMetadataContract,
  assertSnapshotBlockContract,
} from '../../e2e/src/contracts.mjs';
import {
  startMockDataServer,
  type MockDataServer,
} from '../../e2e/src/mocks/mock-data-server.mjs';
import { MockEmailAdapter } from '../src/notifications/email.js';
import { startNodeServer, type RunningNodeServer } from '../src/server.node.js';
import worker from '../src/worker.cf.js';

describe('Dual-Mode Hosting: Cloudflare Worker vs Self-Hosted Node Server', () => {
  let mockData: MockDataServer;
  let nodeServer: RunningNodeServer;

  beforeAll(async () => {
    mockData = await startMockDataServer();
    nodeServer = await startNodeServer({
      port: 0,
      dbPath: ':memory:',
      dataBaseUrl: mockData.rawBaseUrl,
      clientDistDir: path.join(os.tmpdir(), `nonexistent-client-dist-${Date.now()}`),
      oauth: {
        clientId: 'id',
        clientSecret: 'secret',
      },
      emailAdapter: new MockEmailAdapter(),
    });
  });

  afterAll(async () => {
    await nodeServer.close();
    await mockData.close();
  });

  it('Cloudflare Worker serves /api/health, /api/capabilities, dataset proxy, items, and returns 501 JSON on persistence routes', async () => {
    const env = {
      MARKETSYNC_DATA_BASE_URL: mockData.rawBaseUrl,
      ASSETS: {
        async fetch(req: Request) {
          return new Response(`asset:${new URL(req.url).pathname}`, {
            status: 200,
          });
        },
      },
    };
    const ctx = {
      waitUntil: (_p: Promise<unknown>) => {},
    };

    const healthRes = await worker.fetch(
      new Request('https://marketsync.example/api/health'),
      env,
      ctx,
    );
    expect(healthRes.status).toBe(200);
    assertHealthContract(await healthRes.json(), 'cloudflare');

    const capRes = await worker.fetch(
      new Request('https://marketsync.example/api/capabilities'),
      env,
      ctx,
    );
    expect(capRes.status).toBe(200);
    const capBody = (await capRes.json()) as {
      persistence: boolean;
      oauth: boolean;
      email: boolean;
    };
    assertCapabilitiesContract(capBody, 'cloudflare');
    expect(capBody.persistence).toBe(false);
    expect(capBody.oauth).toBe(false);
    expect(capBody.email).toBe(false);

    const indexRes = await worker.fetch(
      new Request('https://marketsync.example/api/datasets/index.json'),
      env,
      ctx,
    );
    expect(indexRes.status).toBe(200);
    assertDatasetIndexContract(await indexRes.json());

    const snapRes = await worker.fetch(
      new Request(
        'https://marketsync.example/api/datasets/snapshot?path=datasets/classic/2026-11-22/09-00.json',
      ),
      env,
      ctx,
    );
    expect(snapRes.status).toBe(200);
    assertSnapshotBlockContract(await snapRes.json());

    const itemsRes = await worker.fetch(
      new Request('https://marketsync.example/api/items?ids=13464,82800:48213'),
      env,
      ctx,
    );
    expect(itemsRes.status).toBe(200);
    assertItemsMetadataContract(await itemsRes.json());

    // All protected persistence/OAuth routes must degrade gracefully with HTTP 501 JSON
    const protectedRequests = [
      new Request('https://marketsync.example/api/auth/login'),
      new Request('https://marketsync.example/api/auth/callback'),
      new Request('https://marketsync.example/api/auth/logout', { method: 'POST' }),
      new Request('https://marketsync.example/api/auth/me'),
      new Request('https://marketsync.example/api/settings/notifications', {
        method: 'PUT',
      }),
      new Request('https://marketsync.example/api/lists'),
      new Request('https://marketsync.example/api/alerts'),
      new Request('https://marketsync.example/api/notifications'),
      new Request('https://marketsync.example/api/notifications/evaluate', {
        method: 'POST',
      }),
    ];

    for (const req of protectedRequests) {
      const res = await worker.fetch(req, env, ctx);
      const body = await res.json();
      assertGraceful501Contract(res.status, body);
    }

    // Non-API request falls back to ASSETS binding
    const assetRes = await worker.fetch(
      new Request('https://marketsync.example/index.html'),
      env,
      ctx,
    );
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe('asset:/index.html');
  });

  it('Self-Hosted Node server exposes health/capabilities and serves 404 gracefully when dist/client is absent', async () => {
    const healthRes = await fetch(`${nodeServer.url}/api/health`);
    expect(healthRes.status).toBe(200);
    assertHealthContract(await healthRes.json(), 'selfhosted');

    const capRes = await fetch(`${nodeServer.url}/api/capabilities`);
    expect(capRes.status).toBe(200);
    const capBody = (await capRes.json()) as {
      persistence: boolean;
      oauth: boolean;
      email: boolean;
    };
    assertCapabilitiesContract(capBody, 'selfhosted');
    expect(capBody.persistence).toBe(true);
    expect(capBody.oauth).toBe(true);
    expect(capBody.email).toBe(true);

    // Without dist/client, non-API route returns clean 404 JSON
    const missingStatic = await fetch(`${nodeServer.url}/`);
    expect(missingStatic.status).toBe(404);
    const missingJson = (await missingStatic.json()) as { error: string };
    expect(missingJson.error).toBe('not_found');
  });

  it('Self-Hosted Node server serves static files + SPA fallback when clientDistDir exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-client-dist-'));
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<!doctype html><html><body>MarketSyncWeb</body></html>',
      'utf8',
    );
    const srv = await startNodeServer({
      port: 0,
      dbPath: ':memory:',
      clientDistDir: tmpDir,
    });
    try {
      const rootRes = await fetch(`${srv.url}/`);
      expect(rootRes.status).toBe(200);
      expect(await rootRes.text()).toContain('MarketSyncWeb');

      const spaRes = await fetch(`${srv.url}/browse/retail`);
      expect(spaRes.status).toBe(200);
      expect(await spaRes.text()).toContain('MarketSyncWeb');
    } finally {
      await srv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects untrusted CORS origins while allowing same-origin, default dev origin, and configured allowedOrigins', async () => {
    // 1. Default configuration (allows same-origin + localhost:5173, rejects evil.example)
    const evilPreflight = await fetch(`${nodeServer.url}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(evilPreflight.status).toBe(204);
    expect(evilPreflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(
      evilPreflight.headers.get('access-control-allow-credentials'),
    ).toBeNull();

    const evilGet = await fetch(`${nodeServer.url}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(evilGet.status).toBe(200);
    expect(evilGet.headers.get('access-control-allow-origin')).toBeNull();
    expect(evilGet.headers.get('access-control-allow-credentials')).toBeNull();

    const devAllowed = await fetch(`${nodeServer.url}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(devAllowed.status).toBe(200);
    expect(devAllowed.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    expect(devAllowed.headers.get('access-control-allow-credentials')).toBe('true');

    const sameOriginAllowed = await fetch(`${nodeServer.url}/api/health`, {
      headers: { Origin: nodeServer.url },
    });
    expect(sameOriginAllowed.status).toBe(200);
    expect(sameOriginAllowed.headers.get('access-control-allow-origin')).toBe(
      nodeServer.url,
    );

    // 2. Explicit allowedOrigins restricts cross-origin to configured allowlist only
    const restrictedSrv = await startNodeServer({
      port: 0,
      dbPath: ':memory:',
      dataBaseUrl: mockData.rawBaseUrl,
      allowedOrigins: 'https://app.marketsync.example',
    });
    try {
      const allowedCustom = await fetch(`${restrictedSrv.url}/api/health`, {
        headers: { Origin: 'https://app.marketsync.example' },
      });
      expect(allowedCustom.headers.get('access-control-allow-origin')).toBe(
        'https://app.marketsync.example',
      );
      expect(allowedCustom.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );

      const disallowedDev = await fetch(`${restrictedSrv.url}/api/health`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(disallowedDev.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await restrictedSrv.close();
    }
  });
});
