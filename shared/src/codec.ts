import { CANONICAL_FACTIONS, isFlavorId } from './flavors.js';
import type {
  CodecDecodeResult,
  CodecErrorCode,
  FactionPartition,
  FlavorId,
  ShoppingList,
  ShoppingListInput,
  ShoppingListItem,
  ShoppingListItemInput,
} from './types.js';

export const MS1_PREFIX = '!MS1!';
export const MAX_LIST_NAME_LENGTH = 64;
export const MAX_REALM_SLUG_LENGTH = 64;
export const MAX_ITEM_NAME_LENGTH = 128;
export const MAX_ITEM_NOTE_LENGTH = 256;
export const MAX_LIST_ITEMS = 1000;
export const MAX_CODEC_COPPER = 99_999_999_999;

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_REGEX = /^[A-Za-z0-9\-_]+$/;
const CRC32_HEX_REGEX = /^[0-9a-f]{8}$/;

const BASE64URL_DECODE_TABLE: Readonly<Record<string, number>> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE64URL_ALPHABET.length; i += 1) {
    const ch = BASE64URL_ALPHABET.charAt(i);
    table[ch] = i;
  }
  return table;
})();

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

interface TextEncoderLike {
  encode(input?: string): Uint8Array;
}

interface TextDecoderLike {
  decode(input?: Uint8Array): string;
}

interface GlobalTextEncoding {
  TextEncoder: new () => TextEncoderLike;
  TextDecoder: new (
    label?: string,
    options?: { fatal?: boolean },
  ) => TextDecoderLike;
}

const textEncoding = globalThis as unknown as GlobalTextEncoding;
const utf8Encoder = new textEncoding.TextEncoder();
const utf8Decoder = new textEncoding.TextDecoder('utf-8', { fatal: true });

export class CodecError extends Error {
  readonly code: CodecErrorCode;

  constructor(code: CodecErrorCode, message: string) {
    super(message);
    this.name = 'CodecError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codepointLength(value: string): number {
  return [...value].length;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    const tableVal = CRC32_TABLE[(crc ^ b) & 0xff]!;
    crc = (tableVal ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? utf8Encoder.encode(input) : input;
  return crc32(bytes).toString(16).padStart(8, '0');
}

export function base64UrlEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const chunks: string[] = [];
  let i = 0;

  while (i + 3 <= bytes.length) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const b2 = bytes[i + 2]!;
    const n = (b0 << 16) | (b1 << 8) | b2;
    chunks.push(
      BASE64URL_ALPHABET.charAt((n >>> 18) & 0x3f) +
        BASE64URL_ALPHABET.charAt((n >>> 12) & 0x3f) +
        BASE64URL_ALPHABET.charAt((n >>> 6) & 0x3f) +
        BASE64URL_ALPHABET.charAt(n & 0x3f),
    );
    i += 3;
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i]!;
    chunks.push(
      BASE64URL_ALPHABET.charAt((b0 >>> 2) & 0x3f) +
        BASE64URL_ALPHABET.charAt((b0 & 0x03) << 4),
    );
  } else if (remaining === 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const n = (b0 << 8) | b1;
    chunks.push(
      BASE64URL_ALPHABET.charAt((n >>> 10) & 0x3f) +
        BASE64URL_ALPHABET.charAt((n >>> 4) & 0x3f) +
        BASE64URL_ALPHABET.charAt((n & 0x0f) << 2),
    );
  }

  return chunks.join('');
}

export function base64UrlDecode(b64: string): Uint8Array {
  if (typeof b64 !== 'string' || b64.length < 2 || b64.length % 4 === 1) {
    throw new CodecError('INVALID_BASE64URL', 'Invalid Base64url length');
  }
  if (!BASE64URL_REGEX.test(b64)) {
    throw new CodecError(
      'INVALID_BASE64URL',
      'Base64url payload contains disallowed characters',
    );
  }

  const fullGroups = Math.floor(b64.length / 4);
  const rem = b64.length % 4;
  const outLen = fullGroups * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);

  let inIdx = 0;
  let outIdx = 0;

  for (let g = 0; g < fullGroups; g += 1) {
    const c0 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx)]!;
    const c1 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 1)]!;
    const c2 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 2)]!;
    const c3 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 3)]!;
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outIdx] = (n >>> 16) & 0xff;
    out[outIdx + 1] = (n >>> 8) & 0xff;
    out[outIdx + 2] = n & 0xff;
    inIdx += 4;
    outIdx += 3;
  }

  if (rem === 2) {
    const c0 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx)]!;
    const c1 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 1)]!;
    if ((c1 & 0x0f) !== 0) {
      throw new CodecError(
        'INVALID_BASE64URL',
        'Non-zero trailing bits in Base64url payload',
      );
    }
    out[outIdx] = ((c0 << 2) | (c1 >>> 4)) & 0xff;
  } else if (rem === 3) {
    const c0 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx)]!;
    const c1 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 1)]!;
    const c2 = BASE64URL_DECODE_TABLE[b64.charAt(inIdx + 2)]!;
    if ((c2 & 0x03) !== 0) {
      throw new CodecError(
        'INVALID_BASE64URL',
        'Non-zero trailing bits in Base64url payload',
      );
    }
    out[outIdx] = ((c0 << 2) | (c1 >>> 4)) & 0xff;
    out[outIdx + 1] = (((c1 & 0x0f) << 4) | (c2 >>> 2)) & 0xff;
  }

  return out;
}

function normalizeFlag(
  raw: unknown,
  fieldName: string,
): 0 | 1 {
  if (raw === undefined || raw === null || raw === false || raw === 0) {
    return 0;
  }
  if (raw === true || raw === 1) {
    return 1;
  }
  throw new CodecError(
    'INVALID_SCHEMA',
    `Invalid item flag "${fieldName}": expected 0, 1, or boolean`,
  );
}

function normalizeItemForList(
  rawItem: ShoppingListItemInput | Record<string, unknown>,
  index: number,
): ShoppingListItem {
  if (!isPlainObject(rawItem)) {
    throw new CodecError(
      'INVALID_SCHEMA',
      `Item at index ${index} must be an object`,
    );
  }

  const id = rawItem.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw new CodecError(
      'INVALID_SCHEMA',
      `Item at index ${index} has invalid "id" (expected positive safe integer)`,
    );
  }

  let s = 0;
  if (rawItem.s !== undefined && rawItem.s !== null) {
    if (
      typeof rawItem.s !== 'number' ||
      !Number.isSafeInteger(rawItem.s) ||
      rawItem.s < 0
    ) {
      throw new CodecError(
        'INVALID_SCHEMA',
        `Item at index ${index} has invalid "s" (expected integer >= 0)`,
      );
    }
    s = rawItem.s === 0 ? 0 : rawItem.s;
  }

  let q = 1;
  if (rawItem.q !== undefined && rawItem.q !== null) {
    if (
      typeof rawItem.q !== 'number' ||
      !Number.isSafeInteger(rawItem.q) ||
      rawItem.q < 1
    ) {
      throw new CodecError(
        'INVALID_SCHEMA',
        `Item at index ${index} has invalid "q" (expected integer >= 1)`,
      );
    }
    q = rawItem.q === 0 ? 0 : rawItem.q;
  }

  let m = 0;
  if (rawItem.m !== undefined && rawItem.m !== null) {
    if (
      typeof rawItem.m !== 'number' ||
      !Number.isSafeInteger(rawItem.m) ||
      rawItem.m < 0 ||
      rawItem.m > MAX_CODEC_COPPER
    ) {
      throw new CodecError(
        'INVALID_SCHEMA',
        `Item at index ${index} has invalid "m" (expected integer 0..${MAX_CODEC_COPPER})`,
      );
    }
    m = rawItem.m === 0 ? 0 : rawItem.m;
  }

  let nm: string | undefined;
  if (rawItem.nm !== undefined && rawItem.nm !== null) {
    if (typeof rawItem.nm !== 'string') {
      throw new CodecError(
        'INVALID_SCHEMA',
        `Item at index ${index} has non-string "nm"`,
      );
    }
    const trimmed = rawItem.nm.trim();
    if (trimmed.length > 0) {
      if (codepointLength(trimmed) > MAX_ITEM_NAME_LENGTH) {
        throw new CodecError(
          'INVALID_SCHEMA',
          `Item at index ${index} "nm" exceeds ${MAX_ITEM_NAME_LENGTH} characters`,
        );
      }
      nm = trimmed;
    }
  }

  let nt: string | undefined;
  if (rawItem.nt !== undefined && rawItem.nt !== null) {
    if (typeof rawItem.nt !== 'string') {
      throw new CodecError(
        'INVALID_SCHEMA',
        `Item at index ${index} has non-string "nt"`,
      );
    }
    if (rawItem.nt.trim().length > 0) {
      if (codepointLength(rawItem.nt) > MAX_ITEM_NOTE_LENGTH) {
        throw new CodecError(
          'INVALID_SCHEMA',
          `Item at index ${index} "nt" exceeds ${MAX_ITEM_NOTE_LENGTH} characters`,
        );
      }
      nt = rawItem.nt;
    }
  }

  const d = normalizeFlag(rawItem.d, 'd');
  const a = normalizeFlag(rawItem.a, 'a');

  const normalized: ShoppingListItem = { id, q };
  if (s > 0) normalized.s = s;
  if (m > 0) normalized.m = m;
  if (nm !== undefined) normalized.nm = nm;
  if (nt !== undefined) normalized.nt = nt;
  if (d === 1) normalized.d = 1;
  if (a === 1) normalized.a = 1;

  return normalized;
}

function normalizeShoppingListObject(
  raw: ShoppingListInput | Record<string, unknown>,
  allowMissingVersion: boolean,
): ShoppingList {
  if (!isPlainObject(raw)) {
    throw new CodecError('INVALID_SCHEMA', 'Shopping list payload must be an object');
  }

  if (raw.v === undefined) {
    if (!allowMissingVersion) {
      throw new CodecError('UNSUPPORTED_VERSION', 'Missing shopping list version "v"');
    }
  } else if (raw.v !== 1) {
    throw new CodecError(
      'UNSUPPORTED_VERSION',
      `Unsupported shopping list version: ${String(raw.v)}`,
    );
  }

  if (typeof raw.n !== 'string') {
    throw new CodecError('INVALID_SCHEMA', 'Shopping list name "n" must be a string');
  }
  const n = raw.n.trim();
  const nLen = codepointLength(n);
  if (nLen < 1 || nLen > MAX_LIST_NAME_LENGTH) {
    throw new CodecError(
      'INVALID_SCHEMA',
      `Shopping list name "n" must be 1..${MAX_LIST_NAME_LENGTH} characters`,
    );
  }

  let f: FlavorId | undefined;
  if (raw.f !== undefined && raw.f !== null) {
    if (typeof raw.f !== 'string') {
      throw new CodecError('INVALID_SCHEMA', 'Shopping list flavor "f" must be a string');
    }
    const fTrim = raw.f.trim();
    if (fTrim.length > 0) {
      if (!isFlavorId(fTrim)) {
        throw new CodecError(
          'INVALID_SCHEMA',
          `Invalid shopping list flavor "f": "${fTrim}"`,
        );
      }
      f = fTrim;
    }
  }

  let r: string | undefined;
  if (raw.r !== undefined && raw.r !== null) {
    if (typeof raw.r !== 'string') {
      throw new CodecError('INVALID_SCHEMA', 'Shopping list ruleset/realm "r" must be a string');
    }
    const rTrim = raw.r.trim();
    if (rTrim.length > 0) {
      if (codepointLength(rTrim) > MAX_REALM_SLUG_LENGTH) {
        throw new CodecError(
          'INVALID_SCHEMA',
          `Shopping list ruleset/realm "r" exceeds ${MAX_REALM_SLUG_LENGTH} characters`,
        );
      }
      r = rTrim;
    }
  }

  let fa: FactionPartition | undefined;
  if (raw.fa !== undefined && raw.fa !== null) {
    if (typeof raw.fa !== 'string') {
      throw new CodecError('INVALID_SCHEMA', 'Shopping list faction "fa" must be a string');
    }
    const faTrim = raw.fa.trim();
    if (faTrim.length > 0) {
      if (!(CANONICAL_FACTIONS as readonly string[]).includes(faTrim)) {
        throw new CodecError(
          'INVALID_SCHEMA',
          `Invalid shopping list faction "fa": "${faTrim}"`,
        );
      }
      fa = faTrim as FactionPartition;
    }
  }

  if (!Array.isArray(raw.i)) {
    throw new CodecError('INVALID_SCHEMA', 'Shopping list items "i" must be an array');
  }
  if (raw.i.length > MAX_LIST_ITEMS) {
    throw new CodecError(
      'INVALID_SCHEMA',
      `Shopping list exceeds maximum of ${MAX_LIST_ITEMS} items`,
    );
  }

  const items: ShoppingListItem[] = [];
  for (let idx = 0; idx < raw.i.length; idx += 1) {
    const rawItem = raw.i[idx] as ShoppingListItemInput | Record<string, unknown>;
    items.push(normalizeItemForList(rawItem, idx));
  }

  const canonical: ShoppingList = {
    v: 1,
    n,
    ...(f !== undefined ? { f } : {}),
    ...(r !== undefined ? { r } : {}),
    ...(fa !== undefined ? { fa } : {}),
    i: items,
  };

  return canonical;
}

export function serializeCanonicalShoppingList(input: ShoppingListInput): string {
  const canonical = normalizeShoppingListObject(
    input as unknown as Record<string, unknown>,
    true,
  );

  // Explicit key-order rebuild guarantees exact canonical key order:
  // Top-level: v, n, [f], [r], [fa], i
  // Item-level: id, [s], q, [m], [nm], [nt], [d], [a]
  const orderedItems = canonical.i.map((item) => {
    const out: Record<string, unknown> = { id: item.id };
    if (item.s !== undefined && item.s > 0) out.s = item.s;
    out.q = item.q;
    if (item.m !== undefined && item.m > 0) out.m = item.m;
    if (item.nm !== undefined) out.nm = item.nm;
    if (item.nt !== undefined) out.nt = item.nt;
    if (item.d === 1) out.d = 1;
    if (item.a === 1) out.a = 1;
    return out;
  });

  const orderedRoot: Record<string, unknown> = {
    v: 1,
    n: canonical.n,
  };
  if (canonical.f !== undefined) orderedRoot.f = canonical.f;
  if (canonical.r !== undefined) orderedRoot.r = canonical.r;
  if (canonical.fa !== undefined) orderedRoot.fa = canonical.fa;
  orderedRoot.i = orderedItems;

  return JSON.stringify(orderedRoot);
}

export function encodeShoppingList(input: ShoppingListInput): string {
  const canonicalJson = serializeCanonicalShoppingList(input);
  const bytes = utf8Encoder.encode(canonicalJson);
  const checksum = crc32Hex(bytes);
  const payload = base64UrlEncode(bytes);
  return `${MS1_PREFIX}${payload}.${checksum}`;
}

export function decodeShoppingList(raw: string): ShoppingList {
  if (typeof raw !== 'string') {
    throw new CodecError('INVALID_PREFIX', 'Import string must be a string');
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith(MS1_PREFIX)) {
    throw new CodecError(
      'INVALID_PREFIX',
      `Import string must start with "${MS1_PREFIX}"`,
    );
  }

  const body = trimmed.slice(MS1_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 2) {
    throw new CodecError(
      'INVALID_FORMAT',
      'Import string must have format "!MS1!<payload>.<crc32>"',
    );
  }

  const b64 = parts[0]!;
  const crcHex = parts[1]!;

  if (b64.length < 2 || b64.length % 4 === 1 || !BASE64URL_REGEX.test(b64)) {
    throw new CodecError(
      'INVALID_BASE64URL',
      'Payload is not valid unpadded Base64url',
    );
  }

  if (!CRC32_HEX_REGEX.test(crcHex)) {
    throw new CodecError(
      'INVALID_FORMAT',
      'Checksum must be 8 lowercase hexadecimal digits',
    );
  }

  const bytes = base64UrlDecode(b64);
  const actualCrc = crc32Hex(bytes);
  if (actualCrc !== crcHex) {
    throw new CodecError(
      'CHECKSUM_MISMATCH',
      `CRC-32 mismatch: expected ${actualCrc}, got ${crcHex}`,
    );
  }

  let jsonText: string;
  try {
    jsonText = utf8Decoder.decode(bytes);
  } catch {
    throw new CodecError('INVALID_UTF8', 'Payload contains invalid UTF-8 byte sequence');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new CodecError('INVALID_JSON', 'Payload is not valid JSON');
  }

  return normalizeShoppingListObject(parsed as Record<string, unknown>, false);
}

export function safeDecodeShoppingList(raw: string): CodecDecodeResult {
  try {
    const list = decodeShoppingList(raw);
    const trimmed = raw.trim();
    const dotIdx = trimmed.lastIndexOf('.');
    const crc32Str = trimmed.slice(dotIdx + 1);
    return { ok: true, list, crc32: crc32Str };
  } catch (err) {
    if (err instanceof CodecError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: err instanceof Error ? err.message : 'Unknown decode error',
    };
  }
}
