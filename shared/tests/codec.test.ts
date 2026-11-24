import { describe, expect, it } from 'vitest';
import {
  CODEC_VECTORS,
  CodecError,
  MAX_CODEC_COPPER,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTE_LENGTH,
  MAX_LIST_ITEMS,
  MAX_REALM_SLUG_LENGTH,
  crc32Hex,
  decodeShoppingList,
  encodeShoppingList,
  safeDecodeShoppingList,
} from '@marketsync/shared';

describe('!MS1! Shopping List codec', () => {
  it('matches all CRC-32 reference vectors', () => {
    for (const check of CODEC_VECTORS.crc32Checks) {
      expect(crc32Hex(check.input)).toBe(check.expectedHex);
    }
  });

  it('matches all canonical parity encode & decode vectors', () => {
    for (const vec of CODEC_VECTORS.canonicalVectors) {
      const encoded = encodeShoppingList(vec.input);
      expect(encoded, `canonical encode mismatch for ${vec.id}`).toBe(vec.wire);

      const decoded = decodeShoppingList(vec.wire);
      const expected = vec.expectedDecoded ?? vec.input;
      expect(decoded, `canonical decode mismatch for ${vec.id}`).toEqual(expected);

      const safe = safeDecodeShoppingList(vec.wire);
      expect(safe.ok).toBe(true);
      if (safe.ok) {
        expect(safe.list).toEqual(expected);
        expect(safe.crc32).toMatch(/^[0-9a-f]{8}$/);
      }
    }
  });

  it('decodes non-canonical valid JSON payloads and re-encodes canonically', () => {
    for (const vec of CODEC_VECTORS.nonCanonicalDecodeVectors) {
      const decoded = decodeShoppingList(vec.wire);
      expect(decoded, `non-canonical decode mismatch for ${vec.id}`).toEqual(
        vec.expectedDecoded,
      );

      if (vec.expectedCanonicalWire) {
        expect(encodeShoppingList(decoded)).toBe(vec.expectedCanonicalWire);
      }
    }
  });

  it('rejects every invalid vector with the expected CodecErrorCode', () => {
    for (const vec of CODEC_VECTORS.invalidVectors) {
      expect(() => decodeShoppingList(vec.wire), `should throw for ${vec.id}`).toThrow(
        CodecError,
      );

      const res = safeDecodeShoppingList(vec.wire);
      expect(res.ok, `safeDecode should fail for ${vec.id}`).toBe(false);
      if (!res.ok) {
        expect(res.code, `error code mismatch for ${vec.id}`).toBe(vec.expectedCode);
      }
    }
  });

  it('executes purely with Web standards even when global Buffer is shadowed', () => {
    const g = globalThis as Record<string, unknown>;
    const originalBuffer = g.Buffer;
    g.Buffer = undefined;

    try {
      const wire = encodeShoppingList({
        n: 'Web Standard Check — äöü',
        f: 'forever',
        r: 'pvp',
        fa: 'Alliance',
        i: [{ id: 13468, q: 3, m: MAX_CODEC_COPPER, a: 1 }],
      });
      const decoded = decodeShoppingList(wire);
      expect(decoded.n).toBe('Web Standard Check — äöü');
      expect(decoded.i[0]?.m).toBe(MAX_CODEC_COPPER);
    } finally {
      g.Buffer = originalBuffer;
    }
  });

  it('handles large 200-item lists, leading/trailing whitespace, and defaults', () => {
    const largeItems = Array.from({ length: 200 }, (_, idx) => ({
      id: 1000 + idx,
      q: (idx % 20) + 1,
      m: (idx + 1) * 10000,
      nm: `Bulk Reagent #${idx + 1}`,
      nt: idx % 2 === 0 ? `Note ${idx}` : undefined,
      d: (idx % 3 === 0 ? 1 : 0) as 0 | 1,
      a: (idx % 5 === 0 ? 1 : 0) as 0 | 1,
    }));

    const wire = encodeShoppingList({
      n: '  Raid Bulk 200  ',
      f: 'classic',
      r: 'pagle',
      fa: 'CrossFaction',
      i: largeItems,
    });

    expect(wire.length).toBeGreaterThan(4096);
    const decoded = decodeShoppingList(`  \n${wire}\t  `);
    expect(decoded.n).toBe('Raid Bulk 200');
    expect(decoded.i).toHaveLength(200);
    expect(decoded.i[0]?.d).toBe(1);
    expect(decoded.i[0]?.a).toBe(1);
    expect(decoded.i[1]?.d).toBeUndefined();
    expect(decoded.i[1]?.a).toBeUndefined();

    // Omitted q defaults to 1 and m=0/s=0 omitted
    const minimalWire = encodeShoppingList({
      n: 'Defaults',
      i: [{ id: 13464, s: 0, m: 0, d: false, a: false }],
    });
    const minimalDecoded = decodeShoppingList(minimalWire);
    expect(minimalDecoded.i).toEqual([{ id: 13464, q: 1 }]);
  });

  it('enforces item count, field length limits, and whitespace canonical omission', () => {
    const items1000 = Array.from({ length: MAX_LIST_ITEMS }, (_, idx) => ({
      id: 1000 + idx,
      q: 1,
    }));
    const wire1000 = encodeShoppingList({ n: 'Max Items', i: items1000 });
    expect(decodeShoppingList(wire1000).i).toHaveLength(MAX_LIST_ITEMS);

    const items1001 = [...items1000, { id: 9999, q: 1 }];
    expect(() => encodeShoppingList({ n: 'Over Max', i: items1001 })).toThrow(
      CodecError,
    );

    expect(() =>
      encodeShoppingList({
        n: 'Long Realm',
        r: 'a'.repeat(MAX_REALM_SLUG_LENGTH + 1),
        i: [{ id: 13464, q: 1 }],
      }),
    ).toThrow(CodecError);

    expect(() =>
      encodeShoppingList({
        n: 'Long Name',
        i: [{ id: 13464, q: 1, nm: 'x'.repeat(MAX_ITEM_NAME_LENGTH + 1) }],
      }),
    ).toThrow(CodecError);

    expect(() =>
      encodeShoppingList({
        n: 'Long Note',
        i: [{ id: 13464, q: 1, nt: 'x'.repeat(MAX_ITEM_NOTE_LENGTH + 1) }],
      }),
    ).toThrow(CodecError);

    // Whitespace normalization parity
    const paddedWire = encodeShoppingList({
      n: '  Pad  ',
      r: '   ',
      i: [{ id: 13464, s: 0, q: 1, m: 0, nm: '  ', nt: '   ', d: 0, a: 0 }],
    });
    const canonicalWire = encodeShoppingList({
      n: 'Pad',
      i: [{ id: 13464, q: 1 }],
    });
    expect(paddedWire).toBe(canonicalWire);
  });
});
