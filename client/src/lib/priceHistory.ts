import type { DatasetBlockMeta } from '@marketsync/shared';

export const HISTORY_RANGES = [24, 168, 720] as const;
export type HistoryHours = (typeof HISTORY_RANGES)[number];
export const HISTORY_RANGE_LABELS: Record<HistoryHours, string> = { 24: '24h', 168: '7d', 720: '30d' };

const MAX_HISTORY_BLOCKS = 10;

export function selectHistoryBlocks(
  blocks: readonly DatasetBlockMeta[],
  anchor: DatasetBlockMeta,
  hours: HistoryHours,
): DatasetBlockMeta[] {
  const earliest = anchor.timestamp - hours * 3600;
  const eligible = blocks.filter((block) =>
    block.flavor === anchor.flavor && block.simulated === anchor.simulated &&
    block.timestamp >= earliest && block.timestamp < anchor.timestamp,
  );
  const uniqueHours = new Map([[`${anchor.date}/${anchor.hour}`, anchor]]);
  for (const block of eligible) {
    const hour = `${block.date}/${block.hour}`;
    const existing = uniqueHours.get(hour);
    if (!existing || (existing !== anchor && existing.isLegacyPath && !block.isLegacyPath)) {
      uniqueHours.set(hour, block);
    }
  }
  const captures = Array.from(uniqueHours.values()).sort((a, b) => b.timestamp - a.timestamp);
  if (captures.length <= MAX_HISTORY_BLOCKS) return captures;

  const oldest = captures[captures.length - 1]!;
  const bucketSize = (anchor.timestamp - oldest.timestamp) / (MAX_HISTORY_BLOCKS - 2);
  const byBucket = new Map<number, DatasetBlockMeta>();
  for (const block of captures.slice(1, -1)) {
    const bucket = Math.floor((anchor.timestamp - block.timestamp) / bucketSize);
    if (!byBucket.has(bucket)) byBucket.set(bucket, block);
  }
  return [anchor, ...byBucket.values(), oldest];
}
