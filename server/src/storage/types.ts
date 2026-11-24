import type {
  AlertCondition,
  AlertRule,
  FactionPartition,
  FlavorId,
  LinkedCharacter,
  NotificationItem,
  ShoppingList,
} from '@marketsync/shared';

export interface UserRecord {
  id: string;
  bnetId: string;
  battletag: string;
  region: string;
  notificationEmail: string | null;
  emailEnabled: boolean;
  onSiteEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUserInput {
  id: string;
  bnetId: string;
  battletag: string;
  region: string;
}

export interface UpdateNotificationSettingsInput {
  notificationEmail?: string | null;
  emailEnabled?: boolean;
  onSiteEnabled?: boolean;
}

export interface SessionRecord {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  region: string;
  expiresAt: number;
  createdAt: string;
}

export interface SyncedListRecord {
  id: string;
  userId: string;
  name: string;
  flavor?: FlavorId;
  partitionKey?: string;
  faction?: FactionPartition;
  characterId?: string;
  ms1String: string;
  list: ShoppingList;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSyncedListInput {
  userId: string;
  name: string;
  flavor?: FlavorId;
  partitionKey?: string;
  faction?: FactionPartition;
  characterId?: string;
  ms1String: string;
  list: ShoppingList;
}

export interface CreateAlertRuleInput {
  characterId?: string;
  listId?: string;
  flavor: FlavorId;
  partitionKey: string;
  faction: FactionPartition;
  itemKey: string;
  condition?: AlertCondition;
  maxPriceCopper: number;
  enabled?: boolean;
  notifyOnsite?: boolean;
  emailEnabled?: boolean;
}

export interface UpdateAlertRuleInput {
  characterId?: string | null;
  listId?: string | null;
  partitionKey?: string;
  faction?: FactionPartition;
  condition?: AlertCondition;
  maxPriceCopper?: number;
  enabled?: boolean;
  notifyOnsite?: boolean;
  emailEnabled?: boolean;
}

export interface CreateNotificationInput {
  userId: string;
  alertRuleId?: string;
  flavor: FlavorId;
  partitionKey: string;
  faction: FactionPartition;
  itemKey: string;
  itemName: string;
  observedPriceCopper: number;
  thresholdPriceCopper: number;
  snapshotTimestamp: number;
  read?: boolean;
  emailed?: boolean;
}

export interface SnapshotCursorRecord {
  scopeKey?: string;
  flavor: FlavorId;
  snapshotPath: string;
  snapshotTimestamp: number;
  evaluatedAt: string;
}

export class PersistenceUnavailableError extends Error {
  readonly status = 501;
  readonly code = 'persistence_unavailable';

  constructor(
    message = 'Persistent storage is unavailable in zero-database mode.',
  ) {
    super(message);
    this.name = 'PersistenceUnavailableError';
  }
}

export interface StorageAdapter {
  readonly supportsPersistence: boolean;

  upsertUser(input: UpsertUserInput): UserRecord | Promise<UserRecord>;
  getUserById(userId: string): UserRecord | null | Promise<UserRecord | null>;
  updateNotificationSettings(
    userId: string,
    input: UpdateNotificationSettingsInput,
  ): UserRecord | null | Promise<UserRecord | null>;

  createSession(session: SessionRecord): SessionRecord | Promise<SessionRecord>;
  getSession(sessionId: string): SessionRecord | null | Promise<SessionRecord | null>;
  deleteSession(sessionId: string): void | Promise<void>;
  purgeExpiredSessions(nowMs?: number): number | Promise<number>;

  replaceUserCharacters(
    userId: string,
    characters: LinkedCharacter[],
  ): LinkedCharacter[] | Promise<LinkedCharacter[]>;
  listUserCharacters(
    userId: string,
  ): LinkedCharacter[] | Promise<LinkedCharacter[]>;

  listUserLists(userId: string): SyncedListRecord[] | Promise<SyncedListRecord[]>;
  createUserList(
    input: CreateSyncedListInput,
  ): SyncedListRecord | Promise<SyncedListRecord>;
  deleteUserList(userId: string, listId: string): boolean | Promise<boolean>;

  listUserAlerts(userId: string): AlertRule[] | Promise<AlertRule[]>;
  listEnabledAlerts(flavor?: FlavorId): AlertRule[] | Promise<AlertRule[]>;
  getAlertById(
    userId: string,
    alertId: string,
  ): AlertRule | null | Promise<AlertRule | null>;
  createAlert(
    userId: string,
    input: CreateAlertRuleInput,
  ): AlertRule | Promise<AlertRule>;
  updateAlert(
    userId: string,
    alertId: string,
    patch: UpdateAlertRuleInput,
  ): AlertRule | null | Promise<AlertRule | null>;
  deleteAlert(userId: string, alertId: string): boolean | Promise<boolean>;

  listUserNotifications(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): NotificationItem[] | Promise<NotificationItem[]>;
  createNotification(
    input: CreateNotificationInput,
  ): NotificationItem | Promise<NotificationItem>;
  createNotificationIfAbsent(
    input: CreateNotificationInput,
  ): NotificationItem | null | Promise<NotificationItem | null>;
  markNotificationRead(
    userId: string,
    notificationId: string,
  ): NotificationItem | null | Promise<NotificationItem | null>;
  markNotificationEmailed(notificationId: string): void | Promise<void>;
  hasNotificationForSnapshot(
    alertRuleId: string,
    snapshotTimestamp: number,
  ): boolean | Promise<boolean>;

  getSnapshotCursor(
    flavor: FlavorId,
    scopeKey?: string,
  ): SnapshotCursorRecord | null | Promise<SnapshotCursorRecord | null>;
  upsertSnapshotCursor(
    cursor: SnapshotCursorRecord,
  ): void | Promise<void>;

  close(): void | Promise<void>;
}
