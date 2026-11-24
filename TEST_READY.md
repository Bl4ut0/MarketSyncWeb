# E2E Test Suite Ready

## Test Runner
- Command: `node e2e/src/runner.mjs --self-test` and `node e2e/src/runner.mjs --dry-run` (from `c:\Dev Projects\MarketSyncWeb`)
- Expected: `--self-test` passes `7 passed, 0 failed` (exit `0`); `--dry-run` reports `Total tests registered: 141` (`0` gaps, `Threshold check: PASS`, exit `0`); addon Lua 5.1 tests pass `11/11`.

### Live Execution Commands
From `c:\Dev Projects\MarketSyncWeb`:
```powershell
# Self-hosted Node server (all tiers)
node e2e/src/runner.mjs --mode selfhosted --tier all --base-url <node-url>

# Cloudflare Worker target (all tiers)
node e2e/src/runner.mjs --mode cloudflare --tier all --base-url <cf-url>

# Both deployment targets
node e2e/src/runner.mjs --mode both --tier all --base-url <node-url> --cf-url <cf-url>

# Addon-only Lua 5.1 !MS1! round-trip tests
node e2e/src/runner.mjs --mode selfhosted --base-url http://127.0.0.1:1 --filter T1-F8
node e2e/src/runner.mjs --mode selfhosted --base-url http://127.0.0.1:1 --filter T2-F8
node e2e/src/runner.mjs --mode selfhosted --base-url http://127.0.0.1:1 --filter T3-PAIR-08
```

## Coverage Summary
| Tier | Scope | Minimum | Registered | Status |
|---|---|---:|---:|---|
| Tier 1 | Feature Coverage (`F1`–`F12`, >= 5 per feature) | 60 | 60 | Ready |
| Tier 2 | Boundary & Corner Cases (`F1`–`F12`, >= 5 per feature) | 60 | 60 | Ready |
| Tier 3 | Pairwise Cross-Feature Combinations | 12 | 15 | Ready |
| Tier 4 | Real-World Application Scenarios (`S1`–`S6`) | 6 | 6 | Ready |
| **Total** | **All Tiers (1–4)** | **138** | **141** | **PASS** |

## Feature Checklist
| Feature | Description | T1 | T2 | T3 | T4 | Total | Status |
|---|---|---:|---:|---:|---:|---:|---|
| `F1` | Release Candidate / Era Switching & Official Branding (`forever`, `classicEra`, `anniversary`, `classic`, `retail`) | 5 | 5 | 2 | 0 | 12 | Covered |
| `F2` | Ruleset & Realm Selection (`pvp`/`normal`/`roleplay`/`roleplaypvp`, `p`/`n`/`r`, Anniversary realms, empty realms) | 5 | 5 | 2 | 0 | 12 | Covered |
| `F3` | Auction Browsing, Faction/Market Tabs & 9+ MB Snapshot Handling (`82800:*`, suffixes, 64-bit copper, `#id`) | 5 | 5 | 2 | 0 | 12 | Covered |
| `F4` | Search, Filtering, Sorting & Pagination | 5 | 5 | 1 | 0 | 11 | Covered |
| `F5` | Multi-Snapshot Price History Views & `index.json` Normalization | 5 | 5 | 1 | 1 | 12 | Covered |
| `F6` | Login-Free Shopping Lists & AH Tasks CRUD (browser persistence) | 5 | 5 | 1 | 0 | 11 | Covered |
| `F7` | Web `!MS1!` Import/Export UI (encode, decode, CRC32/malformed rejection) | 5 | 5 | 1 | 0 | 11 | Covered |
| `F8` | MarketSync Addon `!MS1!` Lua 5.1 Round-Trip (`ListCodec.lua` + `Favorites`/`Notifications` via `fengari`) | 5 | 5 | 1 | 1 | 12 | Covered (11/11 addon-only tests passing) |
| `F9` | Optional Battle.net OAuth 2.0 & Character Linking (realmless Forever `{name, surname}`, 24h expiry, CSRF state) | 5 | 5 | 1 | 1 | 12 | Covered |
| `F10` | Price-Change Alert Rules & Notification Triggers (On-Site Inbox + Email Adapter) | 5 | 5 | 1 | 1 | 12 | Covered |
| `F11` | Dual-Mode Hosting & Capability Discovery (Self-Hosted Node vs Zero-DB Cloudflare Worker `501`) | 5 | 5 | 1 | 1 | 12 | Covered |
| `F12` | Snapshot Ingestion Edge Cases & Error Resilience (`text/plain`, `simulated`, legacy root, 404/503/corrupt recovery) | 5 | 5 | 1 | 1 | 12 | Covered |
| **Total** | | **60** | **60** | **15** | **6** | **141** | **READY** |

## Suite Files (`e2e/src/suites/`)
- `e2e/src/suites/lib/helpers.mjs` — Shared opaque-box HTTP/`CookieJar`, Battle.net OAuth flow, Playwright `withAppPage`, modal/navigation helpers, semantic/testid selectors, and assertion helpers.
- `e2e/src/suites/tier1-feature-coverage.mjs` — 60 tests (`T1-F1-01`..`T1-F12-05`).
- `e2e/src/suites/tier2-boundary-cases.mjs` — 60 tests (`T2-F1-01`..`T2-F12-05`).
- `e2e/src/suites/tier3-pairwise-combinations.mjs` — 15 tests (`T3-PAIR-01`..`T3-PAIR-15`).
- `e2e/src/suites/tier4-real-world-scenarios.mjs` — 6 tests (`T4-S1`..`T4-S6`).
