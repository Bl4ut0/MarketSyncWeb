import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_COPPER, encodeShoppingList } from '@marketsync/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { NullStorageAdapter } from '../src/storage/null.js';
import { SqliteStorageAdapter } from '../src/storage/sqlite.js';
import { PersistenceUnavailableError } from '../src/storage/types.js';

describe('Storage Adapters (SqliteStorageAdapter & NullStorageAdapter)', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(`${file}${suffix}`);
        } catch {
          // ignore
        }
      }
    }
  });

  it('persists users, sessions, realmless + realm characters, lists, 64-bit copper alerts, notifications, and cursors', () => {
    const dbPath = path.join(
      os.tmpdir(),
      `marketsync-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    tempFiles.push(dbPath);

    const db = new SqliteStorageAdapter(dbPath);
    expect(db.supportsPersistence).toBe(true);

    const user = db.upsertUser({
      id: 'bnet:12345',
      bnetId: '12345',
      battletag: 'Tester#1337',
      region: 'us',
    });
    expect(user.battletag).toBe('Tester#1337');

    const updatedUser = db.updateNotificationSettings(user.id, {
      notificationEmail: 'player@example.com',
      emailEnabled: true,
      onSiteEnabled: true,
    });
    expect(updatedUser?.notificationEmail).toBe('player@example.com');
    expect(updatedUser?.emailEnabled).toBe(true);

    const session = db.createSession({
      id: 'sess_active',
      userId: user.id,
      accessToken: 'tok_1',
      refreshToken: null,
      region: 'us',
      expiresAt: Date.now() + 60_000,
      createdAt: new Date().toISOString(),
    });
    expect(db.getSession(session.id)?.userId).toBe(user.id);

    db.createSession({
      id: 'sess_expired',
      userId: user.id,
      accessToken: 'tok_old',
      refreshToken: null,
      region: 'us',
      expiresAt: Date.now() - 5_000,
      createdAt: new Date().toISOString(),
    });
    expect(db.purgeExpiredSessions()).toBe(1);
    expect(db.getSession('sess_expired')).toBeNull();

    const chars = db.replaceUserCharacters(user.id, [
      {
        id: 'us:profile-forever-us:9001',
        userId: user.id,
        region: 'us',
        flavor: 'forever',
        namespace: 'profile-forever-us',
        name: 'Aelindor',
        surname: 'Dawnblade',
        faction: 'Alliance',
        level: 60,
        className: 'Mage',
      },
      {
        id: 'us:profile-us:1001',
        userId: user.id,
        region: 'us',
        flavor: 'retail',
        namespace: 'profile-us',
        name: 'Aelindor',
        realmSlug: 'tichondrius',
        faction: 'Alliance',
        level: 80,
        className: 'Mage',
      },
    ]);
    expect(chars).toHaveLength(2);
    expect(chars[0]?.surname).toBe('Dawnblade');
    expect(chars[0]?.realmSlug).toBeUndefined();
    expect(chars[1]?.realmSlug).toBe('tichondrius');

    const listInput = {
      v: 1 as const,
      n: 'AQ40 Consumables',
      f: 'forever' as const,
      r: 'pvp',
      fa: 'Alliance' as const,
      i: [{ id: 13464, q: 20, m: MAX_COPPER }],
    };
    const ms1 = encodeShoppingList(listInput);
    const synced = db.createUserList({
      userId: user.id,
      name: listInput.n,
      flavor: 'forever',
      partitionKey: 'pvp',
      faction: 'Alliance',
      characterId: chars[0]!.id,
      ms1String: ms1,
      list: listInput,
    });
    expect(db.listUserLists(user.id)).toHaveLength(1);

    // 64-bit copper threshold (99,999,999,999)
    const alert = db.createAlert(user.id, {
      flavor: 'retail',
      partitionKey: 'region',
      faction: 'Commodities',
      itemKey: '6306',
      maxPriceCopper: MAX_COPPER,
      characterId: chars[1]!.id,
      listId: synced.id,
    });
    expect(alert.maxPriceCopper).toBe(MAX_COPPER);

    expect(() =>
      db.createAlert(user.id, {
        flavor: 'retail',
        partitionKey: 'region',
        faction: 'Commodities',
        itemKey: '6306',
        maxPriceCopper: MAX_COPPER + 1,
      }),
    ).toThrow(RangeError);

    const ntf = db.createNotification({
      userId: user.id,
      alertRuleId: alert.id,
      flavor: 'retail',
      partitionKey: 'region',
      faction: 'Commodities',
      itemKey: '6306',
      itemName: '#6306',
      observedPriceCopper: 29_720_000_000,
      thresholdPriceCopper: MAX_COPPER,
      snapshotTimestamp: 1795338869,
    });
    expect(ntf.observedPriceCopper).toBe(29_720_000_000);
    expect(db.hasNotificationForSnapshot(alert.id, 1795338869)).toBe(true);
    expect(db.listUserNotifications(user.id, { unreadOnly: true })).toHaveLength(1);

    const readNtf = db.markNotificationRead(user.id, ntf.id);
    expect(readNtf?.read).toBe(true);
    expect(db.listUserNotifications(user.id, { unreadOnly: true })).toHaveLength(0);

    db.upsertSnapshotCursor({
      flavor: 'retail',
      snapshotPath: 'datasets/retail/2026-11-22/09-00.json',
      snapshotTimestamp: 1795338869,
      evaluatedAt: new Date().toISOString(),
    });
    expect(db.getSnapshotCursor('retail')?.snapshotTimestamp).toBe(1795338869);

    expect(db.deleteAlert(user.id, alert.id)).toBe(true);
    expect(db.deleteUserList(user.id, synced.id)).toBe(true);
    db.close();

    // Re-open file DB to confirm durability
    const reopened = new SqliteStorageAdapter(dbPath);
    expect(reopened.getUserById(user.id)?.notificationEmail).toBe('player@example.com');
    expect(reopened.listUserCharacters(user.id)).toHaveLength(2);

    // Scoped snapshot cursors are isolated per scopeKey and multi-user characters do not collide
    const user2 = reopened.upsertUser({
      id: 'bnet:67890',
      bnetId: '67890',
      battletag: 'Second#2000',
      region: 'us',
    });
    const chars2 = reopened.replaceUserCharacters(user2.id, [
      {
        id: 'us:profile-forever-us:9001',
        userId: user2.id,
        region: 'us',
        flavor: 'forever',
        namespace: 'profile-forever-us',
        name: 'Aelindor',
        surname: 'Dawnblade',
        faction: 'Alliance',
        level: 60,
        className: 'Mage',
      },
    ]);
    expect(chars2).toHaveLength(1);
    expect(reopened.listUserCharacters(user.id)).toHaveLength(2);

    reopened.upsertSnapshotCursor({
      scopeKey: user.id,
      flavor: 'retail',
      snapshotPath: 'datasets/retail/2026-11-22/10-00.json',
      snapshotTimestamp: 1795342469,
      evaluatedAt: new Date().toISOString(),
    });
    expect(reopened.getSnapshotCursor('retail', user.id)?.snapshotTimestamp).toBe(
      1795342469,
    );
    expect(reopened.getSnapshotCursor('retail', user2.id)).toBeNull();
    expect(reopened.getSnapshotCursor('retail')?.snapshotTimestamp).toBe(
      1795338869,
    );

    reopened.close();
  });

  it('NullStorageAdapter reports supportsPersistence=false and throws 501 PersistenceUnavailableError', () => {
    const nullStorage = new NullStorageAdapter();
    expect(nullStorage.supportsPersistence).toBe(false);
    expect(() => nullStorage.getUserById('bnet:1')).toThrow(
      PersistenceUnavailableError,
    );
    expect(() => nullStorage.listEnabledAlerts()).toThrow(
      PersistenceUnavailableError,
    );
  });
});
