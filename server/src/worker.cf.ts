import { createApp } from './app.js';
import { NullEmailAdapter } from './notifications/email.js';
import {
  DEFAULT_DATA_BASE_URL,
  resolveEdgeCache,
  type CfExecutionContext,
} from './proxy.js';
import { NullStorageAdapter } from './storage/null.js';

export interface CfFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  MARKETSYNC_DATA_BASE_URL?: string;
  MARKETSYNC_ALLOWED_ORIGINS?: string;
  ASSETS?: CfFetcher;
}

const nullStorage = new NullStorageAdapter();
const nullEmail = new NullEmailAdapter();

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: CfExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const app = createApp({
        mode: 'cloudflare',
        version: '0.1.0',
        storage: nullStorage,
        emailAdapter: nullEmail,
        dataBaseUrl: env.MARKETSYNC_DATA_BASE_URL || DEFAULT_DATA_BASE_URL,
        allowedOrigins: env.MARKETSYNC_ALLOWED_ORIGINS,
        edgeCache: resolveEdgeCache(),
        executionCtx: ctx,
      });
      return app.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      JSON.stringify({
        error: 'not_found',
        message: 'Static client assets are not built or bound.',
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      },
    );
  },

  async scheduled(
    controller: { cron?: string },
    env: WorkerEnv & { GITHUB_DISPATCH_TOKEN?: string },
  ): Promise<void> {
    const token = env.GITHUB_DISPATCH_TOKEN;
    if (!token) return;

    const now = new Date();
    const currentHourPrefix = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const currentDayPrefix = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MarketSync-Failover-Cron',
    };

    // :05 tick handles hourly failover, :35 tick handles daily failover so the two
    // GitHub workflows never push to master at the same moment.
    const isDailyTick = controller?.cron === '35 * * * *';
    const runsRes = isDailyTick ? { ok: false } as Response : await fetch(
      'https://api.github.com/repos/Bl4ut0/MarketSyncData/actions/workflows/hourly-harvest.yml/runs?per_page=1',
      { headers },
    );
    let shouldDispatchHourly = !isDailyTick;
    if (runsRes.ok) {
      const data = (await runsRes.json()) as {
        workflow_runs?: Array<{ created_at?: string }>;
      };
      const latestCreated = data.workflow_runs?.[0]?.created_at ?? '';
      if (latestCreated.startsWith(currentHourPrefix)) {
        shouldDispatchHourly = false;
      }
    }

    if (shouldDispatchHourly) {
      await fetch(
        'https://api.github.com/repos/Bl4ut0/MarketSyncData/actions/workflows/hourly-harvest.yml/dispatches',
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'master' }),
        },
      );
    }

    // Daily failover check (after 06:20 UTC)
    if (isDailyTick && now.getUTCHours() >= 7) {
      const dailyRes = await fetch(
        'https://api.github.com/repos/Bl4ut0/MarketSyncData/actions/workflows/daily-compile.yml/runs?per_page=1',
        { headers },
      );
      let shouldDispatchDaily = true;
      if (dailyRes.ok) {
        const data = (await dailyRes.json()) as {
          workflow_runs?: Array<{ created_at?: string }>;
        };
        const latestDaily = data.workflow_runs?.[0]?.created_at ?? '';
        if (latestDaily.startsWith(currentDayPrefix)) {
          shouldDispatchDaily = false;
        }
      }

      if (shouldDispatchDaily) {
        await fetch(
          'https://api.github.com/repos/Bl4ut0/MarketSyncData/actions/workflows/daily-compile.yml/dispatches',
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: 'master' }),
          },
        );
      }
    }
  },
};
