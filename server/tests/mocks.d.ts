declare module '*contracts.mjs' {
  export const FLAVORS: readonly string[];
  export function assertHealthContract(body: unknown, expectedMode?: 'cloudflare' | 'selfhosted'): void;
  export function assertCapabilitiesContract(body: unknown, expectedMode?: 'cloudflare' | 'selfhosted'): void;
  export function assertDatasetIndexContract(body: unknown): void;
  export function assertSnapshotBlockContract(body: unknown): void;
  export function assertItemsMetadataContract(body: unknown): void;
  export function assertAuthMeContract(body: unknown): void;
  export function assertListsContract(body: unknown): void;
  export function assertAlertsContract(body: unknown): void;
  export function assertNotificationsContract(body: unknown): void;
  export function assertGraceful501Contract(status: number, body: unknown): void;
}

declare module '*mock-data-server.mjs' {
  export interface MockDataServer {
    port: number;
    url: string;
    rawBaseUrl: string;
    close(): Promise<void>;
    reset(): void;
    advanceHour(hourIndex?: number): { hourIndex: number; currentHour: string };
    setState(patch: Record<string, unknown>): void;
    getState(): Record<string, unknown>;
    getRequests(): Array<{ method: string; path: string; timestamp: number }>;
    clearRequests(): void;
  }
  export function startMockDataServer(options?: Record<string, unknown>): Promise<MockDataServer>;
}

declare module '*mock-oauth-server.mjs' {
  export interface MockOAuthServer {
    port: number;
    url: string;
    close(): Promise<void>;
    reset(): void;
    expireAllTokens(): void;
    setState(patch: Record<string, unknown>): void;
    getState(): Record<string, unknown>;
  }
  export function startMockOAuthServer(options?: Record<string, unknown>): Promise<MockOAuthServer>;
}

declare module '*mock-email-server.mjs' {
  export interface CapturedEmail {
    id: string;
    timestamp: string;
    to: string | string[];
    from: string;
    subject: string;
    text: string;
    html: string | null;
    metadata: Record<string, unknown> | null;
    transport: string;
  }
  export interface MockEmailServer {
    port: number;
    smtpPort: number | null;
    url: string;
    sendUrl: string;
    webhookUrl: string;
    getEmails(): CapturedEmail[];
    clearEmails(): number;
    waitForEmail(predicate?: (e: CapturedEmail) => boolean, timeoutMs?: number): Promise<CapturedEmail>;
    close(): Promise<void>;
  }
  export function startMockEmailServer(options?: Record<string, unknown>): Promise<MockEmailServer>;
}
