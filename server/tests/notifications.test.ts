import { MAX_COPPER, encodeShoppingList } from '@marketsync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertAlertsContract,
  assertListsContract,
  assertNotificationsContract,
} from '../../e2e/src/contracts.mjs';
import {
  startMockDataServer,
  type MockDataServer,
} from '../../e2e/src/mocks/mock-data-server.mjs';
import {
  startMockEmailServer,
  type MockEmailServer,
} from '../../e2e/src/mocks/mock-email-server.mjs';
import {
  startMockOAuthServer,
  type MockOAuthServer,
} from '../../e2e/src/mocks/mock-oauth-server.mjs';
import { MockEmailAdapter } from '../src/notifications/email.js';
import { evaluatePriceAlerts } from '../src/notifications/evaluator.js';
import { SmtpEmailAdapter } from '../src/notifications/smtp.node.js';
import { startNodeServer, type RunningNodeServer } from '../src/server.node.js';
import { SqliteStorageAdapter } from '../src/storage/sqlite.js';

async function authenticateWithMockOAuth(
  serverUrl: string,
): Promise<string> {
  const loginRes = await fetch(`${serverUrl}/api/auth/login?region=us`, {
    redirect: 'manual',
  });
  const stateCookie = loginRes.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
  const authRes = await fetch(loginRes.headers.get('location')!, {
    redirect: 'manual',
  });
  const cbRes = await fetch(authRes.headers.get('location')!, {
    headers: { Cookie: stateCookie },
    redirect: 'manual',
  });
  return cbRes.headers
    .getSetCookie()
    .filter((c) => c.startsWith('ms_session='))
    .map((c) => c.split(';')[0]?.trim())
    .join('; ');
}

describe('Price-Delta Alert Evaluator, Lists, On-Site Inbox & Email Delivery', () => {
  let mockData: MockDataServer;
  let mockOAuth: MockOAuthServer;
  let mockEmail: MockEmailServer;
  let server: RunningNodeServer;

  beforeAll(async () => {
    mockData = await startMockDataServer({ initialHourIndex: 1 }); // Hour 09
    mockOAuth = await startMockOAuthServer();
    mockEmail = await startMockEmailServer({ enableSmtp: true });

    process.env.MARKETSYNC_EMAIL_WEBHOOK_URL = mockEmail.webhookUrl;
    server = await startNodeServer({
      port: 0,
      dbPath: ':memory:',
      dataBaseUrl: mockData.rawBaseUrl,
      oauth: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        oauthBaseUrl: mockOAuth.url,
        apiBaseUrl: mockOAuth.url,
      },
    });
  });

  afterAll(async () => {
    delete process.env.MARKETSYNC_EMAIL_WEBHOOK_URL;
    await server.close();
    await mockEmail.close();
    await mockOAuth.close();
    await mockData.close();
  });

  beforeEach(() => {
    mockData.reset();
    mockOAuth.reset();
    mockEmail.clearEmails();
  });

  it('evaluates snapshot price deltas, creates on-site notifications, dispatches webhook emails, and deduplicates', async () => {
    const cookie = await authenticateWithMockOAuth(server.url);

    // 1. Configure email notifications
    const settingsRes = await fetch(`${server.url}/api/settings/notifications`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        notificationEmail: 'raider@marketsync.test',
        emailEnabled: true,
        onSiteEnabled: true,
      }),
    });
    expect(settingsRes.status).toBe(200);

    // 2. Sync a !MS1! shopping list
    const ms1 = encodeShoppingList({
      v: 1,
      n: 'Retail Herbs',
      f: 'retail',
      r: 'region',
      fa: 'Commodities',
      i: [{ id: 2447, q: 100, m: 15000, a: 1 }],
    });
    const postListRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ms1String: ms1 }),
    });
    expect(postListRes.status).toBe(201);

    const listsRes = await fetch(`${server.url}/api/lists`, {
      headers: { Cookie: cookie },
    });
    expect(listsRes.status).toBe(200);
    assertListsContract(await listsRes.json());

    // 3. Create alert rules that do NOT trigger on Hour 09, but DO trigger on Hour 10
    // Hour 09: forever 13005:4512 = 8999 -> Hour 10 drops to 4500
    // Hour 09: retail 2447 = 30000 -> Hour 10 drops to 12000
    const a1 = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'forever',
        partitionKey: 'pvp',
        faction: 'Alliance',
        itemKey: '13005:4512',
        maxPriceCopper: 6000,
      }),
    });
    expect(a1.status).toBe(201);

    const a2 = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        partitionKey: 'region',
        faction: 'Commodities',
        itemKey: '2447',
        maxPriceCopper: 15000,
      }),
    });
    expect(a2.status).toBe(201);

    const alertsRes = await fetch(`${server.url}/api/alerts`, {
      headers: { Cookie: cookie },
    });
    expect(alertsRes.status).toBe(200);
    assertAlertsContract(await alertsRes.json());

    // 4. Evaluate on Hour 09 -> 0 notifications
    const eval09Res = await fetch(`${server.url}/api/notifications/evaluate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(eval09Res.status).toBe(200);
    const eval09 = (await eval09Res.json()) as {
      triggeredCount: number;
      emailedCount: number;
    };
    expect(eval09.triggeredCount).toBe(0);
    expect(eval09.emailedCount).toBe(0);
    expect(mockEmail.getEmails()).toHaveLength(0);

    // 5. Advance to Hour 10 -> 2 notifications + 2 emails
    mockData.advanceHour();
    const eval10Res = await fetch(`${server.url}/api/notifications/evaluate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(eval10Res.status).toBe(200);
    const eval10 = (await eval10Res.json()) as {
      triggeredCount: number;
      emailedCount: number;
    };
    expect(eval10.triggeredCount).toBe(2);
    expect(eval10.emailedCount).toBe(2);

    const emails = mockEmail.getEmails();
    expect(emails).toHaveLength(2);
    expect(emails.every((e) => e.to === 'raider@marketsync.test')).toBe(true);

    // 6. Re-evaluate on Hour 10 -> deduplicated (0 new notifications)
    const eval10AgainRes = await fetch(`${server.url}/api/notifications/evaluate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const eval10Again = (await eval10AgainRes.json()) as { triggeredCount: number };
    expect(eval10Again.triggeredCount).toBe(0);

    // 7. Verify notifications inbox & mark read
    const inboxRes = await fetch(`${server.url}/api/notifications`, {
      headers: { Cookie: cookie },
    });
    expect(inboxRes.status).toBe(200);
    const inboxJson = (await inboxRes.json()) as {
      notifications: Array<{
        id: string;
        itemKey: string;
        observedPriceCopper: number;
        read: boolean;
        emailed: boolean;
      }>;
    };
    assertNotificationsContract(inboxJson);
    expect(inboxJson.notifications).toHaveLength(2);

    const firstId = inboxJson.notifications[0]!.id;
    const readRes = await fetch(
      `${server.url}/api/notifications/${firstId}/read`,
      {
        method: 'POST',
        headers: { Cookie: cookie },
      },
    );
    expect(readRes.status).toBe(200);
    const readJson = (await readRes.json()) as {
      notification: { read: boolean };
    };
    expect(readJson.notification.read).toBe(true);
  });

  it('SmtpEmailAdapter delivers alert emails over raw SMTP', async () => {
    expect(mockEmail.smtpPort).toBeTypeOf('number');
    const smtp = new SmtpEmailAdapter({
      host: '127.0.0.1',
      port: mockEmail.smtpPort!,
      from: 'alerts@marketsync.local',
    });

    const result = await smtp.send({
      to: 'smtp-user@marketsync.test',
      subject: '[MarketSync] Peacebloom price alert',
      text: 'Peacebloom dropped to 1g 20s 00c.',
    });
    expect(result.ok).toBe(true);

    const captured = await mockEmail.waitForEmail(
      (e) => e.to === 'smtp-user@marketsync.test',
    );
    expect(captured.transport).toBe('smtp');
    expect(captured.subject).toContain('Peacebloom');
  });

  it('scopes snapshot cursors per user so User A evaluation never starves User B, and rejects foreign characterId/listId ownership', async () => {
    mockOAuth.setState({
      forceExpired: false,
      user: { sub: '20001', id: 20001, battletag: 'OwnerA#2001' },
    });
    const cookieA = await authenticateWithMockOAuth(server.url);

    mockOAuth.setState({
      forceExpired: false,
      user: { sub: '20002', id: 20002, battletag: 'OwnerB#2002' },
    });
    const cookieB = await authenticateWithMockOAuth(server.url);

    const meA = (await (
      await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookieA } })
    ).json()) as { characters: Array<{ id: string }> };
    const charA = meA.characters[0]!.id;

    const ms1 = encodeShoppingList({
      v: 1,
      n: 'User A List',
      f: 'forever',
      r: 'pvp',
      fa: 'Alliance',
      i: [{ id: 13005, s: 4512, q: 1, m: 6000, a: 1 }],
    });

    // User B cannot attach User A's characterId to a list
    const foreignListRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ ms1String: ms1, characterId: charA }),
    });
    expect(foreignListRes.status).toBe(403);

    // User A can attach their own characterId
    const ownListRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ ms1String: ms1, characterId: charA }),
    });
    expect(ownListRes.status).toBe(201);
    const { list: listA } = (await ownListRes.json()) as { list: { id: string } };

    // User B cannot attach User A's characterId or listId to an alert
    const foreignCharAlert = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        flavor: 'forever',
        partitionKey: 'pvp',
        faction: 'Alliance',
        itemKey: '13005:4512',
        maxPriceCopper: 6000,
        characterId: charA,
      }),
    });
    expect(foreignCharAlert.status).toBe(403);

    const foreignListAlert = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        flavor: 'forever',
        partitionKey: 'pvp',
        faction: 'Alliance',
        itemKey: '13005:4512',
        maxPriceCopper: 6000,
        listId: listA.id,
      }),
    });
    expect(foreignListAlert.status).toBe(403);

    // Advance to Hour 10 so both User A and User B alerts trigger
    mockData.advanceHour();

    const alertARes = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        flavor: 'forever',
        partitionKey: 'pvp',
        faction: 'Alliance',
        itemKey: '13005:4512',
        maxPriceCopper: 6000,
        characterId: charA,
        listId: listA.id,
      }),
    });
    expect(alertARes.status).toBe(201);

    const alertBRes = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        flavor: 'forever',
        partitionKey: 'pvp',
        faction: 'Alliance',
        itemKey: '13005:4512',
        maxPriceCopper: 6000,
      }),
    });
    expect(alertBRes.status).toBe(201);
    const { alert: alertB } = (await alertBRes.json()) as {
      alert: { id: string };
    };

    // PATCH /api/alerts/:id also rejects foreign characterId/listId
    const patchForeignRes = await fetch(`${server.url}/api/alerts/${alertB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ listId: listA.id }),
    });
    expect(patchForeignRes.status).toBe(403);

    // User A evaluates first -> triggers 1
    const evalA = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookieA },
      })
    ).json()) as { triggeredCount: number };
    expect(evalA.triggeredCount).toBe(1);

    // User B evaluates second on the same snapshot -> also triggers 1 (NOT starved)
    const evalB = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookieB },
      })
    ).json()) as { triggeredCount: number };
    expect(evalB.triggeredCount).toBe(1);

    // Repeat evaluation by User B on the same snapshot deduplicates -> 0
    const evalBAgain = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookieB },
      })
    ).json()) as { triggeredCount: number };
    expect(evalBAgain.triggeredCount).toBe(0);
  });

  it('supports condition: "above" spike alerts, flat POST /api/lists, and settings email/onsiteEnabled aliases', async () => {
    mockOAuth.setState({
      forceExpired: false,
      user: { sub: '30001', id: 30001, battletag: 'SpikeTester#3001' },
    });
    const cookie = await authenticateWithMockOAuth(server.url);

    const settingsRes = await fetch(`${server.url}/api/settings/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        email: 'spike@marketsync.test',
        emailEnabled: true,
        onsiteEnabled: true,
      }),
    });
    expect(settingsRes.status).toBe(200);
    const settingsJson = (await settingsRes.json()) as {
      settings: { notificationEmail: string; onSiteEnabled: boolean };
    };
    expect(settingsJson.settings.notificationEmail).toBe('spike@marketsync.test');
    expect(settingsJson.settings.onSiteEnabled).toBe(true);

    const me = (await (
      await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } })
    ).json()) as { characters: Array<{ id: string }> };
    const charId = me.characters[0]?.id;

    const flatListRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Flat Payload List',
        flavor: 'forever',
        ruleset: 'pvp',
        market: 'Alliance',
        characterId: charId,
        items: [{ itemId: 13005, suffix: 4512, qty: 2, maxPrice: 6000 }],
      }),
    });
    expect(flatListRes.status).toBe(201);
    const flatListJson = (await flatListRes.json()) as {
      list: { name: string; ms1String: string; list: { i: Array<{ id: number; s?: number; q: number }> } };
    };
    expect(flatListJson.list.name).toBe('Flat Payload List');
    expect(flatListJson.list.ms1String.startsWith('!MS1!')).toBe(true);
    expect(flatListJson.list.list.i[0]?.s).toBe(4512);

    // Retail 190396: Hour 09 = 15,000c, Hour 10 = 42,000c -> above 25,000c
    const spikeAlertRes = await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        ruleset: 'region',
        market: 'Commodities',
        itemKey: '190396',
        condition: 'above',
        thresholdCopper: 25000,
        notifyOnsite: true,
        notifyEmail: true,
      }),
    });
    expect(spikeAlertRes.status).toBe(201);
    const spikeJson = (await spikeAlertRes.json()) as {
      alert: { condition: string; thresholdCopper: number; maxPriceCopper: number };
    };
    expect(spikeJson.alert.condition).toBe('above');
    expect(spikeJson.alert.thresholdCopper).toBe(25000);
    expect(spikeJson.alert.maxPriceCopper).toBe(25000);

    // Hour 09 -> 15,000c is NOT >= 25,000c -> 0 triggers
    const eval09 = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json()) as { triggeredCount: number };
    expect(eval09.triggeredCount).toBe(0);

    // Advance to Hour 10 -> 42,000c >= 25,000c -> 1 trigger + 1 email
    mockData.advanceHour();
    const eval10 = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json()) as { triggeredCount: number; emailedCount: number };
    expect(eval10.triggeredCount).toBe(1);
    expect(eval10.emailedCount).toBe(1);

    const emails = mockEmail.getEmails();
    expect(emails.some((e) => e.to === 'spike@marketsync.test' && e.subject.includes('rose to'))).toBe(true);
  });

  it('honors onSiteEnabled and notifyOnsite flags, including email-only alerts', async () => {
    mockOAuth.setState({
      forceExpired: false,
      user: { sub: '40001', id: 40001, battletag: 'FlagTester#4001' },
    });
    const cookie = await authenticateWithMockOAuth(server.url);

    // 1. Both on-site and email disabled -> 0 DB notifications, 0 emails
    await fetch(`${server.url}/api/settings/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        notificationEmail: 'flags@marketsync.test',
        emailEnabled: false,
        onSiteEnabled: false,
      }),
    });

    await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        partitionKey: 'region',
        faction: 'Commodities',
        itemKey: '2447',
        maxPriceCopper: 50000,
        notifyOnsite: false,
        emailEnabled: false,
      }),
    });

    const evalSuppressed = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json()) as { triggeredCount: number; emailedCount: number; notifications: unknown[] };
    expect(evalSuppressed.triggeredCount).toBe(0);
    expect(evalSuppressed.emailedCount).toBe(0);
    expect(evalSuppressed.notifications).toHaveLength(0);

    // 2. Email-only mode (onSiteEnabled: false, emailEnabled: true) -> dispatches email without inserting on-site row
    await fetch(`${server.url}/api/settings/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        notificationEmail: 'flags@marketsync.test',
        emailEnabled: true,
        onSiteEnabled: false,
      }),
    });

    await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        partitionKey: 'region',
        faction: 'Commodities',
        itemKey: '190396',
        maxPriceCopper: 50000,
        notifyOnsite: false,
        emailEnabled: true,
      }),
    });

    mockData.advanceHour();
    const evalEmailOnly = (await (
      await fetch(`${server.url}/api/notifications/evaluate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json()) as { triggeredCount: number; emailedCount: number; notifications: unknown[] };
    expect(evalEmailOnly.triggeredCount).toBe(1);
    expect(evalEmailOnly.emailedCount).toBe(1);
    expect(evalEmailOnly.notifications).toHaveLength(0);
    expect(mockEmail.getEmails().some((e) => e.to === 'flags@marketsync.test')).toBe(true);

    const inbox = (await (
      await fetch(`${server.url}/api/notifications`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { notifications: unknown[] };
    expect(inbox.notifications).toHaveLength(0);
  });

  it('clamps snapshot prices > MAX_COPPER, validates limit & flat POST /api/lists flags, and handles concurrent evaluations without 500', async () => {
    mockOAuth.setState({
      forceExpired: false,
      user: { sub: '50001', id: 50001, battletag: 'EdgeTester#5001' },
    });
    const cookie = await authenticateWithMockOAuth(server.url);

    // Reject invalid flat list flags (d: 2, a: 'yes') with 400 instead of silent coercion
    const badDoneRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Bad Flag List',
        items: [{ id: 13464, q: 1, d: 2 }],
      }),
    });
    expect(badDoneRes.status).toBe(400);

    const badAlertRes = await fetch(`${server.url}/api/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Bad Alert List',
        items: [{ id: 13464, q: 1, a: 'yes' }],
      }),
    });
    expect(badAlertRes.status).toBe(400);

    // Reject float/invalid limit on GET /api/notifications with 400
    for (const badLimit of ['1.5', '0', '-2', 'abc']) {
      const limRes = await fetch(
        `${server.url}/api/notifications?limit=${encodeURIComponent(badLimit)}`,
        { headers: { Cookie: cookie } },
      );
      expect(limRes.status).toBe(400);
    }

    // Snapshot listing > MAX_COPPER does not 500 on evaluate
    const extremeBlockPath = 'datasets/retail/2026-11-22/09-00.json';
    const origSnapRes = await fetch(`${mockData.rawBaseUrl}/${extremeBlockPath}`);
    const origSnap = (await origSnapRes.json()) as {
      rulesets: { region: { Commodities: Record<string, unknown> } };
    };
    origSnap.rulesets.region.Commodities['3030'] = {
      minPrice: MAX_COPPER + 1,
      maxPrice: MAX_COPPER + 1,
      totalQty: 1,
      listings: 1,
    };
    mockData.setState({
      overrides: {
        [extremeBlockPath]: JSON.stringify(origSnap),
      },
    });

    await fetch(`${server.url}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        partitionKey: 'region',
        faction: 'Commodities',
        itemKey: '3030',
        condition: 'above',
        thresholdCopper: 50000,
      }),
    });

    const evalExtremeRes = await fetch(`${server.url}/api/notifications/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        flavor: 'retail',
        snapshotPath: extremeBlockPath,
      }),
    });
    expect(evalExtremeRes.status).toBe(200);
    const evalExtremeJson = (await evalExtremeRes.json()) as {
      triggeredCount: number;
      notifications: Array<{ observedPriceCopper: number }>;
    };
    expect(evalExtremeJson.triggeredCount).toBe(1);
    expect(evalExtremeJson.notifications[0]?.observedPriceCopper).toBe(MAX_COPPER);

    // Concurrent evaluatePriceAlerts calls on the same snapshot never throw UNIQUE constraint failure
    const db = new SqliteStorageAdapter(':memory:');
    const emailAdapter = new MockEmailAdapter();
    db.upsertUser({
      id: 'bnet:concurrent',
      bnetId: 'concurrent',
      battletag: 'Concurrent#1',
      region: 'us',
    });
    db.updateNotificationSettings('bnet:concurrent', {
      notificationEmail: 'concurrent@marketsync.test',
      emailEnabled: true,
      onSiteEnabled: true,
    });
    db.createAlert('bnet:concurrent', {
      flavor: 'retail',
      partitionKey: 'region',
      faction: 'Commodities',
      itemKey: '3030',
      condition: 'above',
      maxPriceCopper: 50000,
    });

    const [r1, r2] = await Promise.all([
      evaluatePriceAlerts({
        storage: db,
        emailAdapter,
        dataBaseUrl: mockData.rawBaseUrl,
        flavor: 'retail',
        snapshotPath: extremeBlockPath,
        userId: 'bnet:concurrent',
      }),
      evaluatePriceAlerts({
        storage: db,
        emailAdapter,
        dataBaseUrl: mockData.rawBaseUrl,
        flavor: 'retail',
        snapshotPath: extremeBlockPath,
        userId: 'bnet:concurrent',
      }),
    ]);

    expect(r1.triggeredCount + r2.triggeredCount).toBe(1);
    expect(r1.emailedCount + r2.emailedCount).toBe(1);
    expect(r1.skippedDuplicateCount + r2.skippedDuplicateCount).toBe(1);
    expect(db.listUserNotifications('bnet:concurrent', { limit: 1.5 })).toHaveLength(1);
    db.close();
  });
});
