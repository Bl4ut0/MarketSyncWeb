import {
  registerWowheadTooltipMeta,
  type FlavorId,
  type PriceHistoryPoint,
  type WowheadItemMatch,
  type WowheadTooltipMeta,
} from '@marketsync/shared';
import type {
  EnrichedAuctionRow,
  MarketAnalyticsCategory,
  MarketAnalyticsItem,
  MarketAnalyticsPayload,
  SnapshotSummary,
  SortDir,
  SortField,
  WorkerRequest,
  WorkerResponse,
} from '../workers/snapshotWorker.js';

type PendingResolver = {
  resolve: (val: WorkerResponse) => void;
  reject: (err: Error) => void;
};

class SnapshotWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingResolver>();
  private seq = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/snapshotWorker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const data = ev.data;
        const entry = this.pending.get(data.reqId);
        if (!entry) return;
        this.pending.delete(data.reqId);
        if (!data.ok) {
          entry.reject(new Error(data.error));
        } else {
          entry.resolve(data);
        }
      };
      this.worker.onerror = (ev) => {
        const err = new Error(ev.message || 'Snapshot worker error');
        for (const [, pending] of this.pending) {
          pending.reject(err);
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call<T extends WorkerResponse>(
    payload: Record<string, unknown>,
    historySignal?: AbortSignal,
  ): Promise<T> {
    const reqId = `req_${++this.seq}`;
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      historySignal?.throwIfAborted();
      const cancelHistory = () => {
        this.pending.delete(reqId);
        worker.postMessage({ type: 'CANCEL_ITEM_HISTORY', reqId } satisfies WorkerRequest);
        reject(historySignal?.reason);
      };
      historySignal?.addEventListener('abort', cancelHistory, { once: true });
      this.pending.set(reqId, {
        resolve: (value) => {
          historySignal?.removeEventListener('abort', cancelHistory);
          resolve(value as T);
        },
        reject: (error) => {
          historySignal?.removeEventListener('abort', cancelHistory);
          reject(error);
        },
      });
      worker.postMessage({ ...payload, reqId } as WorkerRequest);
    });
  }

  async loadSnapshot(path: string, flavor: FlavorId): Promise<SnapshotSummary> {
    const res = await this.call<Extract<WorkerResponse, { type: 'LOAD_SNAPSHOT' }>>({
      type: 'LOAD_SNAPSHOT',
      path,
      flavor,
    });
    return res.summary;
  }

  async queryEntries(params: {
    path: string;
    flavor?: FlavorId;
    partitionKey: string;
    faction: string;
    search: string;
    matchingItems?: WowheadItemMatch[];
    exactMatch?: boolean;
    quality: string;
    ahCategory?: string;
    ahSubcategory?: string;
    minLevel?: number;
    maxLevel?: number;
    sortBy: SortField;
    sortDir: SortDir;
    page: number;
    pageSize: number;
  }): Promise<{
    rows: EnrichedAuctionRow[];
    totalCount: number;
    page: number;
    totalPages: number;
    categoryCounts: Record<string, number>;
  }> {
    const res = await this.call<Extract<WorkerResponse, { type: 'QUERY_ENTRIES' }>>({
      type: 'QUERY_ENTRIES',
      ...params,
    });
    return {
      rows: res.rows,
      totalCount: res.totalCount,
      page: res.page,
      totalPages: res.totalPages,
      categoryCounts: res.categoryCounts,
    };
  }

  async hydrateWowheadItems(
    itemIds: number[],
    flavor: FlavorId,
  ): Promise<Record<number, WowheadTooltipMeta>> {
    const res = await this.call<
      Extract<WorkerResponse, { type: 'HYDRATE_WOWHEAD_ITEMS' }>
    >({
      type: 'HYDRATE_WOWHEAD_ITEMS',
      itemIds,
      flavor,
    });
    for (const [idStr, meta] of Object.entries(res.hydrated)) {
      registerWowheadTooltipMeta(Number(idStr), meta, flavor);
    }
    return res.hydrated;
  }

  async getCraftQuotes(params: {
    path: string;
    flavor: FlavorId;
    partitionKey: string;
    faction: string;
  }) {
    const result = await this.call<Extract<WorkerResponse, { type: 'GET_CRAFT_QUOTES' }>>({
      type: 'GET_CRAFT_QUOTES', ...params,
    });
    return result.quotes;
  }

  async getItemHistory(params: {
    blocks: Array<{ path: string; flavor: FlavorId }>;
    partitionKey: string;
    faction: string;
    itemKey: string;
    groupedItemId?: number;
  }, signal: AbortSignal): Promise<{ points: PriceHistoryPoint[]; failedBlocks: number }> {
    const res = await this.call<
      Extract<WorkerResponse, { type: 'GET_ITEM_HISTORY' }>
    >({
      type: 'GET_ITEM_HISTORY',
      ...params,
    }, signal);
    return { points: res.points, failedBlocks: res.failedBlocks };
  }

  async computeMarketAnalytics(
    params: {
      currentPath: string;
      flavor: FlavorId;
      blocks: Extract<WorkerRequest, { type: 'COMPUTE_MARKET_ANALYTICS' }>['blocks'];
      partitionKey: string;
      faction: string;
      ahCategory?: string;
    },
    signal: AbortSignal,
  ): Promise<MarketAnalyticsPayload> {
    const res = await this.call<
      Extract<WorkerResponse, { type: 'COMPUTE_MARKET_ANALYTICS' }>
    >(
      {
        type: 'COMPUTE_MARKET_ANALYTICS',
        ...params,
      },
      signal,
    );
    return res.analytics;
  }
}

export const snapshotClient = new SnapshotWorkerClient();
export type {
  EnrichedAuctionRow,
  MarketAnalyticsCategory,
  MarketAnalyticsItem,
  MarketAnalyticsPayload,
  SnapshotSummary,
  SortDir,
  SortField,
};
