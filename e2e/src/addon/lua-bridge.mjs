import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fengari from 'fengari';
import luaparse from 'luaparse';
import { decodeMS1, encodeMS1 } from '../contracts.mjs';

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

export const DEFAULT_ADDON_DIR =
  process.env.MARKETSYNC_ADDON_DIR || 'c:\\Dev Projects\\MarketSync\\MarketSync';

/**
 * Recursively walks a luaparse AST to find forbidden global identifiers (`bit`, `bit32`),
 * ignoring property names (`obj.bit`) and table string keys (`{ bit = 1 }`).
 */
function findForbiddenIdentifiers(node, forbiddenSet, hits = []) {
  if (!node || typeof node !== 'object') return hits;

  if (Array.isArray(node)) {
    for (const item of node) findForbiddenIdentifiers(item, forbiddenSet, hits);
    return hits;
  }

  if (node.type === 'Identifier' && forbiddenSet.has(node.name)) {
    hits.push({
      name: node.name,
      line: node.loc?.start?.line ?? 0,
      column: node.loc?.start?.column ?? 0,
    });
    return hits;
  }

  for (const [key, val] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') continue;
    if (node.type === 'MemberExpression' && key === 'identifier') continue;
    if (node.type === 'TableKeyString' && key === 'key') continue;
    if (node.type === 'LabelStatement' && key === 'label') continue;
    if (node.type === 'GotoStatement' && key === 'label') continue;
    findForbiddenIdentifiers(val, forbiddenSet, hits);
  }
  return hits;
}

/**
 * Validates Lua source against strict Lua 5.1 grammar using luaparse.
 * Rejects goto, //, bitwise operators (&, |, ~, <<, >>), and optionally `bit`/`bit32`.
 */
export function validateLua51Source(source, filename = '<lua>', { forbidBitLibs = false } = {}) {
  let ast;
  try {
    ast = luaparse.parse(source, { luaVersion: '5.1', locations: true });
  } catch (err) {
    const wrapped = new SyntaxError(`Lua 5.1 syntax error in ${filename}: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }

  if (forbidBitLibs) {
    const hits = findForbiddenIdentifiers(ast, new Set(['bit', 'bit32']));
    if (hits.length > 0) {
      const first = hits[0];
      throw new Error(
        `Lua 5.1 pure-arithmetic constraint violation: forbidden global '${first.name}' in ${filename}:${first.line}:${first.column}`
      );
    }
  }
  return ast;
}

export function probeAddonCodec(addonDir = DEFAULT_ADDON_DIR) {
  const listCodecPath = path.join(addonDir, 'ListCodec.lua');
  const favoritesPath = path.join(addonDir, 'Favorites.lua');
  const notificationsPath = path.join(addonDir, 'Notifications.lua');
  const tocPath = path.join(addonDir, 'MarketSync.toc');

  const addonCodecPresent = fs.existsSync(listCodecPath);
  const tocExists = fs.existsSync(tocPath);
  let tocRegistersListCodec = false;
  if (tocExists) {
    const tocContent = fs.readFileSync(tocPath, 'utf8');
    tocRegistersListCodec = /^\s*ListCodec\.lua\s*$/m.test(tocContent);
  }

  return {
    addonDir,
    addonCodecPresent,
    tocRegistersListCodec,
    files: {
      listCodec: addonCodecPresent ? listCodecPath : null,
      favorites: fs.existsSync(favoritesPath) ? favoritesPath : null,
      notifications: fs.existsSync(notificationsPath) ? notificationsPath : null,
      toc: tocExists ? tocPath : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Embedded Pure Lua 5.1 !MS1! Reference Codec (for M2-pending harness testing)
// Zero bit/bit32/goto///; strictly validated by luaparse(5.1) + forbidBitLibs
// ---------------------------------------------------------------------------

const EMBEDDED_LUA51_CODEC = `
MarketSync = MarketSync or {}
MarketSync.ListCodec = MarketSync.ListCodec or {}

local LC = MarketSync.ListCodec

local function bxor32(a, b)
    local res = 0.0
    local p = 1.0
    for _ = 1, 32 do
        local abit = a % 2
        local bbit = b % 2
        if abit ~= bbit then
            res = res + p
        end
        a = math.floor(a / 2)
        b = math.floor(b / 2)
        p = p * 2.0
    end
    return res
end

local CRC_TABLE = {}
for i = 0, 255 do
    local c = i
    for _ = 1, 8 do
        if (c % 2) == 1 then
            c = bxor32(math.floor(c / 2), 3988292384)
        else
            c = math.floor(c / 2)
        end
    end
    CRC_TABLE[i] = c
end

local HEX_CHARS = "0123456789abcdef"
local function toHex8(n)
    local out = {}
    for i = 8, 1, -1 do
        local nib = n % 16
        out[i] = string.sub(HEX_CHARS, nib + 1, nib + 1)
        n = math.floor(n / 16)
    end
    return table.concat(out)
end

function LC.CRC32Hex(str)
    local c = 4294967295
    for i = 1, #str do
        local b = string.byte(str, i)
        local low = c % 256
        local idx = bxor32(low, b)
        local shifted = math.floor(c / 256)
        c = bxor32(CRC_TABLE[idx], shifted)
    end
    return toHex8(bxor32(c, 4294967295))
end

local B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local B64_DECODE = {}
for i = 1, #B64_ALPHABET do
    B64_DECODE[string.sub(B64_ALPHABET, i, i)] = i - 1
end

function LC.Base64UrlEncode(str)
    local out = {}
    local len = #str
    local i = 1
    while i <= len do
        local b1 = string.byte(str, i)
        local b2 = (i + 1 <= len) and string.byte(str, i + 1) or 0
        local b3 = (i + 2 <= len) and string.byte(str, i + 2) or 0
        local n = b1 * 65536 + b2 * 256 + b3

        local c1 = math.floor(n / 262144) % 64
        local c2 = math.floor(n / 4096) % 64
        local c3 = math.floor(n / 64) % 64
        local c4 = n % 64

        table.insert(out, string.sub(B64_ALPHABET, c1 + 1, c1 + 1))
        table.insert(out, string.sub(B64_ALPHABET, c2 + 1, c2 + 1))
        if i + 1 <= len then
            table.insert(out, string.sub(B64_ALPHABET, c3 + 1, c3 + 1))
        end
        if i + 2 <= len then
            table.insert(out, string.sub(B64_ALPHABET, c4 + 1, c4 + 1))
        end
        i = i + 3
    end
    return table.concat(out)
end

function LC.Base64UrlDecode(str)
    if type(str) ~= "string" or #str == 0 or (#str % 4) == 1 then
        return nil, "BAD_BASE64URL"
    end
    local out = {}
    local len = #str
    local i = 1
    while i <= len do
        local ch1 = string.sub(str, i, i)
        local ch2 = string.sub(str, i + 1, i + 1)
        local v1 = B64_DECODE[ch1]
        local v2 = B64_DECODE[ch2]
        if not v1 or not v2 then
            return nil, "BAD_BASE64URL"
        end

        local rem = len - i + 1
        local ch3 = (rem >= 3) and string.sub(str, i + 2, i + 2) or nil
        local ch4 = (rem >= 4) and string.sub(str, i + 3, i + 3) or nil
        local v3 = ch3 and B64_DECODE[ch3] or 0
        local v4 = ch4 and B64_DECODE[ch4] or 0
        if (ch3 and not B64_DECODE[ch3]) or (ch4 and not B64_DECODE[ch4]) then
            return nil, "BAD_BASE64URL"
        end

        local n = v1 * 262144 + v2 * 4096 + v3 * 64 + v4
        local b1 = math.floor(n / 65536) % 256
        local b2 = math.floor(n / 256) % 256
        local b3 = n % 256
        table.insert(out, string.char(b1))
        if ch3 then
            table.insert(out, string.char(b2))
        end
        if ch4 then
            table.insert(out, string.char(b3))
        end
        i = i + 4
    end
    return table.concat(out)
end

local function jsonEscapeStr(s)
    local out = { '"' }
    for i = 1, #s do
        local ch = string.sub(s, i, i)
        local b = string.byte(ch)
        if ch == '"' then table.insert(out, '\\"')
        elseif ch == '\\\\' then table.insert(out, '\\\\\\\\')
        elseif ch == '\\b' then table.insert(out, '\\\\b')
        elseif ch == '\\f' then table.insert(out, '\\\\f')
        elseif ch == '\\n' then table.insert(out, '\\\\n')
        elseif ch == '\\r' then table.insert(out, '\\\\r')
        elseif ch == '\\t' then table.insert(out, '\\\\t')
        elseif b < 32 then
            table.insert(out, string.format("\\\\u%04x", b))
        else
            table.insert(out, ch)
        end
    end
    table.insert(out, '"')
    return table.concat(out)
end

local function jsonEncodeNumber(v)
    if v == math.floor(v) and v >= -9007199254740991 and v <= 9007199254740991 then
        return string.format("%.0f", v)
    end
    return tostring(v)
end

local function encodeItemJson(it)
    local parts = {}
    table.insert(parts, '"id":' .. jsonEncodeNumber(it.id))
    if it.s ~= nil then table.insert(parts, '"s":' .. jsonEncodeNumber(it.s)) end
    table.insert(parts, '"q":' .. jsonEncodeNumber(it.q or 1))
    if it.m ~= nil then table.insert(parts, '"m":' .. jsonEncodeNumber(it.m)) end
    if it.nm ~= nil then table.insert(parts, '"nm":' .. jsonEscapeStr(it.nm)) end
    if it.nt ~= nil then table.insert(parts, '"nt":' .. jsonEscapeStr(it.nt)) end
    if it.d ~= nil then table.insert(parts, '"d":' .. jsonEncodeNumber(it.d)) end
    if it.a ~= nil then table.insert(parts, '"a":' .. jsonEncodeNumber(it.a)) end
    return "{" .. table.concat(parts, ",") .. "}"
end

function LC.Encode(list)
    if type(list) ~= "table" then return nil, "BAD_SCHEMA" end
    if type(list.n) ~= "string" or #list.n < 1 or #list.n > 64 then return nil, "BAD_SCHEMA" end
    if type(list.i) ~= "table" then return nil, "BAD_SCHEMA" end

    local parts = { '"v":1', '"n":' .. jsonEscapeStr(list.n) }
    if list.f ~= nil then table.insert(parts, '"f":' .. jsonEscapeStr(list.f)) end
    if list.r ~= nil then table.insert(parts, '"r":' .. jsonEscapeStr(list.r)) end
    if list.fa ~= nil then table.insert(parts, '"fa":' .. jsonEscapeStr(list.fa)) end

    local items = {}
    for _, it in ipairs(list.i) do
        if type(it) ~= "table" or type(it.id) ~= "number" or it.id <= 0 then
            return nil, "BAD_SCHEMA"
        end
        table.insert(items, encodeItemJson(it))
    end
    table.insert(parts, '"i":[' .. table.concat(items, ",") .. "]")

    local json = "{" .. table.concat(parts, ",") .. "}"
    local payload = LC.Base64UrlEncode(json)
    local crc = LC.CRC32Hex(json)
    return "!MS1!" .. payload .. "." .. crc
end

local function jsonDecode(str)
    local pos = 1
    local len = #str

    local function skipWs()
        while pos <= len do
            local ch = string.sub(str, pos, pos)
            if ch == " " or ch == "\\t" or ch == "\\n" or ch == "\\r" then
                pos = pos + 1
            else
                break
            end
        end
    end

    local parseValue

    local function parseString()
        pos = pos + 1
        local out = {}
        while pos <= len do
            local ch = string.sub(str, pos, pos)
            if ch == '"' then
                pos = pos + 1
                return table.concat(out)
            elseif ch == "\\\\" then
                pos = pos + 1
                local esc = string.sub(str, pos, pos)
                if esc == '"' or esc == "\\\\" or esc == "/" then table.insert(out, esc)
                elseif esc == "b" then table.insert(out, "\\b")
                elseif esc == "f" then table.insert(out, "\\f")
                elseif esc == "n" then table.insert(out, "\\n")
                elseif esc == "r" then table.insert(out, "\\r")
                elseif esc == "t" then table.insert(out, "\\t")
                elseif esc == "u" then
                    local hex = string.sub(str, pos + 1, pos + 4)
                    local code = tonumber(hex, 16)
                    if not code then error("Invalid unicode escape") end
                    if code < 128 then
                        table.insert(out, string.char(code))
                    elseif code < 2048 then
                        table.insert(out, string.char(192 + math.floor(code / 64), 128 + (code % 64)))
                    else
                        table.insert(out, string.char(224 + math.floor(code / 4096), 128 + (math.floor(code / 64) % 64), 128 + (code % 64)))
                    end
                    pos = pos + 4
                else
                    error("Invalid escape")
                end
                pos = pos + 1
            else
                table.insert(out, ch)
                pos = pos + 1
            end
        end
        error("Unterminated string")
    end

    local function parseNumber()
        local startPos = pos
        if string.sub(str, pos, pos) == "-" then pos = pos + 1 end
        while pos <= len and string.match(string.sub(str, pos, pos), "[0-9%.eE%+%-]") do
            pos = pos + 1
        end
        local num = tonumber(string.sub(str, startPos, pos - 1))
        if not num then error("Invalid number") end
        return num
    end

    local function parseArray()
        pos = pos + 1
        local arr = {}
        skipWs()
        if string.sub(str, pos, pos) == "]" then
            pos = pos + 1
            return arr
        end
        while true do
            skipWs()
            table.insert(arr, parseValue())
            skipWs()
            local ch = string.sub(str, pos, pos)
            if ch == "]" then
                pos = pos + 1
                return arr
            elseif ch == "," then
                pos = pos + 1
            else
                error("Expected , or ]")
            end
        end
    end

    local function parseObject()
        pos = pos + 1
        local obj = {}
        skipWs()
        if string.sub(str, pos, pos) == "}" then
            pos = pos + 1
            return obj
        end
        while true do
            skipWs()
            if string.sub(str, pos, pos) ~= '"' then error("Expected string key") end
            local k = parseString()
            skipWs()
            if string.sub(str, pos, pos) ~= ":" then error("Expected :") end
            pos = pos + 1
            skipWs()
            obj[k] = parseValue()
            skipWs()
            local ch = string.sub(str, pos, pos)
            if ch == "}" then
                pos = pos + 1
                return obj
            elseif ch == "," then
                pos = pos + 1
            else
                error("Expected , or }")
            end
        end
    end

    parseValue = function()
        skipWs()
        local ch = string.sub(str, pos, pos)
        if ch == '"' then return parseString()
        elseif ch == "{" then return parseObject()
        elseif ch == "[" then return parseArray()
        elseif ch == "t" and string.sub(str, pos, pos + 3) == "true" then pos = pos + 4; return true
        elseif ch == "f" and string.sub(str, pos, pos + 4) == "false" then pos = pos + 5; return false
        elseif ch == "n" and string.sub(str, pos, pos + 3) == "null" then pos = pos + 4; return nil
        else return parseNumber()
        end
    end

    local val = parseValue()
    skipWs()
    if pos <= len then error("Trailing garbage") end
    return val
end

function LC.Decode(str)
    if type(str) ~= "string" then return nil, "BAD_PREFIX" end
    str = str:match("^%s*(.-)%s*$")
    if string.sub(str, 1, 5) ~= "!MS1!" then
        return nil, "BAD_PREFIX"
    end
    local rest = string.sub(str, 6)
    local b64, hex = rest:match("^([^%.]+)%.([0-9a-f]+)$")
    if not b64 or not hex or #hex ~= 8 then
        return nil, "BAD_STRUCTURE"
    end
    local raw, bErr = LC.Base64UrlDecode(b64)
    if not raw then
        return nil, bErr or "BAD_BASE64URL"
    end
    if LC.CRC32Hex(raw) ~= hex then
        return nil, "BAD_CRC32"
    end
    local ok, parsed = pcall(jsonDecode, raw)
    if not ok or type(parsed) ~= "table" then
        return nil, "BAD_JSON"
    end
    if parsed.v ~= 1 or type(parsed.n) ~= "string" or #parsed.n < 1 or #parsed.n > 64 or type(parsed.i) ~= "table" then
        return nil, "BAD_SCHEMA"
    end
    for _, it in ipairs(parsed.i) do
        if type(it) ~= "table" or type(it.id) ~= "number" or it.id <= 0 or math.floor(it.id) ~= it.id then
            return nil, "BAD_SCHEMA"
        end
        if it.q == nil then it.q = 1 end
        if type(it.q) ~= "number" or it.q < 1 then
            return nil, "BAD_SCHEMA"
        end
    end
    return parsed
end

function LC.ImportToFavorites(str)
    local list, err = LC.Decode(str)
    if not list then return false, err end
    if MarketSync.Favorites and MarketSync.Favorites.CreateList then
        MarketSync.Favorites.CreateList(list.n)
    end
    MarketSyncDB.Favorites = MarketSyncDB.Favorites or {}
    MarketSyncDB.Favorites[list.n] = MarketSyncDB.Favorites[list.n] or {}
    MarketSyncDB.FavoriteQuantities = MarketSyncDB.FavoriteQuantities or {}
    MarketSyncDB.FavoriteQuantities[list.n] = MarketSyncDB.FavoriteQuantities[list.n] or {}
    MarketSyncDB.FavoriteMeta = MarketSyncDB.FavoriteMeta or {}
    MarketSyncDB.FavoriteMeta[list.n] = MarketSyncDB.FavoriteMeta[list.n] or {}

    for _, it in ipairs(list.i) do
        local key = (it.s and it.s > 0) and (string.format("%.0f:%.0f", it.id, it.s)) or string.format("%.0f", it.id)
        table.insert(MarketSyncDB.Favorites[list.n], it.id)
        MarketSyncDB.FavoriteQuantities[list.n][it.id] = it.q or 1
        MarketSyncDB.FavoriteMeta[list.n][key] = {
            id = it.id,
            s = it.s,
            q = it.q or 1,
            m = it.m,
            nm = it.nm,
            nt = it.nt,
            d = it.d,
            a = it.a,
        }
        if it.a == 1 and MarketSync.UpsertNotificationRequest then
            MarketSync.UpsertNotificationRequest({
                matchType = "id",
                matchValue = key,
                maxPrice = it.m or 0,
                scope = "all",
                enabled = true,
            })
        end
    end
    return true, list
end

function LC.ExportFromFavorites(listName)
    local favs = MarketSyncDB.Favorites and MarketSyncDB.Favorites[listName]
    if not favs then return nil, "LIST_NOT_FOUND" end
    local metaMap = (MarketSyncDB.FavoriteMeta and MarketSyncDB.FavoriteMeta[listName]) or {}
    local qtyMap = (MarketSyncDB.FavoriteQuantities and MarketSyncDB.FavoriteQuantities[listName]) or {}
    local items = {}
    local seen = {}
    for _, itemId in ipairs(favs) do
        if not seen[itemId] then
            seen[itemId] = true
            local meta = metaMap[tostring(itemId)]
            if meta then
                local copy = {
                    id = meta.id,
                    s = meta.s,
                    q = qtyMap[itemId] or meta.q or 1,
                    m = meta.m,
                    nm = meta.nm,
                    nt = meta.nt,
                    d = meta.d,
                    a = meta.a,
                }
                if metaMap.items and metaMap.items[itemId] and metaMap.items[itemId].done then
                    copy.d = 1
                end
                table.insert(items, copy)
            else
                table.insert(items, { id = itemId, q = qtyMap[itemId] or 1 })
            end
        end
    end
    for k, meta in pairs(metaMap) do
        if string.find(k, ":") and type(meta) == "table" then
            table.insert(items, meta)
        end
    end
    return LC.Encode({ v = 1, n = listName, i = items })
end
`;

function toLuaStringLiteral(str) {
  return `"${String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function toLuaValue(val) {
  if (val === null || val === undefined) return 'nil';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '0';
    return Number.isInteger(val) ? String(val) : String(val);
  }
  if (typeof val === 'string') return toLuaStringLiteral(val);
  if (Array.isArray(val)) {
    return `{ ${val.map((v) => toLuaValue(v)).join(', ')} }`;
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `[${toLuaStringLiteral(k)}] = ${toLuaValue(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return 'nil';
}

function buildBootChunk({ realm = 'Whitemane', faction = 'Alliance', nowUnix = 1795338869, itemDB = {} } = {}) {
  const itemDbEntries = Object.entries(itemDB)
    .map(([id, name]) => `[${Number(id)}] = ${toLuaStringLiteral(name)}`)
    .join(', ');

  return `
-- Lua 5.1 shims on fengari Lua 5.3 VM
unpack = unpack or table.unpack
loadstring = loadstring or load
math.pow = math.pow or function(x, y) return x ^ y end
math.atan2 = math.atan2 or math.atan

_E2E_PRINTS = {}
_E2E_TIMERS = {}
_E2E_NOW = ${Math.floor(nowUnix)}

function print(...)
    local args = { ... }
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring(args[i])
    end
    table.insert(_E2E_PRINTS, table.concat(parts, "\\t"))
end

function GetTime() return _E2E_NOW end
function time() return _E2E_NOW end
function GetServerTime() return _E2E_NOW end
function date(fmt, ts) return os.date(fmt or "%Y-%m-%d", ts or _E2E_NOW) end
function GetBuildInfo() return "1.15.4", "57000", "Nov 22 2026", 11504 end
function GetRealmName() return ${toLuaStringLiteral(realm)} end
function GetNormalizedRealmName() return ${toLuaStringLiteral(realm.replace(/[^a-zA-Z0-9]/g, ''))} end
function UnitName() return "MarketTester", ${toLuaStringLiteral(realm)} end
function UnitFullName() return "MarketTester", ${toLuaStringLiteral(realm)} end
function UnitFactionGroup() return ${toLuaStringLiteral(faction)}, ${toLuaStringLiteral(faction)} end
function InCombatLockdown() return false end
function IsLoggedIn() return true end
function GetMoney() return 5000000 end

function strtrim(s) return (tostring(s or ""):match("^%s*(.-)%s*$")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
tinsert = table.insert
tremove = table.remove
strfind = string.find
strmatch = string.match
format = string.format
gsub = string.gsub
strupper = string.upper
strlower = string.lower
strsub = string.sub
strlen = string.len
strbyte = string.byte
strchar = string.char
function strsplit(sep, str)
    local res = {}
    local pattern = string.format("([^%s]+)", sep)
    for part in string.gmatch(tostring(str or ""), pattern) do
        table.insert(res, part)
    end
    return unpack(res)
end
function hooksecurefunc() end

UIParent = {}
UISpecialFrames = {}
StaticPopupDialogs = {}
SlashCmdList = {}
ChatTypeInfo = { RAID_WARNING = { r = 1, g = 0.28, b = 0 } }
RaidWarningFrame = {}
function RaidNotice_AddMessage() end
function PlaySound() return true end
function PlaySoundFile() return true end
C_Timer = {
    After = function(_, cb)
        if type(cb) == "function" then table.insert(_E2E_TIMERS, cb) end
    end,
    NewTicker = function(_, cb)
        return { Cancel = function() end }
    end
}

function CreateFrame(frameType, name)
    local frame = {
        _type = frameType,
        _name = name,
        _scripts = {},
        _shown = false,
        _text = "",
    }
    local mt = {
        __index = function(t, k)
            return function() return t end
        end
    }
    function frame:SetScript(ev, fn) self._scripts[ev] = fn end
    function frame:GetScript(ev) return self._scripts[ev] end
    function frame:HookScript(ev, fn) self._scripts[ev] = fn end
    function frame:RegisterEvent() end
    function frame:SetText(txt) self._text = tostring(txt or "") end
    function frame:GetText() return self._text end
    function frame:Show() self._shown = true end
    function frame:Hide() self._shown = false end
    function frame:IsShown() return self._shown end
    function frame:SetSize() end
    function frame:SetPoint() end
    function frame:CreateFontString() return CreateFrame("FontString") end
    function frame:CreateTexture() return CreateFrame("Texture") end
    setmetatable(frame, mt)
    if name then _G[name] = frame end
    return frame
end

local _E2E_ITEM_DB = { ${itemDbEntries} }

function GetItemInfoInstant(itemOrName)
    local id = tonumber(itemOrName)
    if id and _E2E_ITEM_DB[id] then return id, "Consumable", "Potion", "", 134400 end
    if type(itemOrName) == "string" then
        for k, v in pairs(_E2E_ITEM_DB) do
            if v == itemOrName then return k, "Consumable", "Potion", "", 134400 end
        end
    end
    return nil
end

function GetItemInfo(itemOrId)
    local id = tonumber(itemOrId)
    if id and _E2E_ITEM_DB[id] then
        local name = _E2E_ITEM_DB[id]
        return name, "|cffffffff|Hitem:" .. tostring(id) .. "::::::::60:::::::|h[" .. name .. "]|h|r", 1, 60, 1, "Consumable", "Potion", 20, "", 134400, 100
    end
    return nil
end

C_Item = {
    GetItemInfo = GetItemInfo,
    GetItemInfoInstant = GetItemInfoInstant,
    GetItemIconByID = function(id) return _E2E_ITEM_DB[tonumber(id) or 0] and 134400 or nil end,
    RequestLoadItemDataByID = function() end,
}

MarketSyncDB = {
    Favorites = {},
    FavoriteQuantities = {},
    FavoriteMeta = {},
    ItemInfoCache = {},
    RealmData = {},
}

MarketSync = MarketSync or {}
function MarketSync.GetFactionRealmKey()
    return GetNormalizedRealmName() .. "@" .. ${toLuaStringLiteral(faction)}
end
function MarketSync.GetRealmDB()
    local key = MarketSync.GetFactionRealmKey()
    if not MarketSyncDB.RealmData[key] then
        MarketSyncDB.RealmData[key] = {
            NotificationRequests = {},
            NotificationState = {},
            NotificationLog = {},
            NotificationSettings = {
                rearmBufferPct = 5,
                rearmAfterSec = 1800,
                defaultCooldownSec = 300,
            },
        }
    end
    return MarketSyncDB.RealmData[key]
end
function MarketSync.FormatMoney(copper)
    return tostring(math.floor(tonumber(copper) or 0)) .. "c"
end
function MarketSync.GetItemInfo(id)
    return GetItemInfo(id)
end
function MarketSync.StartMinimapFlash() end
function MarketSync.StopMinimapFlash() end
`;
}

export function createLuaAddonVM(options = {}) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  let closed = false;

  function runLua(code, chunkName = 'eval') {
    if (closed) throw new Error('Lua VM is closed');
    const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(chunkName));
    if (loadStatus !== lua.LUA_OK) {
      const msg = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_pop(L, 1);
      throw new Error(`Lua compile error (${chunkName}): ${msg}`);
    }
    const callStatus = lua.lua_pcall(L, 0, 1, 0);
    if (callStatus !== lua.LUA_OK) {
      const msg = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_pop(L, 1);
      throw new Error(`Lua runtime error (${chunkName}): ${msg}`);
    }
    let result = null;
    if (lua.lua_type(L, -1) === lua.LUA_TSTRING) {
      result = to_jsstring(lua.lua_tostring(L, -1));
    } else if (lua.lua_type(L, -1) === lua.LUA_TNUMBER) {
      result = lua.lua_tonumber(L, -1);
    } else if (lua.lua_type(L, -1) === lua.LUA_TBOOLEAN) {
      result = lua.lua_toboolean(L, -1);
    }
    lua.lua_pop(L, 1);
    return result;
  }

  function loadLuaSource(source, filename, { forbidBitLibs = false } = {}) {
    validateLua51Source(source, filename, { forbidBitLibs });
    const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(source), null, to_luastring(filename));
    if (loadStatus !== lua.LUA_OK) {
      const msg = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_pop(L, 1);
      throw new Error(`Lua load error (${filename}): ${msg}`);
    }
    // Pass WoW varargs ("MarketSync", _G.MarketSync)
    lua.lua_pushstring(L, to_luastring('MarketSync'));
    lua.lua_getglobal(L, to_luastring('MarketSync'));
    const callStatus = lua.lua_pcall(L, 2, 0, 0);
    if (callStatus !== lua.LUA_OK) {
      const msg = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_pop(L, 1);
      throw new Error(`Lua execution error (${filename}): ${msg}`);
    }
  }

  function loadAddonFile(filePath, opts = {}) {
    const source = fs.readFileSync(filePath, 'utf8');
    loadLuaSource(source, path.basename(filePath), opts);
  }

  runLua(buildBootChunk(options), 'wow-boot');

  return {
    runLua,
    loadLuaSource,
    loadAddonFile,
    close() {
      if (!closed) {
        closed = true;
        lua.lua_close(L);
      }
    },
  };
}

/**
 * High-level JS <-> Lua !MS1! bridge.
 */
export function createAddonBridge(options = {}) {
  const addonDir = options.addonDir || DEFAULT_ADDON_DIR;
  const probe = probeAddonCodec(addonDir);
  const useAddonCodec = probe.addonCodecPresent && !options.useFallbackCodec;
  const vm = createLuaAddonVM({
    itemDB: {
      13464: 'Dreamfoil',
      13444: 'Major Mana Potion',
      14344: 'Large Brilliant Shard',
      ...(options.itemDB || {}),
    },
    ...options,
  });

  if (probe.files.favorites) {
    vm.loadAddonFile(probe.files.favorites);
  }
  if (probe.files.notifications) {
    vm.loadAddonFile(probe.files.notifications);
  }

  if (useAddonCodec) {
    vm.loadAddonFile(probe.files.listCodec, { forbidBitLibs: true });
  } else {
    vm.loadLuaSource(EMBEDDED_LUA51_CODEC, 'embedded-lua51-ms1-harness.lua', { forbidBitLibs: true });
  }

  // Adapter helper inside Lua supporting minor method name variations in M2's ListCodec.lua
  vm.runLua(`
    local function _e2e_escape(s)
        s = tostring(s)
        s = s:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('\\n', '\\\\n'):gsub('\\r', '\\\\r'):gsub('\\t', '\\\\t')
        return '"' .. s .. '"'
    end
    local function _e2e_num(v)
        if v == math.floor(v) then return string.format("%.0f", v) end
        return tostring(v)
    end
    local function _e2e_json(v)
        local t = type(v)
        if t == "nil" then return "null"
        elseif t == "boolean" then return v and "true" or "false"
        elseif t == "number" then return _e2e_num(v)
        elseif t == "string" then return _e2e_escape(v)
        elseif t == "table" then
            local n = #v
            local isArr = n > 0
            if not isArr then
                local hasKeys = false
                for _ in pairs(v) do hasKeys = true; break end
                if not hasKeys and getmetatable(v) and getmetatable(v).__isArray then isArr = true end
            end
            if isArr then
                local parts = {}
                for i = 1, n do parts[i] = _e2e_json(v[i]) end
                return "[" .. table.concat(parts, ",") .. "]"
            else
                local parts = {}
                for k, val in pairs(v) do
                    if val ~= nil then
                        table.insert(parts, _e2e_escape(k) .. ":" .. _e2e_json(val))
                    end
                end
                return "{" .. table.concat(parts, ",") .. "}"
            end
        end
        return "null"
    end

    _E2E_BRIDGE = {
        encode = function(listTbl)
            local lc = MarketSync.ListCodec or MarketSync
            local fn = lc.Encode or lc.EncodeList or lc.ExportList or lc.EncodeShoppingList
            if not fn then error("No Encode function found on MarketSync.ListCodec") end
            local ok, res, err = pcall(fn, listTbl)
            if not ok then return _e2e_json({ ok = false, error = tostring(res) }) end
            if not res then return _e2e_json({ ok = false, error = tostring(err or "ENCODE_FAILED") }) end
            return _e2e_json({ ok = true, encoded = res })
        end,
        decode = function(str)
            local lc = MarketSync.ListCodec or MarketSync
            local fn = lc.Decode or lc.DecodeList or lc.ImportList or lc.DecodeShoppingList
            if not fn then error("No Decode function found on MarketSync.ListCodec") end
            local res, err = fn(str)
            if not res then
                return _e2e_json({ ok = false, error = tostring(err or "DECODE_FAILED") })
            end
            if type(res.i) == "table" and #res.i == 0 then
                setmetatable(res.i, { __isArray = true })
            end
            return _e2e_json({ ok = true, list = res })
        end,
        importFavorites = function(str)
            local lc = MarketSync.ListCodec or MarketSync
            local fn = lc.ImportToFavorites or lc.ImportListToFavorites or lc.ImportList
            if not fn then
                local decoded, err = (lc.Decode or lc.DecodeList)(str)
                if not decoded then return _e2e_json({ ok = false, error = tostring(err) }) end
                return _e2e_json({ ok = true, list = decoded })
            end
            local ok, res = fn(str)
            if not ok then return _e2e_json({ ok = false, error = tostring(res) }) end
            return _e2e_json({ ok = true, list = res })
        end,
        exportFavorites = function(listName)
            local lc = MarketSync.ListCodec or MarketSync
            local fn = lc.ExportFromFavorites or lc.ExportListFromFavorites or lc.ExportList
            if not fn then return _e2e_json({ ok = false, error = "NO_EXPORT_FAVORITES" }) end
            local res, err = fn(listName)
            if not res then return _e2e_json({ ok = false, error = tostring(err) }) end
            return _e2e_json({ ok = true, encoded = res })
        end,
    }
  `, 'e2e-bridge-adapter');

  return {
    ...probe,
    addonCodecActive: useAddonCodec,
    vm,
    encodeList(listObj) {
      const raw = vm.runLua(`return _E2E_BRIDGE.encode(${toLuaValue(listObj)})`, 'bridge-encode');
      const parsed = JSON.parse(raw);
      if (!parsed.ok) throw new Error(`Lua encode failed: ${parsed.error}`);
      return parsed.encoded;
    },
    decodeList(ms1String) {
      const raw = vm.runLua(`return _E2E_BRIDGE.decode(${toLuaStringLiteral(ms1String)})`, 'bridge-decode');
      return JSON.parse(raw);
    },
    importToFavorites(ms1String) {
      const raw = vm.runLua(`return _E2E_BRIDGE.importFavorites(${toLuaStringLiteral(ms1String)})`, 'bridge-import-favs');
      return JSON.parse(raw);
    },
    exportFromFavorites(listName) {
      const raw = vm.runLua(`return _E2E_BRIDGE.exportFavorites(${toLuaStringLiteral(listName)})`, 'bridge-export-favs');
      return JSON.parse(raw);
    },
    runLua(code, name) {
      return vm.runLua(code, name);
    },
    close() {
      vm.close();
    },
  };
}

/**
 * Self-test suite for lua-bridge.mjs.
 */
export function runLuaBridgeSelfTest(options = {}) {
  // 1. Negative Lua 5.1 AST checks (reject goto, //, &, and bit32 global)
  assert.throws(() => validateLua51Source('goto done ::done::', 'bad-goto.lua'), SyntaxError);
  assert.throws(() => validateLua51Source('local x = 5 // 2', 'bad-idiv.lua'), SyntaxError);
  assert.throws(() => validateLua51Source('local x = 1 & 2', 'bad-bitand.lua'), SyntaxError);
  assert.throws(() => validateLua51Source('local x = 1 | 2', 'bad-bitor.lua'), SyntaxError);
  assert.throws(
    () => validateLua51Source('local x = bit32.bxor(1, 2)', 'bad-bit32.lua', { forbidBitLibs: true }),
    /forbidden global 'bit32'/
  );
  assert.throws(
    () => validateLua51Source('local x = bit.bxor(1, 2)', 'bad-bit.lua', { forbidBitLibs: true }),
    /forbidden global 'bit'/
  );

  // 2. Boot bridge (validates Favorites.lua & Notifications.lua in Lua 5.1 + ListCodec or fallback)
  const bridge = createAddonBridge(options);
  try {
    // Verify Favorites.lua & Notifications.lua actually loaded
    const favCheck = bridge.runLua('return type(MarketSync.Favorites and MarketSync.Favorites.CreateList)', 'check-fav');
    assert.equal(favCheck, 'function', 'Favorites.lua should register MarketSync.Favorites.CreateList');
    const notifCheck = bridge.runLua('return type(MarketSync.ToggleNotificationMute)', 'check-notif');
    assert.equal(notifCheck, 'function', 'Notifications.lua should register MarketSync.ToggleNotificationMute');

    // 3. JS -> Lua -> JS round-trip including 64-bit copper, suffix, uncached item, done, alert
    const sampleList = {
      v: 1,
      n: 'Forever Raid Prep',
      f: 'forever',
      r: 'pvp',
      fa: 'Alliance',
      i: [
        { id: 13464, s: 0, q: 20, m: 50000, nm: 'Dreamfoil', nt: 'For AQ40', d: 0, a: 1 },
        { id: 13005, s: 4512, q: 1, m: 99999999999, nm: 'Suffixed Cap Item', d: 1, a: 0 },
        { id: 999999, q: 3, m: 12000 }, // Uncached item where GetItemInfo returns nil
      ],
    };

    const jsEncoded = encodeMS1(sampleList);
    const luaDecoded = bridge.decodeList(jsEncoded);
    assert.equal(luaDecoded.ok, true, `Lua failed to decode JS !MS1!: ${luaDecoded.error}`);
    assert.equal(luaDecoded.list.n, sampleList.n);
    assert.equal(luaDecoded.list.i.length, 3);
    assert.equal(luaDecoded.list.i[1].m, 99999999999);
    assert.equal(luaDecoded.list.i[2].id, 999999);

    const luaEncoded = bridge.encodeList(sampleList);
    assert.ok(luaEncoded.startsWith('!MS1!'));
    const jsReDecoded = decodeMS1(luaEncoded);
    assert.equal(jsReDecoded.n, sampleList.n);
    assert.equal(jsReDecoded.i[0].id, 13464);
    assert.equal(jsReDecoded.i[1].m, 99999999999);

    // 4. Import into Favorites & mutate qty/done in Lua -> re-export -> decode in JS
    const imp = bridge.importToFavorites(jsEncoded);
    assert.equal(imp.ok, true, `importToFavorites failed: ${imp.error}`);
    bridge.runLua(`
      local F = MarketSync.Favorites
      if F and F.SetQuantity and F.SetItemMeta then
          F.SetQuantity("Forever Raid Prep", 13464, 40)
          F.SetItemMeta("Forever Raid Prep", 13464, { done = true })
      elseif MarketSyncDB.FavoriteMeta["Forever Raid Prep"] and MarketSyncDB.FavoriteMeta["Forever Raid Prep"].items and MarketSyncDB.FavoriteMeta["Forever Raid Prep"].items[13464] then
          MarketSyncDB.FavoriteQuantities["Forever Raid Prep"][13464] = 40
          MarketSyncDB.FavoriteMeta["Forever Raid Prep"].items[13464].done = true
      elseif MarketSyncDB.FavoriteMeta["Forever Raid Prep"] and MarketSyncDB.FavoriteMeta["Forever Raid Prep"]["13464"] then
          MarketSyncDB.FavoriteMeta["Forever Raid Prep"]["13464"].q = 40
          MarketSyncDB.FavoriteMeta["Forever Raid Prep"]["13464"].d = 1
      end
    `, 'mutate-fav');
    const reExport = bridge.exportFromFavorites('Forever Raid Prep');
    assert.equal(reExport.ok, true, `exportFromFavorites failed: ${reExport.error}`);
    const roundTripped = decodeMS1(reExport.encoded);
    const item = roundTripped.i.find((x) => x.id === 13464);
    assert.equal(item.q, 40);
    assert.equal(item.d, 1);

    // 5. Negative Lua decode checks (bad CRC32, bad prefix, bad base64url)
    const badCrc = jsEncoded.slice(0, -1) + (jsEncoded.endsWith('0') ? '1' : '0');
    assert.equal(bridge.decodeList(badCrc).ok, false, 'Lua must reject tampered CRC32');
    assert.equal(bridge.decodeList('NOTMS1!abc.00000000').ok, false, 'Lua must reject bad prefix');
    assert.equal(bridge.decodeList('!MS1!abc===.00000000').ok, false, 'Lua must reject base64 padding');

    return {
      ok: true,
      addonCodecPresent: bridge.addonCodecPresent,
      tocRegistersListCodec: bridge.tocRegistersListCodec,
      mode: bridge.addonCodecActive ? 'addon-listcodec' : 'harness-fallback',
    };
  } finally {
    bridge.close();
  }
}
