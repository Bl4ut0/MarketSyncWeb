import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import type { BnetOAuthConfig } from './auth/battlenet.js';
import {
  NullEmailAdapter,
  WebhookEmailAdapter,
  type EmailAdapter,
} from './notifications/email.js';
import { SmtpEmailAdapter } from './notifications/smtp.node.js';
import { DEFAULT_DATA_BASE_URL } from './proxy.js';
import { SqliteStorageAdapter } from './storage/sqlite.js';
import type { StorageAdapter } from './storage/types.js';

export interface NodeServerOptions {
  port?: number;
  hostname?: string;
  dbPath?: string;
  dataBaseUrl?: string;
  clientDistDir?: string;
  oauth?: BnetOAuthConfig;
  emailAdapter?: EmailAdapter;
  evaluateSecret?: string;
  allowedOrigins?: string | readonly string[];
  fetchImpl?: typeof fetch;
  version?: string;
}

export interface RunningNodeServer {
  app: Hono;
  server: Server;
  port: number;
  url: string;
  storage: StorageAdapter;
  emailAdapter: EmailAdapter;
  close(): Promise<void>;
}

function resolveDefaultClientDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Handles both server/src/server.node.ts and server/dist/server.node.js
  return path.resolve(here, '..', '..', 'dist', 'client');
}

export function resolveEmailAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): EmailAdapter {
  if (env.MARKETSYNC_EMAIL_WEBHOOK_URL) {
    return new WebhookEmailAdapter({
      webhookUrl: env.MARKETSYNC_EMAIL_WEBHOOK_URL,
      from: env.MARKETSYNC_EMAIL_FROM,
      authToken: env.MARKETSYNC_EMAIL_WEBHOOK_TOKEN,
      fetchImpl,
    });
  }

  if (env.MARKETSYNC_SMTP_HOST) {
    const port = Number(env.MARKETSYNC_SMTP_PORT || '587');
    return new SmtpEmailAdapter({
      host: env.MARKETSYNC_SMTP_HOST,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      from: env.MARKETSYNC_EMAIL_FROM || env.MARKETSYNC_SMTP_FROM,
      secure: env.MARKETSYNC_SMTP_SECURE === '1' || env.MARKETSYNC_SMTP_SECURE === 'true',
      username: env.MARKETSYNC_SMTP_USER,
      password: env.MARKETSYNC_SMTP_PASS,
    });
  }

  return new NullEmailAdapter();
}

export function resolveOAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BnetOAuthConfig {
  return {
    clientId: env.BNET_CLIENT_ID || undefined,
    clientSecret: env.BNET_CLIENT_SECRET || undefined,
    redirectUri: env.BNET_REDIRECT_URI || undefined,
    oauthBaseUrl: env.BNET_OAUTH_BASE_URL || undefined,
    apiBaseUrl: env.BNET_API_BASE_URL || undefined,
  };
}

export function createNodeApp(options: NodeServerOptions = {}): {
  app: Hono;
  storage: SqliteStorageAdapter;
  emailAdapter: EmailAdapter;
} {
  const dbPath =
    options.dbPath ?? process.env.MARKETSYNC_DB_PATH ?? './data/marketsync.db';
  const storage = new SqliteStorageAdapter(dbPath);
  const emailAdapter =
    options.emailAdapter ??
    resolveEmailAdapterFromEnv(process.env, options.fetchImpl);
  const dataBaseUrl =
    options.dataBaseUrl ??
    process.env.MARKETSYNC_DATA_BASE_URL ??
    DEFAULT_DATA_BASE_URL;
  const oauth = options.oauth ?? resolveOAuthConfigFromEnv(process.env);

  const app = createApp({
    mode: 'selfhosted',
    version: options.version ?? '0.1.0',
    storage,
    emailAdapter,
    dataBaseUrl,
    oauth,
    fetchImpl: options.fetchImpl,
    evaluateSecret:
      options.evaluateSecret ?? process.env.MARKETSYNC_EVALUATE_KEY,
    allowedOrigins:
      options.allowedOrigins ?? process.env.MARKETSYNC_ALLOWED_ORIGINS,
  });

  const clientDistDir =
    options.clientDistDir ??
    process.env.MARKETSYNC_CLIENT_DIST ??
    resolveDefaultClientDistDir();

  if (fs.existsSync(clientDistDir) && fs.statSync(clientDistDir).isDirectory()) {
    app.use('*', serveStatic({ root: clientDistDir }));
    const indexHtmlPath = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.get('*', (c, next) => {
        if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
          return next();
        }
        const html = fs.readFileSync(indexHtmlPath, 'utf8');
        return c.html(html);
      });
    }
  } else {
    app.notFound((c) =>
      c.json(
        {
          error: 'not_found',
          message: c.req.path.startsWith('/api/')
            ? `Unknown API route: ${c.req.path}`
            : 'Static client bundle not found.',
        },
        404,
      ),
    );
  }

  return { app, storage, emailAdapter };
}

export async function startNodeServer(
  options: NodeServerOptions = {},
): Promise<RunningNodeServer> {
  const port = options.port ?? Number(process.env.PORT || '3000');
  const hostname = options.hostname ?? process.env.HOST ?? '127.0.0.1';
  const { app, storage, emailAdapter } = createNodeApp(options);

  const server = await new Promise<Server>((resolve, reject) => {
    const srv = serve(
      {
        fetch: app.fetch,
        port,
        hostname,
      },
      () => {
        resolve(srv as Server);
      },
    ) as Server;
    srv.once('error', reject);
  });

  const addr = server.address();
  const actualPort =
    typeof addr === 'object' && addr !== null ? addr.port : port;
  const hostForUrl =
    hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
  const url = `http://${hostForUrl}:${actualPort}`;

  return {
    app,
    server,
    port: actualPort,
    url,
    storage,
    emailAdapter,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      storage.close();
    },
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const running = await startNodeServer();
  console.log(`MarketSyncWeb self-hosted server listening at ${running.url}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await running.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
