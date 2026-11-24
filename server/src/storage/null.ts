import type {
  AlertRule,
  FlavorId,
  LinkedCharacter,
  NotificationItem,
} from '@marketsync/shared';
import {
  PersistenceUnavailableError,
  type CreateAlertRuleInput,
  type CreateNotificationInput,
  type CreateSyncedListInput,
  type SessionRecord,
  type SnapshotCursorRecord,
  type StorageAdapter,
  type SyncedListRecord,
  type UpdateAlertRuleInput,
  type UpdateNotificationSettingsInput,
  type UpsertUserInput,
  type UserRecord,
} from './types.js';

function fail(): never {
  throw new PersistenceUnavailableError(
    'Persistent storage and Battle.net user sessions are disabled in zero-database Cloudflare Worker mode.',
  );
}

export class NullStorageAdapter implements StorageAdapter {
  readonly supportsPersistence = false;

  upsertUser(_input: UpsertUserInput): UserRecord {
    return fail();
  }

  getUserById(_userId: string): UserRecord | null {
    return fail();
  }

  updateNotificationSettings(
    _userId: string,
    _input: UpdateNotificationSettingsInput,
  ): UserRecord | null {
    return fail();
  }

  createSession(_session: SessionRecord): SessionRecord {
    return fail();
  }

  getSession(_sessionId: string): SessionRecord | null {
    return fail();
  }

  deleteSession(_sessionId: string): void {
    return fail();
  }

  purgeExpiredSessions(_nowMs?: number): number {
    return fail();
  }

  replaceUserCharacters(
    _userId: string,
    _characters: LinkedCharacter[],
  ): LinkedCharacter[] {
    return fail();
  }

  listUserCharacters(_userId: string): LinkedCharacter[] {
    return fail();
  }

  listUserLists(_userId: string): SyncedListRecord[] {
    return fail();
  }

  createUserList(_input: CreateSyncedListInput): SyncedListRecord {
    return fail();
  }

  deleteUserList(_userId: string, _listId: string): boolean {
    return fail();
  }

  listUserAlerts(_userId: string): AlertRule[] {
    return fail();
  }

  listEnabledAlerts(_flavor?: FlavorId): AlertRule[] {
    return fail();
  }

  getAlertById(_userId: string, _alertId: string): AlertRule | null {
    return fail();
  }

  createAlert(_userId: string, _input: CreateAlertRuleInput): AlertRule {
    return fail();
  }

  updateAlert(
    _userId: string,
    _alertId: string,
    _patch: UpdateAlertRuleInput,
  ): AlertRule | null {
    return fail();
  }

  deleteAlert(_userId: string, _alertId: string): boolean {
    return fail();
  }

  listUserNotifications(
    _userId: string,
    _options?: { unreadOnly?: boolean; limit?: number },
  ): NotificationItem[] {
    return fail();
  }

  createNotification(_input: CreateNotificationInput): NotificationItem {
    return fail();
  }

  createNotificationIfAbsent(
    _input: CreateNotificationInput,
  ): NotificationItem | null {
    return fail();
  }

  markNotificationRead(
    _userId: string,
    _notificationId: string,
  ): NotificationItem | null {
    return fail();
  }

  markNotificationEmailed(_notificationId: string): void {
    return fail();
  }

  hasNotificationForSnapshot(
    _alertRuleId: string,
    _snapshotTimestamp: number,
  ): boolean {
    return fail();
  }

  getSnapshotCursor(
    _flavor: FlavorId,
    _scopeKey?: string,
  ): SnapshotCursorRecord | null {
    return fail();
  }

  upsertSnapshotCursor(_cursor: SnapshotCursorRecord): void {
    return fail();
  }

  close(): void {
    // No-op
  }
}
