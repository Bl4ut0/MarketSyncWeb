import {
  MAX_COPPER,
  formatCopper,
  normalizeFaction,
  normalizeItemKey,
  normalizePartitionKey,
  normalizeSnapshot,
  parseDatasetIndex,
  resolveItemMetadata,
  type AlertRule,
  type FlavorId,
  type NotificationItem,
} from '@marketsync/shared';
import { normalizeBaseUrl, validateSnapshotPath } from '../proxy.js';
import type { StorageAdapter } from '../storage/types.js';
import type { EmailAdapter } from './email.js';

function clampObservedCopper(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  if (truncated < 0) return 0;
  if (truncated > MAX_COPPER) return MAX_COPPER;
  return truncated;
}

export interface EvaluateAlertsOptions {
  storage: StorageAdapter;
  emailAdapter: EmailAdapter;
  dataBaseUrl?: string;
  fetchImpl?: typeof fetch;
  flavor?: FlavorId;
  snapshotPath?: string;
  userId?: string;
}

export interface EvaluateAlertsResult {
  evaluatedFlavors: FlavorId[];
  evaluatedSnapshots: string[];
  triggeredCount: number;
  emailedCount: number;
  skippedDuplicateCount: number;
  notifications: NotificationItem[];
}

export async function evaluatePriceAlerts(
  options: EvaluateAlertsOptions,
): Promise<EvaluateAlertsResult> {
  const { storage, emailAdapter } = options;
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.dataBaseUrl);

  let rules = await storage.listEnabledAlerts(options.flavor);
  if (options.userId) {
    rules = rules.filter((r) => r.userId === options.userId);
  }

  if (rules.length === 0) {
    return {
      evaluatedFlavors: [],
      evaluatedSnapshots: [],
      triggeredCount: 0,
      emailedCount: 0,
      skippedDuplicateCount: 0,
      notifications: [],
    };
  }

  const rulesByFlavor = new Map<FlavorId, AlertRule[]>();
  for (const rule of rules) {
    const existing = rulesByFlavor.get(rule.flavor) ?? [];
    existing.push(rule);
    rulesByFlavor.set(rule.flavor, existing);
  }

  const indexRes = await fetchFn(`${baseUrl}/datasets/index.json`);
  if (!indexRes.ok) {
    throw new Error(`Failed to fetch dataset index: HTTP ${indexRes.status}`);
  }
  const rawIndex = await indexRes.json();
  const datasetIndex = parseDatasetIndex(rawIndex, { includeSimulated: false });

  const evaluatedFlavors: FlavorId[] = [];
  const evaluatedSnapshots: string[] = [];
  const notifications: NotificationItem[] = [];
  let triggeredCount = 0;
  let emailedCount = 0;
  let skippedDuplicateCount = 0;

  for (const [flavor, flavorRules] of rulesByFlavor.entries()) {
    const scopeKey = options.userId ?? '__global__';
    const explicitPath = options.snapshotPath
      ? validateSnapshotPath(options.snapshotPath)
      : undefined;
    const targetBlock = explicitPath
      ? datasetIndex.blocks.find((b) => b.path === explicitPath) ?? {
          path: explicitPath,
          timestamp: 0,
        }
      : datasetIndex.latestLiveByFlavor[flavor] ??
        datasetIndex.latestByFlavor[flavor];

    if (!targetBlock) continue;

    const cursor = await storage.getSnapshotCursor(flavor, scopeKey);
    if (
      !explicitPath &&
      cursor &&
      cursor.snapshotTimestamp >= targetBlock.timestamp &&
      cursor.snapshotPath === targetBlock.path &&
      flavorRules.every((r) => r.updatedAt <= cursor.evaluatedAt)
    ) {
      continue;
    }

    const snapPath = validateSnapshotPath(targetBlock.path);
    const snapRes = await fetchFn(`${baseUrl}/${snapPath}`);
    if (!snapRes.ok) {
      throw new Error(
        `Failed to fetch snapshot "${snapPath}": HTTP ${snapRes.status}`,
      );
    }
    const rawSnapshot = await snapRes.json();
    const snapshot = normalizeSnapshot(rawSnapshot, flavor);

    evaluatedFlavors.push(flavor);
    evaluatedSnapshots.push(snapPath);

    for (const rule of flavorRules) {
      const normPartition = normalizePartitionKey(flavor, rule.partitionKey).key;
      const partition =
        snapshot.partitions[normPartition] ??
        snapshot.partitions[rule.partitionKey];
      if (!partition) continue;

      const normFaction = normalizeFaction(rule.faction);
      const factionItems =
        partition.factions[normFaction] ?? partition.factions[rule.faction];
      if (!factionItems) continue;

      const normItemKey = normalizeItemKey(rule.itemKey).canonicalKey;
      const entry = factionItems[normItemKey] ?? factionItems[rule.itemKey];
      if (!entry) continue;

      const condition = rule.condition === 'above' ? 'above' : 'below';
      const thresholdCopper = rule.thresholdCopper ?? rule.maxPriceCopper;
      const matches =
        condition === 'above'
          ? entry.minPrice >= thresholdCopper
          : entry.minPrice <= thresholdCopper;
      if (!matches) {
        continue;
      }

      const alreadyNotified = await storage.hasNotificationForSnapshot(
        rule.id,
        snapshot.timestamp,
      );
      if (alreadyNotified) {
        skippedDuplicateCount += 1;
        continue;
      }

      const meta = resolveItemMetadata(entry.itemKey);
      const user = await storage.getUserById(rule.userId);
      const wantOnsite =
        (user?.onSiteEnabled ?? true) && rule.notifyOnsite !== false;
      const wantEmail = Boolean(
        rule.emailEnabled &&
          user?.emailEnabled &&
          user.notificationEmail &&
          emailAdapter.configured,
      );

      if (!wantOnsite && !wantEmail) {
        continue;
      }

      const observedPrice = clampObservedCopper(entry.minPrice);

      let created: NotificationItem | null = null;
      if (wantOnsite) {
        try {
          created = await storage.createNotificationIfAbsent({
            userId: rule.userId,
            alertRuleId: rule.id,
            flavor,
            partitionKey: partition.key,
            faction: normFaction,
            itemKey: entry.itemKey,
            itemName: meta.name,
            observedPriceCopper: observedPrice,
            thresholdPriceCopper: thresholdCopper,
            snapshotTimestamp: snapshot.timestamp,
            read: false,
            emailed: false,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (/unique constraint|constraint_unique/i.test(msg)) {
            skippedDuplicateCount += 1;
            continue;
          }
          throw err;
        }

        if (!created) {
          skippedDuplicateCount += 1;
          continue;
        }
      }

      triggeredCount += 1;

      if (wantEmail && user?.notificationEmail) {
        const directionVerb = condition === 'above' ? 'rose to' : 'dropped to';
        const thresholdLabel =
          condition === 'above' ? 'Your Min Spike Threshold' : 'Your Max Threshold';
        const subject = `[MarketSync Alert] ${meta.name} ${directionVerb} ${formatCopper(observedPrice)}`;
        const text = [
          `MarketSync Price Alert triggered for ${meta.name} (${entry.itemKey})`,
          `Flavor: ${flavor} | Realm/Ruleset: ${partition.label} (${normFaction})`,
          `Observed Min Price: ${formatCopper(observedPrice)} (${observedPrice} copper)`,
          `${thresholdLabel}: ${formatCopper(thresholdCopper)} (${thresholdCopper} copper)`,
          `Snapshot Time: ${snapshot.isoDate}`,
        ].join('\n');

        const sendRes = await emailAdapter.send({
          to: user.notificationEmail,
          subject,
          text,
          metadata: {
            ...(created ? { notificationId: created.id } : {}),
            alertRuleId: rule.id,
            flavor,
            partitionKey: partition.key,
            faction: normFaction,
            itemKey: entry.itemKey,
            condition,
            observedPriceCopper: observedPrice,
            thresholdPriceCopper: thresholdCopper,
            snapshotTimestamp: snapshot.timestamp,
          },
        });

        if (sendRes.ok) {
          if (created) {
            await storage.markNotificationEmailed(created.id);
            created.emailed = true;
          }
          emailedCount += 1;
        }
      }

      if (created) {
        notifications.push(created);
      }
    }

    await storage.upsertSnapshotCursor({
      scopeKey,
      flavor,
      snapshotPath: snapPath,
      snapshotTimestamp: snapshot.timestamp,
      evaluatedAt: new Date().toISOString(),
    });
  }

  return {
    evaluatedFlavors,
    evaluatedSnapshots,
    triggeredCount,
    emailedCount,
    skippedDuplicateCount,
    notifications,
  };
}
