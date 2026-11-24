import { describe, expect, it } from 'vitest';
import type { DatasetBlockMeta } from '@marketsync/shared';
import { selectHistoryBlocks } from '../src/lib/priceHistory.js';

function capture(hoursAgo: number, extra: Partial<DatasetBlockMeta> = {}): DatasetBlockMeta {
  const timestamp = Date.UTC(2026, 10, 22, 18 - hoursAgo) / 1000;
  const isoDate = new Date(timestamp * 1000).toISOString();
  const date = isoDate.slice(0, 10);
  const hour = isoDate.slice(11, 13);
  return {
    flavor: 'forever', date, hour, timestamp, path: `datasets/forever/${date}/${hour}-00.json`,
    simulated: false, isLegacyPath: false, items: 1, volume: 10, ...extra,
  };
}

describe('item market history capture selection', () => {
  it('uses the selected market capture as the end of the range', () => {
    const anchor = capture(10);
    const oldest = capture(34);
    const legacyDuplicate = capture(34, { isLegacyPath: true, path: 'datasets/legacy.json' });
    const blocks = [capture(0), anchor, capture(11, { flavor: 'retail' }), capture(12, { simulated: true }),
      legacyDuplicate, oldest, capture(35)];
    expect(selectHistoryBlocks(blocks, anchor, 24)).toEqual([anchor, oldest]);
  });

  it('bounds downloads across the range and retains both endpoints', () => {
    const blocks = Array.from({ length: 31 }, (_, day) => capture(day * 24));
    const sampled = selectHistoryBlocks(blocks, blocks[0]!, 720);
    expect(sampled.length).toBeLessThanOrEqual(10);
    expect(sampled[0]).toBe(blocks[0]);
    expect(sampled.at(-1)).toBe(blocks.at(-1));
    expect(sampled.some((block) => block === blocks[15])).toBe(true);
  });
});
