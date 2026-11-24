import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_COPPER,
  type AlertCondition,
  type AlertRule,
  type FactionPartition,
  type FlavorId,
  type LinkedCharacter,
  type NotificationItem,
  type ShoppingList,
} from '@marketsync/shared';
import type {
  CreateAlertRuleInput,
  CreateNotificationInput,
  CreateSyncedListInput,
  SessionRecord,
  SnapshotCursorRecord,
  StorageAdapter,
  SyncedListRecord,
  UpdateAlertRuleInput,
  UpdateNotificationSettingsInput,
  UpsertUserInput,
  UserRecord,
} from './types.js';

type SqlRow = Record<string, unknown>;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

function asBool(value: unknown): boolean {
  return Number(value) === 1;
}

function assertCopperPrice(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COPPER) {
    throw new RangeError(
      `Copper price must be an integer between 0 and ${MAX_COPPER}, received ${value}`,
    );
  }
  return value;
}

function clampCopperPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  if (truncated < 0) return 0;
  if (truncated > MAX_COPPER) return MAX_COPPER;
  return truncated;
}

export class SqliteStorageAdapter implements StorageAdapter {
  readonly supportsPersistence = true;
  private readonly db: DatabaseSync;

  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        bnet_id TEXT NOT NULL UNIQUE,
        battletag TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'us',
        notification_email TEXT,
        email_enabled INTEGER NOT NULL DEFAULT 0,
        on_site_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        region TEXT NOT NULL DEFAULT 'us',
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        region TEXT NOT NULL,
        flavor TEXT NOT NULL,
        namespace TEXT NOT NULL,
        name TEXT NOT NULL,
        surname TEXT,
        realm_slug TEXT,
        ruleset TEXT,
        faction TEXT,
        level INTEGER,
        class_name TEXT,
        PRIMARY KEY (user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);

      CREATE TABLE IF NOT EXISTS synced_lists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        flavor TEXT,
        partition_key TEXT,
        faction TEXT,
        character_id TEXT,
        ms1_string TEXT NOT NULL,
        list_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_synced_lists_user_id ON synced_lists(user_id);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        character_id TEXT,
        list_id TEXT,
        flavor TEXT NOT NULL,
        partition_key TEXT NOT NULL,
        faction TEXT NOT NULL,
        item_key TEXT NOT NULL,
        condition TEXT NOT NULL DEFAULT 'below',
        max_price_copper INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        notify_onsite INTEGER NOT NULL DEFAULT 1,
        email_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alert_rules_user_id ON alert_rules(user_id);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled_flavor ON alert_rules(enabled, flavor);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alert_rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
        flavor TEXT NOT NULL,
        partition_key TEXT NOT NULL,
        faction TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_name TEXT NOT NULL,
        observed_price_copper INTEGER NOT NULL,
        threshold_price_copper INTEGER NOT NULL,
        snapshot_timestamp INTEGER NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        emailed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_rule_snapshot
        ON notifications(alert_rule_id, snapshot_timestamp)
        WHERE alert_rule_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS snapshot_cursors (
        scope_key TEXT NOT NULL DEFAULT '__global__',
        flavor TEXT NOT NULL,
        snapshot_path TEXT NOT NULL,
        snapshot_timestamp INTEGER NOT NULL,
        evaluated_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, flavor)
      );
    `);

    const charTableSqlRow = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'characters'`,
      )
      .get() as { sql?: string } | undefined;
    if (
      charTableSqlRow?.sql &&
      !/PRIMARY KEY\s*\(\s*user_id\s*,\s*id\s*\)/i.test(charTableSqlRow.sql)
    ) {
      this.db.exec(`
        ALTER TABLE characters RENAME TO characters_legacy;
        CREATE TABLE characters (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          region TEXT NOT NULL,
          flavor TEXT NOT NULL,
          namespace TEXT NOT NULL,
          name TEXT NOT NULL,
          surname TEXT,
          realm_slug TEXT,
          ruleset TEXT,
          faction TEXT,
          level INTEGER,
          class_name TEXT,
          PRIMARY KEY (user_id, id)
        );
        INSERT INTO characters (
          id, user_id, region, flavor, namespace, name, surname, realm_slug, ruleset, faction, level, class_name
        )
        SELECT
          id, user_id, region, flavor, namespace, name, surname, realm_slug, ruleset, faction, level, class_name
        FROM characters_legacy;
        DROP TABLE characters_legacy;
        CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
      `);
    }

    const cursorCols = this.db
      .prepare(`PRAGMA table_info(snapshot_cursors)`)
      .all() as Array<{ name: string }>;
    if (
      cursorCols.length > 0 &&
      !cursorCols.some((col) => col.name === 'scope_key')
    ) {
      this.db.exec(`
        ALTER TABLE snapshot_cursors RENAME TO snapshot_cursors_legacy;
        CREATE TABLE snapshot_cursors (
          scope_key TEXT NOT NULL DEFAULT '__global__',
          flavor TEXT NOT NULL,
          snapshot_path TEXT NOT NULL,
          snapshot_timestamp INTEGER NOT NULL,
          evaluated_at TEXT NOT NULL,
          PRIMARY KEY (scope_key, flavor)
        );
        INSERT INTO snapshot_cursors (
          scope_key, flavor, snapshot_path, snapshot_timestamp, evaluated_at
        )
        SELECT
          '__global__', flavor, snapshot_path, snapshot_timestamp, evaluated_at
        FROM snapshot_cursors_legacy;
        DROP TABLE snapshot_cursors_legacy;
      `);
    }

    const alertCols = this.db
      .prepare(`PRAGMA table_info(alert_rules)`)
      .all() as Array<{ name: string }>;
    if (alertCols.length > 0 && !alertCols.some((col) => col.name === 'condition')) {
      this.db.exec(
        `ALTER TABLE alert_rules ADD COLUMN condition TEXT NOT NULL DEFAULT 'below';`,
      );
    }
    if (
      alertCols.length > 0 &&
      !alertCols.some((col) => col.name === 'notify_onsite')
    ) {
      this.db.exec(
        `ALTER TABLE alert_rules ADD COLUMN notify_onsite INTEGER NOT NULL DEFAULT 1;`,
      );
    }
  }

  private mapUser(row: SqlRow): UserRecord {
    return {
      id: asString(row.id),
      bnetId: asString(row.bnet_id),
      battletag: asString(row.battletag),
      region: asString(row.region, 'us'),
      notificationEmail: asNullableString(row.notification_email),
      emailEnabled: asBool(row.email_enabled),
      onSiteEnabled: asBool(row.on_site_enabled),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private mapCharacter(row: SqlRow): LinkedCharacter {
    const char: LinkedCharacter = {
      id: asString(row.id),
      userId: asString(row.user_id),
      region: asString(row.region),
      flavor: asString(row.flavor) as FlavorId,
      namespace: asString(row.namespace),
      name: asString(row.name),
    };
    const surname = asNullableString(row.surname);
    if (surname) char.surname = surname;
    const realmSlug = asNullableString(row.realm_slug);
    if (realmSlug) char.realmSlug = realmSlug;
    const ruleset = asNullableString(row.ruleset);
    if (ruleset) char.ruleset = ruleset;
    const faction = asNullableString(row.faction);
    if (faction) char.faction = faction as FactionPartition;
    if (row.level !== null && row.level !== undefined) {
      char.level = asNumber(row.level);
    }
    const className = asNullableString(row.class_name);
    if (className) char.className = className;
    return char;
  }

  private mapSyncedList(row: SqlRow): SyncedListRecord {
    const rec: SyncedListRecord = {
      id: asString(row.id),
      userId: asString(row.user_id),
      name: asString(row.name),
      ms1String: asString(row.ms1_string),
      list: JSON.parse(asString(row.list_json)) as ShoppingList,
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
    const flavor = asNullableString(row.flavor);
    if (flavor) rec.flavor = flavor as FlavorId;
    const partitionKey = asNullableString(row.partition_key);
    if (partitionKey) rec.partitionKey = partitionKey;
    const faction = asNullableString(row.faction);
    if (faction) rec.faction = faction as FactionPartition;
    const characterId = asNullableString(row.character_id);
    if (characterId) rec.characterId = characterId;
    return rec;
  }

  private mapAlertRule(row: SqlRow): AlertRule {
    const rawCondition = asString(row.condition, 'below');
    const condition: AlertCondition =
      rawCondition === 'above' ? 'above' : 'below';
    const maxPriceCopper = asNumber(row.max_price_copper);
    const notifyOnsite =
      row.notify_onsite === undefined || row.notify_onsite === null
        ? true
        : asBool(row.notify_onsite);

    const rule: AlertRule = {
      id: asString(row.id),
      userId: asString(row.user_id),
      flavor: asString(row.flavor) as FlavorId,
      partitionKey: asString(row.partition_key),
      faction: asString(row.faction) as FactionPartition,
      itemKey: asString(row.item_key),
      condition,
      maxPriceCopper,
      thresholdCopper: maxPriceCopper,
      enabled: asBool(row.enabled),
      notifyOnsite,
      emailEnabled: asBool(row.email_enabled),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
    const characterId = asNullableString(row.character_id);
    if (characterId) rule.characterId = characterId;
    const listId = asNullableString(row.list_id);
    if (listId) rule.listId = listId;
    return rule;
  }

  private mapNotification(row: SqlRow): NotificationItem {
    const item: NotificationItem = {
      id: asString(row.id),
      userId: asString(row.user_id),
      flavor: asString(row.flavor) as FlavorId,
      partitionKey: asString(row.partition_key),
      faction: asString(row.faction) as FactionPartition,
      itemKey: asString(row.item_key),
      itemName: asString(row.item_name),
      observedPriceCopper: asNumber(row.observed_price_copper),
      thresholdPriceCopper: asNumber(row.threshold_price_copper),
      snapshotTimestamp: asNumber(row.snapshot_timestamp),
      read: asBool(row.is_read),
      emailed: asBool(row.emailed),
      createdAt: asString(row.created_at),
    };
    const alertRuleId = asNullableString(row.alert_rule_id);
    if (alertRuleId) item.alertRuleId = alertRuleId;
    return item;
  }

  upsertUser(input: UpsertUserInput): UserRecord {
    const now = new Date().toISOString();
    const existing = this.getUserById(input.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE users SET battletag = ?, region = ?, updated_at = ? WHERE id = ?`,
        )
        .run(input.battletag, input.region, now, input.id);
      return this.getUserById(input.id)!;
    }

    this.db
      .prepare(
        `INSERT INTO users (
          id, bnet_id, battletag, region, notification_email, email_enabled, on_site_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 0, 1, ?, ?)`,
      )
      .run(input.id, input.bnetId, input.battletag, input.region, now, now);
    return this.getUserById(input.id)!;
  }

  getUserById(userId: string): UserRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(userId) as SqlRow | undefined;
    return row ? this.mapUser(row) : null;
  }

  updateNotificationSettings(
    userId: string,
    input: UpdateNotificationSettingsInput,
  ): UserRecord | null {
    const existing = this.getUserById(userId);
    if (!existing) return null;

    const notificationEmail =
      input.notificationEmail !== undefined
        ? input.notificationEmail
        : existing.notificationEmail;
    const emailEnabled =
      input.emailEnabled !== undefined
        ? input.emailEnabled
        : existing.emailEnabled;
    const onSiteEnabled =
      input.onSiteEnabled !== undefined
        ? input.onSiteEnabled
        : existing.onSiteEnabled;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE users
         SET notification_email = ?, email_enabled = ?, on_site_enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        notificationEmail,
        emailEnabled ? 1 : 0,
        onSiteEnabled ? 1 : 0,
        now,
        userId,
      );
    return this.getUserById(userId);
  }

  createSession(session: SessionRecord): SessionRecord {
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, access_token, refresh_token, region, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.userId,
        session.accessToken,
        session.refreshToken,
        session.region,
        session.expiresAt,
        session.createdAt,
      );
    return session;
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as SqlRow | undefined;
    if (!row) return null;
    return {
      id: asString(row.id),
      userId: asString(row.user_id),
      accessToken: asString(row.access_token),
      refreshToken: asNullableString(row.refresh_token),
      region: asString(row.region, 'us'),
      expiresAt: asNumber(row.expires_at),
      createdAt: asString(row.created_at),
    };
  }

  deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  purgeExpiredSessions(nowMs = Date.now()): number {
    const result = this.db
      .prepare(`DELETE FROM sessions WHERE expires_at <= ?`)
      .run(nowMs);
    return Number(result.changes);
  }

  replaceUserCharacters(
    userId: string,
    characters: LinkedCharacter[],
  ): LinkedCharacter[] {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`DELETE FROM characters WHERE user_id = ?`).run(userId);
      const insert = this.db.prepare(`
        INSERT INTO characters (
          id, user_id, region, flavor, namespace, name, surname, realm_slug, ruleset, faction, level, class_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of characters) {
        insert.run(
          c.id,
          userId,
          c.region,
          c.flavor,
          c.namespace,
          c.name,
          c.surname ?? null,
          c.realmSlug ?? null,
          c.ruleset ?? null,
          c.faction ?? null,
          c.level ?? null,
          c.className ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.listUserCharacters(userId);
  }

  listUserCharacters(userId: string): LinkedCharacter[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM characters WHERE user_id = ? ORDER BY flavor ASC, name ASC`,
      )
      .all(userId) as SqlRow[];
    return rows.map((row) => this.mapCharacter(row));
  }

  listUserLists(userId: string): SyncedListRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM synced_lists WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(userId) as SqlRow[];
    return rows.map((row) => this.mapSyncedList(row));
  }

  createUserList(input: CreateSyncedListInput): SyncedListRecord {
    const id = `lst_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO synced_lists (
          id, user_id, name, flavor, partition_key, faction, character_id, ms1_string, list_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.name,
        input.flavor ?? null,
        input.partitionKey ?? null,
        input.faction ?? null,
        input.characterId ?? null,
        input.ms1String,
        JSON.stringify(input.list),
        now,
        now,
      );
    const row = this.db
      .prepare(`SELECT * FROM synced_lists WHERE id = ?`)
      .get(id) as SqlRow;
    return this.mapSyncedList(row);
  }

  deleteUserList(userId: string, listId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM synced_lists WHERE id = ? AND user_id = ?`)
      .run(listId, userId);
    return Number(result.changes) > 0;
  }

  listUserAlerts(userId: string): AlertRule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(userId) as SqlRow[];
    return rows.map((row) => this.mapAlertRule(row));
  }

  listEnabledAlerts(flavor?: FlavorId): AlertRule[] {
    const rows = flavor
      ? (this.db
          .prepare(
            `SELECT * FROM alert_rules WHERE enabled = 1 AND flavor = ? ORDER BY created_at ASC`,
          )
          .all(flavor) as SqlRow[])
      : (this.db
          .prepare(
            `SELECT * FROM alert_rules WHERE enabled = 1 ORDER BY created_at ASC`,
          )
          .all() as SqlRow[]);
    return rows.map((row) => this.mapAlertRule(row));
  }

  getAlertById(userId: string, alertId: string): AlertRule | null {
    const row = this.db
      .prepare(`SELECT * FROM alert_rules WHERE id = ? AND user_id = ?`)
      .get(alertId, userId) as SqlRow | undefined;
    return row ? this.mapAlertRule(row) : null;
  }

  createAlert(userId: string, input: CreateAlertRuleInput): AlertRule {
    const maxPrice = assertCopperPrice(input.maxPriceCopper);
    const condition: AlertCondition =
      input.condition === 'above' ? 'above' : 'below';
    const id = `alt_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO alert_rules (
          id, user_id, character_id, list_id, flavor, partition_key, faction, item_key,
          condition, max_price_copper, enabled, notify_onsite, email_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        input.characterId ?? null,
        input.listId ?? null,
        input.flavor,
        input.partitionKey,
        input.faction,
        input.itemKey,
        condition,
        maxPrice,
        input.enabled === false ? 0 : 1,
        input.notifyOnsite === false ? 0 : 1,
        input.emailEnabled === false ? 0 : 1,
        now,
        now,
      );
    return this.getAlertById(userId, id)!;
  }

  updateAlert(
    userId: string,
    alertId: string,
    patch: UpdateAlertRuleInput,
  ): AlertRule | null {
    const existing = this.getAlertById(userId, alertId);
    if (!existing) return null;

    const maxPriceCopper =
      patch.maxPriceCopper !== undefined
        ? assertCopperPrice(patch.maxPriceCopper)
        : existing.maxPriceCopper;
    const characterId =
      patch.characterId === null
        ? null
        : patch.characterId ?? existing.characterId ?? null;
    const listId =
      patch.listId === null ? null : patch.listId ?? existing.listId ?? null;
    const partitionKey = patch.partitionKey ?? existing.partitionKey;
    const faction = patch.faction ?? existing.faction;
    const condition: AlertCondition =
      patch.condition !== undefined
        ? patch.condition === 'above'
          ? 'above'
          : 'below'
        : existing.condition;
    const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;
    const notifyOnsite =
      patch.notifyOnsite !== undefined
        ? patch.notifyOnsite
        : existing.notifyOnsite;
    const emailEnabled =
      patch.emailEnabled !== undefined
        ? patch.emailEnabled
        : existing.emailEnabled;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE alert_rules
         SET character_id = ?, list_id = ?, partition_key = ?, faction = ?,
             condition = ?, max_price_copper = ?, enabled = ?, notify_onsite = ?,
             email_enabled = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        characterId,
        listId,
        partitionKey,
        faction,
        condition,
        maxPriceCopper,
        enabled ? 1 : 0,
        notifyOnsite ? 1 : 0,
        emailEnabled ? 1 : 0,
        now,
        alertId,
        userId,
      );
    return this.getAlertById(userId, alertId);
  }

  deleteAlert(userId: string, alertId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM alert_rules WHERE id = ? AND user_id = ?`)
      .run(alertId, userId);
    return Number(result.changes) > 0;
  }

  listUserNotifications(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): NotificationItem[] {
    const rawLimit = options?.limit;
    const safeLimit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.trunc(rawLimit)
        : 100;
    const limit = Math.min(Math.max(safeLimit, 1), 500);
    const sql = options?.unreadOnly
      ? `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(userId, limit) as SqlRow[];
    return rows.map((row) => this.mapNotification(row));
  }

  createNotificationIfAbsent(
    input: CreateNotificationInput,
  ): NotificationItem | null {
    const observed = clampCopperPrice(input.observedPriceCopper);
    const threshold = assertCopperPrice(input.thresholdPriceCopper);
    const id = `ntf_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (
          id, user_id, alert_rule_id, flavor, partition_key, faction, item_key, item_name,
          observed_price_copper, threshold_price_copper, snapshot_timestamp, is_read, emailed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.alertRuleId ?? null,
        input.flavor,
        input.partitionKey,
        input.faction,
        input.itemKey,
        input.itemName,
        observed,
        threshold,
        input.snapshotTimestamp,
        input.read ? 1 : 0,
        input.emailed ? 1 : 0,
        now,
      );
    if (Number(result.changes) === 0) {
      return null;
    }
    const row = this.db
      .prepare(`SELECT * FROM notifications WHERE id = ?`)
      .get(id) as SqlRow;
    return this.mapNotification(row);
  }

  createNotification(input: CreateNotificationInput): NotificationItem {
    const created = this.createNotificationIfAbsent(input);
    if (created) return created;
    if (input.alertRuleId) {
      const existing = this.db
        .prepare(
          `SELECT * FROM notifications WHERE alert_rule_id = ? AND snapshot_timestamp = ? LIMIT 1`,
        )
        .get(input.alertRuleId, input.snapshotTimestamp) as SqlRow | undefined;
      if (existing) {
        return this.mapNotification(existing);
      }
    }
    throw new Error('Failed to create notification');
  }

  markNotificationRead(
    userId: string,
    notificationId: string,
  ): NotificationItem | null {
    const result = this.db
      .prepare(
        `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      )
      .run(notificationId, userId);
    if (Number(result.changes) === 0) return null;
    const row = this.db
      .prepare(`SELECT * FROM notifications WHERE id = ? AND user_id = ?`)
      .get(notificationId, userId) as SqlRow | undefined;
    return row ? this.mapNotification(row) : null;
  }

  markNotificationEmailed(notificationId: string): void {
    this.db
      .prepare(`UPDATE notifications SET emailed = 1 WHERE id = ?`)
      .run(notificationId);
  }

  hasNotificationForSnapshot(
    alertRuleId: string,
    snapshotTimestamp: number,
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM notifications WHERE alert_rule_id = ? AND snapshot_timestamp = ? LIMIT 1`,
      )
      .get(alertRuleId, snapshotTimestamp) as SqlRow | undefined;
    return Boolean(row);
  }

  getSnapshotCursor(
    flavor: FlavorId,
    scopeKey = '__global__',
  ): SnapshotCursorRecord | null {
    const normalizedScope = scopeKey || '__global__';
    const row = this.db
      .prepare(
        `SELECT * FROM snapshot_cursors WHERE scope_key = ? AND flavor = ?`,
      )
      .get(normalizedScope, flavor) as SqlRow | undefined;
    if (!row) return null;
    return {
      scopeKey: asString(row.scope_key, normalizedScope),
      flavor: asString(row.flavor) as FlavorId,
      snapshotPath: asString(row.snapshot_path),
      snapshotTimestamp: asNumber(row.snapshot_timestamp),
      evaluatedAt: asString(row.evaluated_at),
    };
  }

  upsertSnapshotCursor(cursor: SnapshotCursorRecord): void {
    const scopeKey = cursor.scopeKey || '__global__';
    this.db
      .prepare(
        `INSERT INTO snapshot_cursors (scope_key, flavor, snapshot_path, snapshot_timestamp, evaluated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, flavor) DO UPDATE SET
           snapshot_path = excluded.snapshot_path,
           snapshot_timestamp = excluded.snapshot_timestamp,
           evaluated_at = excluded.evaluated_at`,
      )
      .run(
        scopeKey,
        cursor.flavor,
        cursor.snapshotPath,
        cursor.snapshotTimestamp,
        cursor.evaluatedAt,
      );
  }

  close(): void {
    this.db.close();
  }
}
