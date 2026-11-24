import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Domain Constants (derived strictly from ORIGINAL_REQUEST.md, PROJECT.md, TEST_INFRA.md)
// ---------------------------------------------------------------------------

export const FLAVORS = Object.freeze([
  'forever',
  'classicEra',
  'anniversary',
  'classic',
  'retail',
]);

export const FOREVER_CANONICAL_RULESETS = Object.freeze({
  pvp: 'PvP',
  normal: 'Normal',
  roleplay: 'Roleplay',
  roleplaypvp: 'Roleplay PvP',
});

export const FOREVER_LEGACY_RULESETS = Object.freeze({
  p: 'PvP',
  n: 'Normal',
  r: 'Roleplay',
});

export const ANNIVERSARY_REALMS = Object.freeze([
  'dreamscythe',
  'nightslayer',
  'maladath',
  'doomhowl',
]);

export const MARKETS = Object.freeze([
  'Alliance',
  'Horde',
  'Neutral',
  'CrossFaction',
  'Commodities',
]);

export const MAX_COPPER_CAP = 99999999999;

export const FEATURES = Object.freeze([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export const COVERAGE_THRESHOLDS = Object.freeze({
  tier1PerFeature: 5,
  tier2PerFeature: 5,
  tier3Total: 12,
  tier4Total: 6,
  totalMinimum: 138,
});

// ---------------------------------------------------------------------------
// Opaque-Box UI Selectors (TEST_INFRA.md § Opaque-Box UI & API Contracts)
// ---------------------------------------------------------------------------

export const SELECTORS = Object.freeze({
  // 1. Navigation & Era / Realm Controls
  appShell: 'app-shell',
  flavorTab: (flavor) => `flavor-tab-${flavor}`,
  eraLogo: 'era-logo',
  trademarkFooter: 'trademark-footer',
  rulesetSelect: 'ruleset-select',
  marketTab: (market) => `market-tab-${market}`,

  // 2. Auction Browser, Search & Price History
  auctionSearchInput: 'auction-search-input',
  sortSelect: 'sort-select',
  qualityFilter: 'quality-filter',
  auctionTable: 'auction-table',
  emptyMarketState: 'empty-market-state',
  paginationPrev: 'pagination-prev',
  paginationNext: 'pagination-next',
  priceHistoryChart: 'price-history-chart',
  addToListBtn: 'add-to-list-btn',

  // 3. Login-Free Shopping Lists & !MS1! Import/Export
  navShoppingLists: 'nav-shopping-lists',
  createListInput: 'create-list-input',
  createListBtn: 'create-list-btn',
  shoppingListSelect: 'shopping-list-select',
  deleteListBtn: 'delete-list-btn',
  shoppingItemRow: 'shopping-item-row',
  exportMs1Btn: 'export-ms1-btn',
  ms1ExportOutput: 'ms1-export-output',
  importMs1Btn: 'import-ms1-btn',
  ms1ImportInput: 'ms1-import-input',
  ms1ImportConfirm: 'ms1-import-confirm',
  ms1ImportError: 'ms1-import-error',

  // 4. Optional Battle.net OAuth, Alerts & Notifications
  bnetLoginBtn: 'bnet-login-btn',
  userBattletag: 'user-battletag',
  linkedCharacters: 'linked-characters',
  logoutBtn: 'logout-btn',
  navAlerts: 'nav-alerts',
  notificationEmailInput: 'notification-email-input',
  saveNotificationSettingsBtn: 'save-notification-settings-btn',
  createAlertBtn: 'create-alert-btn',
  alertRulesList: 'alert-rules-list',
  notificationInbox: 'notification-inbox',
});

export function byTestId(id) {
  return `[data-testid="${id}"]`;
}

// ---------------------------------------------------------------------------
// Independent !MS1! Codec (PROJECT.md § Interface Contracts #1)
// ---------------------------------------------------------------------------

export class MS1FormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MS1FormatError';
    this.code = code;
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Standard IEEE 802.3 CRC-32 (0xEDB88320) over raw bytes.
 */
export function crc32(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes);
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(bytes) {
  return crc32(bytes).toString(16).padStart(8, '0');
}

export function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(str) {
  if (typeof str !== 'string' || str.length === 0) {
    throw new MS1FormatError('BAD_BASE64URL', 'Base64url payload must be a non-empty string');
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(str)) {
    throw new MS1FormatError('BAD_BASE64URL', 'Payload contains non-base64url characters (no =, +, /, or whitespace allowed)');
  }
  if (str.length % 4 === 1) {
    throw new MS1FormatError('BAD_BASE64URL', 'Invalid base64url payload length');
  }
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates and optionally normalizes a v1 !MS1! payload object.
 */
export function validateMS1Payload(obj, { normalizeDefaults = false } = {}) {
  if (!isPlainObject(obj)) {
    throw new MS1FormatError('BAD_SCHEMA', 'MS1 payload must be a JSON object');
  }
  if (obj.v !== 1) {
    throw new MS1FormatError('BAD_SCHEMA', `Unsupported MS1 schema version: ${String(obj.v)}`);
  }
  if (typeof obj.n !== 'string' || obj.n.length < 1 || obj.n.length > 64) {
    throw new MS1FormatError('BAD_SCHEMA', 'List name "n" must be a string of 1..64 characters');
  }
  if (obj.f !== undefined && !FLAVORS.includes(obj.f)) {
    throw new MS1FormatError('BAD_SCHEMA', `Invalid flavor "f": ${String(obj.f)}`);
  }
  if (obj.r !== undefined && (typeof obj.r !== 'string' || obj.r.length === 0)) {
    throw new MS1FormatError('BAD_SCHEMA', 'Optional ruleset/realm "r" must be a non-empty string');
  }
  if (obj.fa !== undefined && !MARKETS.includes(obj.fa)) {
    throw new MS1FormatError('BAD_SCHEMA', `Invalid market/faction "fa": ${String(obj.fa)}`);
  }
  if (!Array.isArray(obj.i)) {
    throw new MS1FormatError('BAD_SCHEMA', 'Item list "i" must be an array');
  }

  const normalizedItems = obj.i.map((raw, idx) => {
    if (!isPlainObject(raw)) {
      throw new MS1FormatError('BAD_SCHEMA', `Item at index ${idx} must be an object`);
    }
    if (!Number.isInteger(raw.id) || raw.id <= 0) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].id must be a positive integer`);
    }

    let q = raw.q;
    if (q === undefined) {
      if (!normalizeDefaults) {
        throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].q is required when encoding`);
      }
      q = 1;
    } else if (!Number.isInteger(q) || q < 1) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].q must be a positive integer >= 1`);
    }

    if (raw.s !== undefined && (!Number.isInteger(raw.s) || raw.s < 0)) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].s must be a non-negative integer`);
    }
    if (raw.m !== undefined && (!Number.isSafeInteger(raw.m) || raw.m < 0 || raw.m > MAX_COPPER_CAP)) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].m must be an integer in [0, ${MAX_COPPER_CAP}]`);
    }
    if (raw.nm !== undefined && typeof raw.nm !== 'string') {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].nm must be a string`);
    }
    if (raw.nt !== undefined && typeof raw.nt !== 'string') {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].nt must be a string`);
    }
    if (raw.d !== undefined && raw.d !== 0 && raw.d !== 1) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].d must be 0 or 1`);
    }
    if (raw.a !== undefined && raw.a !== 0 && raw.a !== 1) {
      throw new MS1FormatError('BAD_SCHEMA', `Item[${idx}].a must be 0 or 1`);
    }

    const item = { id: raw.id };
    if (raw.s !== undefined) item.s = raw.s;
    item.q = q;
    if (raw.m !== undefined) item.m = raw.m;
    if (raw.nm !== undefined) item.nm = raw.nm;
    if (raw.nt !== undefined) item.nt = raw.nt;
    if (raw.d !== undefined) item.d = raw.d;
    if (raw.a !== undefined) item.a = raw.a;
    return item;
  });

  const out = { v: 1, n: obj.n };
  if (obj.f !== undefined) out.f = obj.f;
  if (obj.r !== undefined) out.r = obj.r;
  if (obj.fa !== undefined) out.fa = obj.fa;
  out.i = normalizedItems;
  return out;
}

export function encodeMS1(payload) {
  const normalized = validateMS1Payload(payload, { normalizeDefaults: true });
  const json = JSON.stringify(normalized);
  const utf8Bytes = new TextEncoder().encode(json);
  const b64url = toBase64Url(utf8Bytes);
  const checksum = crc32Hex(utf8Bytes);
  return `!MS1!${b64url}.${checksum}`;
}

export function decodeMS1(str) {
  if (typeof str !== 'string') {
    throw new MS1FormatError('BAD_PREFIX', 'MS1 string must be a string');
  }
  const trimmed = str.trim();
  if (!trimmed.startsWith('!MS1!')) {
    throw new MS1FormatError('BAD_PREFIX', 'String must start with "!MS1!"');
  }

  const body = trimmed.slice(5);
  const dotIdx = body.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== body.lastIndexOf('.')) {
    throw new MS1FormatError('BAD_STRUCTURE', 'MS1 string must contain exactly one "." separating payload and CRC32');
  }

  const b64url = body.slice(0, dotIdx);
  const checksumHex = body.slice(dotIdx + 1);
  if (!/^[0-9a-f]{8}$/.test(checksumHex)) {
    throw new MS1FormatError('BAD_STRUCTURE', 'CRC32 checksum must be exactly 8 lowercase hex characters');
  }

  const rawBytes = fromBase64Url(b64url);
  const actualHex = crc32Hex(rawBytes);
  if (actualHex !== checksumHex) {
    throw new MS1FormatError(
      'BAD_CRC32',
      `CRC32 mismatch: expected ${checksumHex}, computed ${actualHex}`
    );
  }

  let jsonStr;
  try {
    jsonStr = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch (err) {
    throw new MS1FormatError('BAD_UTF8', `Invalid UTF-8 payload: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new MS1FormatError('BAD_JSON', `Invalid JSON payload: ${err.message}`);
  }

  return validateMS1Payload(parsed, { normalizeDefaults: true });
}

// ---------------------------------------------------------------------------
// HTTP Backend Contract Validators (PROJECT.md § Interface Contracts #3)
// ---------------------------------------------------------------------------

export function assertHealthContract(body, expectedMode) {
  assert.ok(isPlainObject(body), 'Health response must be a JSON object');
  assert.equal(body.ok, true, 'Health response ok must be true');
  assert.ok(
    body.mode === 'cloudflare' || body.mode === 'selfhosted',
    `Health mode must be cloudflare|selfhosted, got ${String(body.mode)}`
  );
  if (expectedMode) {
    assert.equal(body.mode, expectedMode, `Expected mode ${expectedMode}, got ${body.mode}`);
  }
  assert.equal(typeof body.version, 'string', 'Health version must be a string');
  assert.ok(body.version.length > 0, 'Health version must be non-empty');
}

export function assertCapabilitiesContract(body, expectedMode) {
  assert.ok(isPlainObject(body), 'Capabilities response must be a JSON object');
  assert.ok(
    body.mode === 'cloudflare' || body.mode === 'selfhosted',
    `Capabilities mode must be cloudflare|selfhosted, got ${String(body.mode)}`
  );
  if (expectedMode) {
    assert.equal(body.mode, expectedMode);
  }
  assert.equal(typeof body.persistence, 'boolean', 'capabilities.persistence must be boolean');
  assert.equal(typeof body.oauth, 'boolean', 'capabilities.oauth must be boolean');
  assert.equal(typeof body.email, 'boolean', 'capabilities.email must be boolean');
  assert.ok(Array.isArray(body.flavors), 'capabilities.flavors must be an array');
  for (const f of FLAVORS) {
    assert.ok(body.flavors.includes(f), `capabilities.flavors missing "${f}"`);
  }
}

export function assertDatasetIndexContract(body) {
  assert.ok(isPlainObject(body), 'datasets/index.json must be a JSON object');
  assert.ok(Array.isArray(body.blocks), 'index.json must include blocks array');
  assert.equal(typeof body.lastUpdated, 'string', 'index.json must include lastUpdated string');
  for (const [idx, block] of body.blocks.entries()) {
    assert.ok(isPlainObject(block), `blocks[${idx}] must be an object`);
    assert.equal(typeof block.path, 'string', `blocks[${idx}].path must be a string`);
    assert.equal(typeof block.date, 'string', `blocks[${idx}].date must be a string`);
    assert.equal(typeof block.hour, 'string', `blocks[${idx}].hour must be a string`);
    assert.equal(typeof block.timestamp, 'number', `blocks[${idx}].timestamp must be a number`);
    if (block.flavor !== undefined) {
      assert.ok(FLAVORS.includes(block.flavor), `blocks[${idx}].flavor invalid: ${block.flavor}`);
    }
  }
}

export function assertSnapshotBlockContract(body) {
  assert.ok(isPlainObject(body), 'Snapshot block must be a JSON object');
  assert.equal(typeof body.version, 'string', 'Snapshot version must be a string');
  assert.equal(typeof body.timestamp, 'number', 'Snapshot timestamp must be a number');
  assert.equal(typeof body.region, 'string', 'Snapshot region must be a string');
  assert.ok(isPlainObject(body.rulesets), 'Snapshot rulesets must be an object');
  if (body.flavor !== undefined) {
    assert.ok(FLAVORS.includes(body.flavor), `Snapshot flavor invalid: ${body.flavor}`);
  }
  for (const [rulesetKey, markets] of Object.entries(body.rulesets)) {
    assert.ok(isPlainObject(markets), `rulesets["${rulesetKey}"] must be an object`);
    for (const [marketKey, items] of Object.entries(markets)) {
      assert.ok(isPlainObject(items), `rulesets["${rulesetKey}"]["${marketKey}"] must be an object`);
    }
  }
}

export function assertItemsMetadataContract(body) {
  assert.ok(isPlainObject(body), '/api/items response must be an object map');
}

export function assertAuthMeContract(body) {
  assert.ok(isPlainObject(body), '/api/auth/me response must be an object');
  assert.equal(typeof body.authenticated, 'boolean', '/api/auth/me must include boolean authenticated');
  if (body.authenticated) {
    assert.ok(isPlainObject(body.user), 'Authenticated /api/auth/me must include user object');
    assert.equal(typeof body.user.battletag, 'string', 'user.battletag must be a string');
    if (body.characters !== undefined) {
      assert.ok(Array.isArray(body.characters), 'characters must be an array when present');
    }
  }
}

export function assertListsContract(body) {
  assert.ok(
    Array.isArray(body) || (isPlainObject(body) && Array.isArray(body.lists)),
    '/api/lists must return an array or { lists: [] }'
  );
}

export function assertAlertsContract(body) {
  assert.ok(
    Array.isArray(body) || (isPlainObject(body) && Array.isArray(body.alerts)),
    '/api/alerts must return an array or { alerts: [] }'
  );
}

export function assertNotificationsContract(body) {
  assert.ok(
    Array.isArray(body) || (isPlainObject(body) && Array.isArray(body.notifications)),
    '/api/notifications must return an array or { notifications: [] }'
  );
}

export function assertGraceful501Contract(status, body) {
  assert.equal(status, 501, `Expected HTTP 501 in zero-DB Cloudflare mode, got ${status}`);
  assert.ok(isPlainObject(body), '501 response must be valid JSON (not HTML/stack trace)');
  assert.ok(
    typeof body.error === 'string' || typeof body.message === 'string',
    '501 JSON must explain unavailable capability via error or message'
  );
}
