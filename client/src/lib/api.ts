import type {
  AlertRule,
  Capabilities,
  FactionPartition,
  FlavorId,
  LinkedCharacter,
  NotificationItem,
  ShoppingList,
  WowheadItemMatch,
} from '@marketsync/shared';

export interface AuthUser {
  id?: string;
  battletag: string;
  email?: string;
  notificationEmail?: string;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: AuthUser;
  characters?: LinkedCharacter[];
  notificationEmail?: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
    let parsed: unknown;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (!res.ok) {
      const errObj = parsed as { error?: string; message?: string } | undefined;
      return {
        ok: false,
        status: res.status,
        error:
          errObj?.error ??
          errObj?.message ??
          `Request failed with status ${res.status}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      data: parsed as T,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  mode: 'cloudflare',
  persistence: false,
  oauth: false,
  email: false,
  flavors: ['forever', 'classicEra', 'anniversary', 'classic', 'retail'],
};

export async function fetchCapabilities(): Promise<Capabilities> {
  const res = await requestJson<Capabilities>('/api/capabilities');
  if (res.ok && res.data) {
    return res.data;
  }
  return DEFAULT_CAPABILITIES;
}

export async function fetchDatasetIndexRaw(): Promise<ApiResult<unknown>> {
  return requestJson<unknown>('/api/datasets/index.json');
}

export async function fetchItemMatches(
  name: string,
  flavor: FlavorId,
  signal: AbortSignal,
): Promise<WowheadItemMatch[]> {
  const params = new URLSearchParams({ q: name, flavor });
  const res = await requestJson<{ items: WowheadItemMatch[] }>(`/api/items/search?${params}`, { signal });
  if (!res.ok) throw new Error('Wowhead name lookup is unavailable.');
  return res.data?.items ?? [];
}

export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const res = await requestJson<AuthMeResponse>('/api/auth/me');
  if (res.ok && res.data) {
    return res.data;
  }
  return { authenticated: false };
}

export async function logoutAuth(): Promise<ApiResult<{ ok: boolean }>> {
  return requestJson<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function updateNotificationSettings(
  email: string,
  emailEnabled = true,
): Promise<ApiResult<{ ok: boolean; email?: string }>> {
  return requestJson<{ ok: boolean; email?: string }>(
    '/api/settings/notifications',
    {
      method: 'PUT',
      body: JSON.stringify({ email, notificationEmail: email, emailEnabled }),
    },
  );
}

export async function fetchCloudLists(): Promise<ApiResult<unknown[]>> {
  const res = await requestJson<unknown[] | { lists: unknown[] }>('/api/lists');
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const raw = res.data;
  const lists = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.lists)
      ? raw.lists
      : [];
  return { ok: true, status: res.status, data: lists };
}

export async function syncCloudList(payload: {
  name: string;
  list: ShoppingList;
  characterId?: string;
}): Promise<ApiResult<unknown>> {
  return requestJson<unknown>('/api/lists', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAlerts(): Promise<ApiResult<AlertRule[]>> {
  const res = await requestJson<AlertRule[] | { alerts: AlertRule[] }>(
    '/api/alerts',
  );
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const raw = res.data;
  const alerts = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.alerts)
      ? raw.alerts
      : [];
  return { ok: true, status: res.status, data: alerts };
}

export async function createAlertRule(payload: {
  flavor: FlavorId;
  partitionKey: string;
  faction: FactionPartition;
  itemKey: string;
  maxPriceCopper: number;
  emailEnabled?: boolean;
  characterId?: string;
  listId?: string;
}): Promise<ApiResult<{ alert?: AlertRule } & Partial<AlertRule>>> {
  return requestJson('/api/alerts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function toggleAlertRule(
  id: string,
  enabled: boolean,
): Promise<ApiResult<unknown>> {
  return requestJson(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteAlertRule(id: string): Promise<ApiResult<unknown>> {
  return requestJson(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchNotifications(): Promise<
  ApiResult<NotificationItem[]>
> {
  const res = await requestJson<
    NotificationItem[] | { notifications: NotificationItem[] }
  >('/api/notifications');
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const raw = res.data;
  const notifications = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.notifications)
      ? raw.notifications
      : [];
  return { ok: true, status: res.status, data: notifications };
}

export async function markNotificationRead(
  id: string,
): Promise<ApiResult<unknown>> {
  return requestJson(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function evaluateNotificationsNow(): Promise<ApiResult<unknown>> {
  return requestJson('/api/notifications/evaluate', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
