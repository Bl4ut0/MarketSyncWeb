import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  FLAVORS,
  FLAVOR_IDS,
  DEFAULT_ITEM_ICON,
  getCachedWowheadTooltipMeta,
  getEraAuctionCategories,
  getItemIconUrl,
  getWowheadItemUrl,
  isFlavorId,
  parseDatasetIndex,
  resolveItemMetadata,
  type AlertRule,
  type Capabilities,
  type DatasetBlockMeta,
  type DatasetIndex,
  type FactionPartition,
  type FlavorId,
  type NotificationItem,
  type PriceHistoryPoint,
  type ShoppingList,
  type WowheadItemMatch,
} from '@marketsync/shared';
import { AlertsPanel } from './components/AlertsPanel.js';
import { CopperDisplay } from './components/CopperDisplay.js';
import { CraftProfitPanel } from './components/CraftProfitPanel.js';
import { MoneyMakersPanel } from './components/MoneyMakersPanel.js';
import { ItemBadge } from './components/ItemBadge.js';
import { ItemDetailModal } from './components/ItemDetailModal.js';
import { HarborPanel, harborUrl } from './components/HarborPanel.js';
import { MarketAnalyticsPanel } from './components/MarketAnalyticsPanel.js';
import { MobileApp, type MobileAppProps } from './components/MobileApp.js';
import { ShoppingListsPanel } from './components/ShoppingListsPanel.js';
import {
  createAlertRule,
  DEFAULT_CAPABILITIES,
  deleteAlertRule,
  evaluateNotificationsNow,
  fetchAlerts,
  fetchAuthMe,
  fetchCapabilities,
  fetchDatasetIndexRaw,
  fetchItemMatches,
  fetchNotifications,
  logoutAuth,
  markNotificationRead,
  syncCloudList,
  toggleAlertRule,
  updateNotificationSettings,
  type AuthMeResponse,
} from './lib/api.js';
import {
  createDefaultList,
  loadActiveListId,
  loadShoppingLists,
  saveActiveListId,
  saveShoppingLists,
  upsertItemInList,
  type StoredShoppingList,
} from './lib/shoppingListStore.js';
import {
  snapshotClient,
  type EnrichedAuctionRow,
  type MarketAnalyticsPayload,
  type SnapshotSummary,
  type SortDir,
  type SortField,
} from './lib/snapshotClient.js';
import { selectHistoryBlocks, type HistoryHours } from './lib/priceHistory.js';
import { blockPathForRoute, buildDeepLink, parseDeepLink } from './lib/deepLink.js';
import {
  HOME_FACTIONS, hasFactionMarkets, initialHomeFaction, marketChoices, partitionSelectorLabel, resolveMarket,
  saveHomeFaction, type HomeFaction,
} from './lib/marketSelection.js';
import type { ItemAnalyticsDetails } from './lib/marketAnalytics.js';
import { getCachedAnalytics, loadPreparedAnalytics } from './lib/preparedAnalytics.js';
import { ERA_THEMES } from './themes/themes.js';

type MainViewTab = 'ah' | 'analytics' | 'craft' | 'lists' | 'alerts' | 'explore';

const PAGE_SIZE = 50;
const NO_ITEM_MATCHES: WowheadItemMatch[] = [];
const captureDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const checkedDate = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const harborAuction = document.body.hasAttribute('data-harbor-auction');
const exploreOrigin = 'https://explore.bl4ut0.dev';
const CURSEFORGE_ADDON_URL = 'https://www.curseforge.com/wow/addons/marketsync';
const ANALYTICS_WINDOW_LABELS: Record<number, string> = { 24: '24-hour', 168: '7-day', 720: '30-day' };
// In-game PvP crest icons, served from the same icon CDN as item icons.
const FACTION_CREST_ICONS: Record<HomeFaction, string> = {
  Alliance: 'achievement_pvp_a_a',
  Horde: 'achievement_pvp_h_h',
};
const mobileLayoutQuery = '(hover: none) and (pointer: coarse)';
const mobileSortOptions = {
  price_asc: ['minPrice', 'asc'],
  high_desc: ['maxPrice', 'desc'],
  qty_desc: ['totalQty', 'desc'],
  name_asc: ['name', 'asc'],
} satisfies Record<Parameters<MobileAppProps['onSortChange']>[0], [SortField, SortDir]>;

// Read once at load: a deep link such as /item/forever/pvp/alliance/13464/2026-11-25/17
// sets the flavor, ruleset, faction, view, snapshot hour and item before data arrives.
const initialRoute = typeof window === 'undefined' ? null : parseDeepLink(window.location.pathname);

export function App() {
  const [activeTab, setActiveTab] = useState<MainViewTab>(
    () => (initialRoute?.action === 'analytics' ? 'analytics' : 'ah'),
  );
  const [mapOpened, setMapOpened] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia(mobileLayoutQuery).matches);
  const [mobileTab, setMobileTab] = useState<MobileAppProps['activeTab']>('market');
  const mobileRealmPicker = useRef<HTMLDialogElement>(null);
  const [flavor, setFlavor] = useState<FlavorId>(() => {
    if (initialRoute) return initialRoute.flavor;
    const edition = new URLSearchParams(window.location.search).get('flavor');
    return isFlavorId(edition) ? edition : 'forever';
  });
  const headerRef = useRef<HTMLElement>(null);

  const [capabilities, setCapabilities] = useState<Capabilities>(
    DEFAULT_CAPABILITIES,
  );
  const [auth, setAuth] = useState<AuthMeResponse>({ authenticated: false });

  // Dataset index & snapshot state
  const [datasetIndex, setDatasetIndex] = useState<DatasetIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [archivePath, setArchivePath] = useState(() => (initialRoute ? blockPathForRoute(initialRoute) ?? '' : ''));
  const [refreshingIndex, setRefreshingIndex] = useState(false);
  const [indexCheckedAt, setIndexCheckedAt] = useState<number>();
  const indexRequest = useRef(0);
  const [loadedSnapshot, setSnapshotSummary] =
    useState<SnapshotSummary | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState<boolean>(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Market selectors & filters
  const [partitionKey, setPartitionKey] = useState<string>(() => initialRoute?.ruleset ?? 'pvp');
  // The player's own faction (remembered) and the market being browsed, which
  // is that faction's AH or a shared market such as Neutral.
  const [homeFaction, setHomeFaction] = useState<HomeFaction>(() => initialHomeFaction(initialRoute?.faction));
  const [faction, setFaction] = useState<FactionPartition>(() => initialRoute?.faction ?? homeFaction);
  // Item named in a deep link, opened once its rows are ready.
  const pendingItemKey = useRef<string | undefined>(initialRoute?.itemKey);
  const [itemRestored, setItemRestored] = useState(!initialRoute?.itemKey);
  const [search, setSearch] = useState<string>('');
  const [exactMatch, setExactMatch] = useState<boolean>(false);
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [ahCategory, setAhCategory] = useState<string>('all');
  const [ahSubcategory, setAhSubcategory] = useState<string>('all');
  const [minLevel, setMinLevel] = useState<string>('');
  const [maxLevel, setMaxLevel] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortField>('minPrice');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState<number>(1);
  const [hydrateVersion, setHydrateVersion] = useState<number>(0);
  const [nameLookup, setNameLookup] = useState<{
    flavor: FlavorId;
    name: string;
    results: WowheadItemMatch[];
    failed?: boolean;
  } | null>(null);

  // Queried rows from Web Worker
  const [rows, setRows] = useState<EnrichedAuctionRow[]>([]);
  const [rowsReadyPath, setRowsReadyPath] = useState<string>('');
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>(
    {},
  );
  const [mobileCategoriesOpen, setMobileCategoriesOpen] = useState(false);

  // Item detail & price history modal
  const [inspected, setInspected] = useState<{
    item: EnrichedAuctionRow;
    capture: DatasetBlockMeta;
    headerBottom: number;
    comparison?: ItemAnalyticsDetails;
    parentItem?: EnrichedAuctionRow;
  } | null>(
    null,
  );
  const [historyPoints, setHistoryPoints] = useState<PriceHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyHours, setHistoryHours] = useState<HistoryHours>(24);
  const [historyFailures, setHistoryFailures] = useState(0);
  const selectedItem = inspected?.item ?? null;
  const closeItem = useCallback(() => setInspected(null), []);

  useEffect(() => {
    const media = window.matchMedia(mobileLayoutQuery);
    const updateLayout = () => {
      setMobileLayout(media.matches);
      if (media.matches) {
        setMapOpened(false);
        setActiveTab((tab) => tab === 'explore' ? 'ah' : tab);
      }
    };
    media.addEventListener('change', updateLayout);
    return () => media.removeEventListener('change', updateLayout);
  }, []);

  // Shopping lists (login-free, browser-persisted)
  const [lists, setLists] = useState<StoredShoppingList[]>(() =>
    loadShoppingLists(),
  );
  const [activeListId, setActiveListId] = useState<string>(() =>
    loadActiveListId(loadShoppingLists()),
  );

  // Alerts & Notifications (when persistence + OAuth active)
  const [notificationEmail, setNotificationEmail] = useState<string>('');
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [alertsStatus, setAlertsStatus] = useState<string | null>(null);

  const flavorConfig = FLAVORS[flavor];
  const themeMeta = ERA_THEMES[flavor];
  const eraCategories = useMemo(
    () => getEraAuctionCategories(flavor),
    [flavor],
  );

  const loadIndex = useCallback(async () => {
    const request = ++indexRequest.current;
    setRefreshingIndex(true);
    setIndexError(null);
    const res = await fetchDatasetIndexRaw();
    if (request !== indexRequest.current) return;
    setIndexCheckedAt(Date.now());
    setRefreshingIndex(false);
    if (!res.ok || !res.data) {
      setIndexError(res.error ?? 'Failed to load dataset index');
      return;
    }
    try {
      const parsed = parseDatasetIndex(res.data, { includeSimulated: true });
      setDatasetIndex(parsed);
    } catch (err) {
      setIndexError(
        err instanceof Error ? err.message : 'Invalid dataset index format',
      );
    }
  }, []);

  const refreshAccountData = useCallback(async (caps: Capabilities) => {
    if (!caps.oauth && !caps.persistence) {
      setAuth({ authenticated: false });
      return;
    }
    const me = await fetchAuthMe();
    setAuth(me);
    const initialEmail =
      me.notificationEmail ?? me.user?.notificationEmail ?? me.user?.email ?? '';
    if (initialEmail) {
      setNotificationEmail(initialEmail);
    }
    if (me.authenticated && caps.persistence) {
      const [alertsRes, notifRes] = await Promise.all([
        fetchAlerts(),
        fetchNotifications(),
      ]);
      if (alertsRes.ok && alertsRes.data) setAlerts(alertsRes.data);
      if (notifRes.ok && notifRes.data) setNotifications(notifRes.data);
    }
  }, []);

  // Initial mount: capabilities + auth + dataset index
  useEffect(() => {
    if (harborAuction) {
      void loadIndex();
      return;
    }
    let active = true;
    void (async () => {
      const [caps] = await Promise.all([fetchCapabilities(), loadIndex()]);
      if (!active) return;
      setCapabilities(caps);
      await refreshAccountData(caps);
    })();
  return () => {
      active = false;
    };
  }, [loadIndex, refreshAccountData]);

  useEffect(() => {
    if (!harborAuction || window.parent === window || selectedItem) return;
    const closeAuction = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const targetOrigin = document.referrer.startsWith(`${exploreOrigin}/`) ? exploreOrigin : window.location.origin;
      window.parent.postMessage({ type: 'marketsync:close-auction' }, targetOrigin);
    };
    window.addEventListener('keydown', closeAuction);

  return () => window.removeEventListener('keydown', closeAuction);
  }, [selectedItem]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadIndex();
    }, 5 * 60 * 1000);

  return () => window.clearInterval(timer);
  }, [loadIndex]);

  // Blocks for current flavor
  const flavorBlocks: DatasetBlockMeta[] = useMemo(() => {
    if (!datasetIndex) return [];
    return datasetIndex.blocks.filter((b) => b.flavor === flavor);
  }, [datasetIndex, flavor]);

  const archivedBlock = archivePath ? flavorBlocks.find((b) => b.path === archivePath) : undefined;
  const activeBlockMeta = archivedBlock ?? datasetIndex?.latestLiveByFlavor[flavor] ??
    datasetIndex?.latestByFlavor[flavor];
  const selectedBlockPath = activeBlockMeta?.path ?? '';
  const snapshotSummary = loadedSnapshot?.path === selectedBlockPath ? loadedSnapshot : null;
  const isAnalyticsVisible =
    (!mobileLayout && activeTab === 'analytics') || (mobileLayout && mobileTab === 'analytics');
  const isCraftVisible = mobileLayout && !harborAuction ? mobileTab === 'craft' : activeTab === 'craft';
  const shouldLoadSnapshot = !isAnalyticsVisible || !activeBlockMeta?.analytics;
  const marketLoading = snapshotLoading || (!datasetIndex && refreshingIndex) ||
    Boolean(selectedBlockPath && !snapshotSummary && !snapshotError);

  // Load selected snapshot off-thread in Web Worker
  useEffect(() => {
    if (!shouldLoadSnapshot) return;
    if (!selectedBlockPath) {
      setSnapshotSummary(null);
      setRows([]);
      setRowsReadyPath('');
      setTotalCount(0);
      setTotalPages(1);
      setCategoryCounts({});
      setSnapshotLoading(false);
      setSnapshotError(null);
      return;
    }

    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);
    setRows([]);
    setRowsReadyPath('');

    void snapshotClient
      .loadSnapshot(selectedBlockPath, flavor)
      .then((summary) => {
        if (cancelled) return;
        setSnapshotSummary(summary);
        setSnapshotLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshotSummary(null);
        setSnapshotLoading(false);
        setSnapshotError(
          err instanceof Error ? err.message : 'Failed to load snapshot',
        );
      });


  return () => {
      cancelled = true;
    };
  }, [selectedBlockPath, flavor, shouldLoadSnapshot]);

  const selectedPartitions = isAnalyticsVisible && activeBlockMeta?.analytics
    ? activeBlockMeta.analytics.partitions
    : snapshotSummary?.partitions;

  // Available partitions (merge knownPartitions + snapshot partitions)
  const partitionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sp of selectedPartitions ?? []) {
      counts.set(sp.key, sp.entryCount ?? 0);
    }
    const map = new Map<string, { key: string; label: string; entryCount: number }>();
    for (const kp of flavorConfig.knownPartitions) {
      map.set(kp.slug, {
        key: kp.slug,
        label: kp.label,
        entryCount: counts.get(kp.slug) ?? 0,
      });
    }
    for (const sp of selectedPartitions ?? []) {
      if (!map.has(sp.key)) {
        map.set(sp.key, {
          key: sp.key,
          label: sp.label,
          entryCount: sp.entryCount ?? 0,
        });
      }
    }
    return Array.from(map.values());
  }, [flavorConfig, selectedPartitions]);

  // Keep partitionKey valid for the active flavor
  useEffect(() => {
    if (partitionOptions.length === 0) return;
    if (!partitionOptions.some((p) => p.key === partitionKey)) {
      const nonEmpty = selectedPartitions?.find(
        (p) => p.entryCount > 0,
      );
      setPartitionKey(nonEmpty?.key ?? partitionOptions[0]!.key);
      setPage(1);
    }
  }, [partitionOptions, partitionKey, selectedPartitions]);

  const activePartitionLabel = useMemo(() => {

  return (
      partitionOptions.find((p) => p.key === partitionKey)?.label ?? partitionKey
    );
  }, [partitionOptions, partitionKey]);

  // Available markets/factions (merge defaultFactions + partition factions)
  const marketOptions: FactionPartition[] = useMemo(() => {
    const set = new Set<FactionPartition>(flavorConfig.defaultFactions);
    const sp = selectedPartitions?.find((p) => p.key === partitionKey);
    if (sp) {
      for (const f of sp.factions) {
        set.add(f);
      }
    }
    return Array.from(set);
  }, [flavorConfig, selectedPartitions, partitionKey]);

  const marketChoiceList = useMemo(
    () => marketChoices(marketOptions, homeFaction),
    [marketOptions, homeFaction],
  );
  const factionMarketsAvailable = hasFactionMarkets(marketOptions);
  const partitionLabel = partitionSelectorLabel(flavorConfig.partitionType);

  // Keep the market valid for the active faction, flavor and partition
  useEffect(() => {
    if (marketOptions.length === 0) return;
    const next = resolveMarket(marketOptions, homeFaction, faction) ?? marketOptions[0]!;
    if (next !== faction) {
      setFaction(next);
      setPage(1);
    }
  }, [marketOptions, homeFaction, faction]);

  const lookupName = search.trim().replace(/^["“]|["”]$/g, '').trim().toLowerCase();
  const shouldLookupName = lookupName.length >= 2 && lookupName.length <= 100 &&
    !/^#?\d+(?::|-)?\d*$/.test(lookupName);
  const currentLookup = nameLookup?.name === lookupName && nameLookup.flavor === flavor ? nameLookup : null;
  const matchingItems = currentLookup?.results ?? NO_ITEM_MATCHES;
  const nameLookupPending = shouldLookupName && !currentLookup;

  useEffect(() => {
    if (!shouldLookupName) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchItemMatches(lookupName, flavor, controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setNameLookup({ flavor, name: lookupName, results });
        if (results.length > 0) {
          void snapshotClient.hydrateWowheadItems(results.slice(0, 12).map((item) => item.id), flavor)
            .then((hydrated) => {
              if (!controller.signal.aborted && Object.keys(hydrated).length > 0) {
                setHydrateVersion((version) => version + 1);
              }
            }).catch(() => undefined);
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setNameLookup({ flavor, name: lookupName, results: NO_ITEM_MATCHES, failed: true });
        }
      });
    }, 250);

  return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [flavor, lookupName, shouldLookupName]);

  // Query paginated entries from Web Worker
  useEffect(() => {
    if (isAnalyticsVisible || isCraftVisible || !snapshotSummary || snapshotSummary.path !== selectedBlockPath) {
      return;
    }
    let cancelled = false;
    const minLvlNum = minLevel.trim() ? Number(minLevel.trim()) : undefined;
    const maxLvlNum = maxLevel.trim() ? Number(maxLevel.trim()) : undefined;
    void snapshotClient
      .queryEntries({
        path: selectedBlockPath,
        flavor,
        partitionKey,
        faction,
        search,
        matchingItems,
        exactMatch,
        quality: qualityFilter,
        ahCategory,
        ahSubcategory,
        ...(minLvlNum && Number.isFinite(minLvlNum) ? { minLevel: minLvlNum } : {}),
        ...(maxLvlNum && Number.isFinite(maxLvlNum) ? { maxLevel: maxLvlNum } : {}),
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setRowsReadyPath(selectedBlockPath);
        setTotalCount(res.totalCount);
        setTotalPages(res.totalPages);
        setCategoryCounts(res.categoryCounts);
        if (res.page !== page) {
          setPage(res.page);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setRowsReadyPath(selectedBlockPath);
        setTotalCount(0);
        setTotalPages(1);
        setCategoryCounts({});
      });

  return () => {
      cancelled = true;
    };
  }, [
    isAnalyticsVisible,
    isCraftVisible,
    snapshotSummary,
    selectedBlockPath,
    flavor,
    partitionKey,
    faction,
    search,
    matchingItems,
    exactMatch,
    qualityFilter,
    ahCategory,
    ahSubcategory,
    minLevel,
    maxLevel,
    sortBy,
    sortDir,
    page,
    hydrateVersion,
  ]);

  // Progressive Wowhead Tooltip & Icon Hydration for visible uncached items
  useEffect(() => {
    if (rows.length === 0 || rowsReadyPath !== selectedBlockPath || ahCategory === 'unclassified') return;
    const fallbackIds = Array.from(
      new Set(
        rows
          .filter((r) => r.icon === DEFAULT_ITEM_ICON && !r.isPetCage && r.itemId > 0 &&
            !r.tooltipHtml && !getCachedWowheadTooltipMeta(r.itemId, flavor))
          .map((r) => r.itemId),
      ),
    );
    if (fallbackIds.length === 0) return;

    let cancelled = false;
    void snapshotClient
      .hydrateWowheadItems(fallbackIds, flavor)
      .then((hydrated) => {
        if (cancelled) return;
        if (Object.keys(hydrated).length > 0) {
          setHydrateVersion((v) => v + 1);
        }
      })
      .catch(() => {
        // Ignore background hydration errors
      });


  return () => {
      cancelled = true;
    };
  }, [rows, flavor, rowsReadyPath, selectedBlockPath, ahCategory]);

  useEffect(() => {
    if (!inspected) return;
    const controller = new AbortController();
    setHistoryPoints([]);
    setHistoryFailures(0);
    setHistoryLoading(true);
    const blocksForHistory = selectHistoryBlocks(flavorBlocks, inspected.capture, historyHours).map((b) => ({
      path: b.path,
      flavor: b.flavor,
    }));
    void snapshotClient
      .getItemHistory({
        blocks: blocksForHistory,
        partitionKey,
        faction,
        itemKey: inspected.item.itemKey,
        groupedItemId: inspected.item.variants ? inspected.item.itemId : undefined,
      }, controller.signal)
      .then(({ points, failedBlocks }) => {
        if (controller.signal.aborted) return;
        setHistoryPoints(points);
        setHistoryFailures(failedBlocks);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHistoryFailures(blocksForHistory.length);
        setHistoryLoading(false);
      });


  return () => controller.abort();
  }, [inspected, flavorBlocks, partitionKey, faction, historyHours]);

  const [analyticsHours, setAnalyticsHours] = useState<HistoryHours>(24);
  const [analyticsCategory, setAnalyticsCategory] = useState<string>('all');
  const [loadedAnalytics, setLoadedAnalytics] =
    useState<{ key: string; payload: MarketAnalyticsPayload } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const analyticsKey = JSON.stringify([
    selectedBlockPath, activeBlockMeta?.timestamp, activeBlockMeta?.analytics?.revision,
    partitionKey, faction, analyticsHours, analyticsCategory,
  ]);
  const marketAnalytics = useMemo(() => {
    if (loadedAnalytics?.key === analyticsKey) return loadedAnalytics.payload;
    return activeBlockMeta
      ? getCachedAnalytics(activeBlockMeta, partitionKey, faction, analyticsHours, analyticsCategory)
      : null;
  }, [loadedAnalytics, analyticsKey, activeBlockMeta, partitionKey, faction, analyticsHours, analyticsCategory]);

  useEffect(() => {
    setAnalyticsCategory('all');
  }, [flavor]);

  useEffect(() => {
    if (!isAnalyticsVisible || !activeBlockMeta || !selectedBlockPath) {
      return;
    }
    const controller = new AbortController();
    setAnalyticsLoading(true);
    setAnalyticsError(null);

    void loadPreparedAnalytics(activeBlockMeta, partitionKey, faction, analyticsHours,
      analyticsCategory, controller.signal)
      .then((prepared) => {
        if (prepared) return prepared;
        controller.signal.throwIfAborted();
        const blocks = selectHistoryBlocks(flavorBlocks, activeBlockMeta, analyticsHours);
        return snapshotClient.computeMarketAnalytics({
          currentPath: selectedBlockPath,
          flavor,
          blocks,
          partitionKey,
          faction,
          ahCategory: analyticsCategory,
        }, controller.signal);
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        setLoadedAnalytics({ key: analyticsKey, payload: res });
        setAnalyticsLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setAnalyticsError(
          err instanceof Error ? err.message : 'Analytics computation failed.',
        );
        setAnalyticsLoading(false);
      });

    return () => controller.abort();
  }, [
    isAnalyticsVisible,
    activeBlockMeta,
    selectedBlockPath,
    flavorBlocks,
    flavor,
    partitionKey,
    faction,
    analyticsHours,
    analyticsCategory,
    analyticsKey,
  ]);

  // Shopping list persistence handlers
  const updateListsState = (
    updater: (prev: StoredShoppingList[]) => StoredShoppingList[],
    nextActiveId?: string,
  ) => {
    setLists((prev) => {
      const next = updater(prev);
      saveShoppingLists(next);
      if (nextActiveId !== undefined) {
        setActiveListId(nextActiveId);
        saveActiveListId(nextActiveId);
      } else if (!next.some((l) => l.id === activeListId)) {
        const fallbackId = next[0]?.id ?? '';
        setActiveListId(fallbackId);
        saveActiveListId(fallbackId);
      }
      return next;
    });
  };

  const handleSelectList = (id: string) => {
    setActiveListId(id);
    saveActiveListId(id);
  };

  const handleCreateList = (name: string) => {
    const created = createDefaultList(name);
    created.list.f = flavor;
    created.list.r = partitionKey;
    created.list.fa = faction;
    updateListsState((prev) => [...prev, created], created.id);
  };

  const handleDeleteList = (id: string) => {
    updateListsState((prev) => {
      const filtered = prev.filter((l) => l.id !== id);
      if (filtered.length === 0) {
        return [createDefaultList('My Shopping List')];
      }
      return filtered;
    });
  };

  const handleUpdateList = (id: string, nextList: ShoppingList) => {
    updateListsState((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, list: nextList, updatedAt: new Date().toISOString() }
          : l,
      ),
    );
  };

  const handleImportList = (decoded: ShoppingList) => {
    const imported: StoredShoppingList = {
      id: createDefaultList(decoded.n).id,
      list: decoded,
      updatedAt: new Date().toISOString(),
    };
    updateListsState((prev) => [...prev, imported], imported.id);
  };

  const handleAddToShoppingList = (
    item: EnrichedAuctionRow,
    qty: number,
    maxPriceCopper?: number,
  ) => {
    updateListsState((prev) => {
      const targetList =
        prev.find((l) => l.id === activeListId) ?? prev[0] ?? createDefaultList();
      const exists = prev.some((l) => l.id === targetList.id);
      const updated = upsertItemInList(targetList.list, {
        id: item.itemId,
        ...(item.suffixId > 0 ? { s: item.suffixId } : {}),
        q: Math.max(1, qty),
        ...(maxPriceCopper && maxPriceCopper > 0 ? { m: maxPriceCopper } : {}),
        nm: item.name,
      });
      if (!exists) {
        return [
          ...prev,
          { ...targetList, list: updated, updatedAt: new Date().toISOString() },
        ];
      }
      return prev.map((l) =>
        l.id === targetList.id
          ? { ...l, list: updated, updatedAt: new Date().toISOString() }
          : l,
      );
    });
  };

  // Account / Alerts handlers
  const handleLogout = async () => {
    await logoutAuth();
    setAuth({ authenticated: false });
    setAlerts([]);
    setNotifications([]);
  };

  const handleSaveEmail = async (email: string) => {
    const res = await updateNotificationSettings(email, true);
    if (res.ok) {
      setNotificationEmail(email);
      setAlertsStatus('Notification email updated.');
    } else {
      setAlertsStatus(res.error ?? 'Failed to update notification settings.');
    }
  };

  const handleCreateAlert = async (payload: {
    flavor: FlavorId;
    partitionKey: string;
    faction: FactionPartition;
    itemKey: string;
    maxPriceCopper: number;
    emailEnabled: boolean;
  }) => {
    const res = await createAlertRule(payload);
    if (res.ok) {
      setAlertsStatus(
        `Created price alert for ${resolveItemMetadata(payload.itemKey, payload.flavor).name}.`,
      );
      const refreshed = await fetchAlerts();
      if (refreshed.ok && refreshed.data) setAlerts(refreshed.data);
    } else {
      setAlertsStatus(res.error ?? 'Failed to create alert.');
    }
  };

  const handleToggleAlert = async (id: string, enabled: boolean) => {
    const res = await toggleAlertRule(id, enabled);
    if (res.ok) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled } : a)),
      );
    }
  };

  const handleDeleteAlert = async (id: string) => {
    const res = await deleteAlertRule(id);
    if (res.ok) {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const handleMarkRead = async (id: string) => {
    const res = await markNotificationRead(id);
    if (res.ok) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    }
  };

  const handleEvaluateNow = async () => {
    setAlertsStatus('Evaluating snapshots against alert rules…');
    const res = await evaluateNotificationsNow();
    if (res.ok) {
      const notifRes = await fetchNotifications();
      if (notifRes.ok && notifRes.data) setNotifications(notifRes.data);
      setAlertsStatus('Alert evaluation complete.');
    } else {
      setAlertsStatus(res.error ?? 'Evaluation failed.');
    }
  };

  const handleQuickAlert = async (
    item: EnrichedAuctionRow,
    maxPriceCopper: number,
  ) => {
    await handleCreateAlert({
      flavor,
      partitionKey,
      faction,
      itemKey: item.itemKey,
      maxPriceCopper,
      emailEnabled: true,
    });
    setActiveTab('alerts');
    closeItem();
  };

  const isSimulated = Boolean(
    activeBlockMeta?.simulated || snapshotSummary?.simulated,
  );
  const marketCapture = snapshotSummary?.partitions.find((partition) => partition.key === partitionKey)?.marketStates?.[faction];
  const marketEmptyMessage = marketCapture?.status === 'unavailable'
    ? 'The Blizzard request for this market failed during this capture.'
    : marketCapture?.status === 'empty'
      ? 'Blizzard returned zero listings for this market.'
      : 'The published capture contains no auction records for this market.';
  const activeListItemCount =
    lists.find((l) => l.id === activeListId)?.list.i.length ?? 0;
  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const toggleColumnSort = (field: SortField, defaultDir: SortDir = 'asc') => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(defaultDir);
    }
    setPage(1);
  };

  const resetAhFilters = () => {
    setSearch('');
    setExactMatch(false);
    setQualityFilter('all');
    setAhCategory('all');
    setAhSubcategory('all');
    setMinLevel('');
    setMaxLevel('');
    setPage(1);
  };

  const hasActiveFilters =
    search.trim() !== '' ||
    exactMatch ||
    qualityFilter !== 'all' ||
    ahCategory !== 'all' ||
    ahSubcategory !== 'all' ||
    minLevel.trim() !== '' ||
    maxLevel.trim() !== '';

  const clearItemHistory = () => {
    setHistoryPoints([]);
    setHistoryFailures(0);
    setHistoryLoading(true);
  };

  const openItem = (item: EnrichedAuctionRow, comparison?: ItemAnalyticsDetails) => {
    if (!activeBlockMeta || (!isAnalyticsVisible && rowsReadyPath !== selectedBlockPath)) return;
    setHistoryHours(comparison?.hours ?? 24);
    clearItemHistory();
    setInspected({
      item,
      capture: activeBlockMeta,
      headerBottom: Math.max(0, headerRef.current?.getBoundingClientRect().bottom ?? 0),
      comparison,
    });
  };

  // Deep link: date without an hour picks that day's latest snapshot.
  const dateRestored = useRef(!initialRoute?.date || Boolean(initialRoute.hour));
  useEffect(() => {
    if (dateRestored.current || !initialRoute?.date || flavorBlocks.length === 0) return;
    dateRestored.current = true;
    const day = flavorBlocks
      .filter((block) => block.date === initialRoute.date)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (day) setArchivePath(day.path);
  }, [flavorBlocks]);

  // Deep link: open the named item once its rows are loaded for the linked snapshot.
  useEffect(() => {
    if (itemRestored || !pendingItemKey.current) return;
    if (rowsReadyPath !== selectedBlockPath || rows.length === 0) return;
    const row = rows.find((candidate) => candidate.itemKey === pendingItemKey.current);
    pendingItemKey.current = undefined;
    setItemRestored(true);
    if (row) openItem(row);
  }, [itemRestored, rows, rowsReadyPath, selectedBlockPath]);

  // Keep the address bar in sync so the current view can be shared as a link.
  useEffect(() => {
    if (!itemRestored || !activeBlockMeta) return;
    const route = {
      action: (inspected ? 'item' : activeTab === 'analytics' ? 'analytics' : 'ah') as 'ah' | 'analytics' | 'item',
      flavor,
      ruleset: partitionKey,
      faction,
      itemKey: inspected?.item.itemKey,
      date: activeBlockMeta.date,
      hour: activeBlockMeta.hour,
    };
    if (route.action === 'item' && !route.itemKey) return;
    const link = buildDeepLink(route);
    if (window.location.pathname !== link) window.history.replaceState(null, '', link + window.location.search);
  }, [itemRestored, activeBlockMeta, activeTab, flavor, partitionKey, faction, inspected]);

  const viewVariant = (variant: EnrichedAuctionRow) => {
    if (!inspected) return;
    clearItemHistory();
    setInspected({ ...inspected, item: variant, parentItem: inspected.item });
  };

  const viewParentItem = () => {
    if (!inspected?.parentItem) return;
    clearItemHistory();
    setInspected({ ...inspected, item: inspected.parentItem, parentItem: undefined });
  };

  const clickItemLink = (event: MouseEvent<HTMLAnchorElement>, item: EnrichedAuctionRow) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openItem(item);
  };

  const selectFlavor = (nextFlavor: FlavorId) => {
    if (nextFlavor === flavor) return;
    setFlavor(nextFlavor);
    setArchivePath('');
    resetAhFilters();
    closeItem();
  };

  const shoppingPanel = (
    <ShoppingListsPanel
      lists={lists}
      activeListId={activeListId}
      activeFlavor={flavor}
      activePartition={partitionKey}
      activeFaction={faction}
      canCloudSync={Boolean(
        capabilities.persistence && auth.authenticated,
      )}
      onSelectList={handleSelectList}
      onCreateList={handleCreateList}
      onDeleteList={handleDeleteList}
      onUpdateList={handleUpdateList}
      onImportList={handleImportList}
      onSyncListToCloud={async (stored) => {
        return syncCloudList({
          name: stored.list.n,
          list: stored.list,
        });
      }}
    />
  );

  const alertsPanel = (
    <AlertsPanel
      capabilities={capabilities}
      auth={auth}
      activeFlavor={flavor}
      activePartition={partitionKey}
      activeFaction={faction}
      notificationEmail={notificationEmail}
      alerts={alerts}
      notifications={notifications}
      statusMessage={alertsStatus}
      onSaveEmail={handleSaveEmail}
      onCreateAlert={handleCreateAlert}
      onToggleAlert={handleToggleAlert}
      onDeleteAlert={handleDeleteAlert}
      onMarkRead={handleMarkRead}
      onEvaluateNow={handleEvaluateNow}
    />
  );

  const itemDetails = (
    <ItemDetailModal
      item={selectedItem}
      flavor={flavor}
      partitionKey={partitionKey}
      partitionLabel={activePartitionLabel}
      faction={faction}
      historyPoints={historyPoints}
      historyLoading={historyLoading}
      historyFailures={historyFailures}
      historyHours={historyHours}
      onHistoryHoursChange={setHistoryHours}
      captureTimestamp={inspected?.capture.timestamp}
      headerBottom={inspected?.headerBottom}
      onClose={closeItem}
      mobile={mobileLayout && !harborAuction}
      returnLabel={inspected?.comparison?.source === 'block' ? 'Back to block map' : isAnalyticsVisible ? 'Back to analytics' : 'Back to auctions'}
      comparison={inspected?.parentItem ? undefined : inspected?.comparison}
      onViewVariant={viewVariant}
      onViewParent={inspected?.parentItem ? viewParentItem : undefined}
      onAddToShoppingList={harborAuction ? undefined : handleAddToShoppingList}
      showAnalyticsTitle={harborAuction}
      canCreateAlert={Boolean(capabilities.persistence && auth.authenticated)}
      onQuickAlert={handleQuickAlert}
    />
  );
  const craftPanel = <CraftProfitPanel flavor={flavor} path={selectedBlockPath} partitionKey={partitionKey} faction={faction} />;

  const toggleExplore = () => {
    closeItem();
    if (activeTab === 'explore') {
      setActiveTab('ah');
      return;
    }
    setMapOpened(true);
    setActiveTab('explore');
  };

  const choosePartition = (next: string) => {
    if (next === partitionKey) return;
    setPartitionKey(next);
    setRowsReadyPath('');
    setPage(1);
  };

  const chooseMarket = (next: FactionPartition) => {
    if (next === faction) return;
    setFaction(next);
    setRowsReadyPath('');
    setPage(1);
  };

  // The faction switch selects that faction's own AH; Neutral stays one tap away.
  const chooseHomeFaction = (next: HomeFaction) => {
    saveHomeFaction(next);
    setHomeFaction(next);
    chooseMarket(resolveMarket(marketOptions, next, next) ?? faction);
  };

  // With no prefix (the auction browser) the faction buttons keep the
  // market-tab-<Faction> test ids the e2e suite selects markets with.
  const factionSwitch = (idPrefix: string) => (
    <div
      className="ms-faction-switch"
      role="group"
      aria-label="Your faction"
      title={factionMarketsAvailable ? undefined : 'This market is shared by both factions'}
    >
      {HOME_FACTIONS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={homeFaction === f}
          aria-label={f}
          title={factionMarketsAvailable ? f : `${f} (this market is shared by both factions)`}
          disabled={!factionMarketsAvailable}
          data-testid={idPrefix ? `${idPrefix}faction-${f}` : `market-tab-${f}`}
          className={`ms-faction-btn is-${f.toLowerCase()} ${homeFaction === f ? 'is-active' : ''}`}
          onClick={() => chooseHomeFaction(f)}
        >
          <img
            className="ms-faction-crest"
            src={getItemIconUrl(FACTION_CREST_ICONS[f], 'large')}
            alt=""
            width={40}
            height={40}
          />
        </button>
      ))}
    </div>
  );

  const marketTabs = (idPrefix: string, ariaLabel: string) => (
    <div className="ms-market-tabs" role="tablist" aria-label={ariaLabel}>
      {marketChoiceList.map((choice) => {
        const isActive = choice.market === faction;
        return (
          <button
            key={choice.market}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={choice.kind === 'faction'
              ? `${idPrefix}market-home`
              : `${idPrefix}market-tab-${choice.market}`}
            className={`ms-market-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => chooseMarket(choice.market)}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );

  if (mobileLayout && !harborAuction) {
    const readyRows = rowsReadyPath === selectedBlockPath ? rows : [];
    const mobileSort = Object.entries(mobileSortOptions).find(([, [field, direction]]) =>
      field === sortBy && direction === sortDir)?.[0] ?? '';
    const mobileCategories = [...eraCategories, { id: 'unclassified', label: 'Unclassified' }]
      .map(({ id, label }) => ({ id, label, count: categoryCounts[id] ?? 0 }))
      .filter(({ id, count }) => count > 0 || id === ahCategory);

    return (
      <div className="ms-mobile-root" data-flavor={flavor}>
        <MobileApp
          eraLabel={flavorConfig.shortLabel}
          activeFlavor={flavor}
          eras={FLAVOR_IDS.map((id) => ({ id, label: FLAVORS[id].shortLabel }))}
          onSelectFlavor={(id) => {
            if (isFlavorId(id)) selectFlavor(id);
          }}
          realmLabel={activePartitionLabel}
          partitionLabel={partitionLabel}
          realms={partitionOptions.map((p) => ({ label: p.label, count: p.entryCount }))}
          onSelectRealm={(label) => {
            const found = partitionOptions.find((p) => p.label === label);
            if (found) choosePartition(found.key);
          }}
          homeFaction={homeFaction}
          onSelectHomeFaction={chooseHomeFaction}
          factionMarketsAvailable={factionMarketsAvailable}
          market={faction}
          markets={marketChoiceList}
          onSelectMarket={chooseMarket}
          searchQuery={search}
          onSearchChange={(value) => { setSearch(value); setPage(1); }}
          sortBy={mobileSort}
          onSortChange={(key) => {
            const [field, direction] = mobileSortOptions[key];
            setSortBy(field);
            setSortDir(direction);
            setPage(1);
          }}
          rows={readyRows.map((row) => ({
            itemKey: row.itemKey,
            name: row.name,
            quality: row.quality,
            iconUrl: row.iconUrl || getItemIconUrl(row.icon ?? DEFAULT_ITEM_ICON),
            categoryLabel: row.variants ? `${row.category} · ${row.variants.length} variants` : row.category,
            itemLevel: flavor === 'retail' ? row.itemLevel : row.reqLevel ?? row.itemLevel,
            unitPrice: row.minPrice,
            quantity: row.totalQty,
          }))}
          loading={marketLoading || Boolean(snapshotSummary && rowsReadyPath !== selectedBlockPath && !snapshotError)}
          marketError={indexError || snapshotError}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          categories={mobileCategories}
          activeCategory={ahCategory}
          onSelectCategory={(id) => { setAhCategory(id); setAhSubcategory('all'); setPage(1); }}
          activeQuality={qualityFilter}
          onSelectQuality={(q) => { setQualityFilter(q); setPage(1); }}
          onSelectItem={(key) => {
            const item = readyRows.find((row) => row.itemKey === key);
            if (item) openItem(item);
          }}
          activeTab={mobileTab}
          onTabChange={(tab) => { closeItem(); setMobileTab(tab); }}
          shoppingCount={activeListItemCount}
          alertsCount={unreadNotifCount}
          renderSecondaryTab={() => {
            if (mobileTab === 'shopping') return shoppingPanel;
            if (mobileTab === 'alerts') return alertsPanel;
            if (mobileTab === 'craft') return craftPanel;
            return (
              <MarketAnalyticsPanel
                variant="mobile"
                flavor={flavor}
                eraLabel={flavorConfig.shortLabel}
                marketLabel={activePartitionLabel}
                faction={faction}
                analytics={marketAnalytics}
                loading={analyticsLoading || (!activeBlockMeta && marketLoading)}
                error={indexError || analyticsError}
                windowHours={analyticsHours}
                onWindowHoursChange={setAnalyticsHours}
                activeCategory={analyticsCategory}
                onCategoryChange={setAnalyticsCategory}
                onSelectItem={openItem}
              />
            );
          }}
        />
        <dialog ref={mobileRealmPicker} className="ms-modal ms-m-realm-picker" aria-labelledby="mobile-realm-title">
          <h2 id="mobile-realm-title">Edition and market</h2>
          <label htmlFor="mobile-edition">Edition</label>
          <select id="mobile-edition" className="ms-select" value={flavor} onChange={(event) => {
            if (isFlavorId(event.target.value)) selectFlavor(event.target.value);
          }}>
            {FLAVOR_IDS.map((id) => <option key={id} value={id}>{FLAVORS[id].shortLabel}</option>)}
          </select>
          <label htmlFor="mobile-market">{partitionLabel}</label>
          <select id="mobile-market" className="ms-select" value={partitionKey} onChange={(event) => choosePartition(event.target.value)}>
            {partitionOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" className="ms-btn ms-btn-primary" onClick={() => mobileRealmPicker.current?.close()}>Done</button>
        </dialog>
        {itemDetails}
      </div>
    );
  }

  return (
    <div
      className="ms-shell"
      data-testid="app-shell"
      data-flavor={flavor}
    >
      {!harborAuction && <header ref={headerRef} className="ms-header">
        <div className="ms-header-inner">
          <div className="ms-header-top">
            <div className="ms-brand">
              <div className="ms-era-logo-box">
                <img
                  src={flavorConfig.localLogoFallback}
                  alt={`${flavorConfig.label} logo`}
                  className="ms-era-logo"
                  data-testid="era-logo"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.fallbackApplied) {
                      img.dataset.fallbackApplied = '1';
                      img.src = '/assets/blizzard-trademarks/wow-logo.png';
                    }
                  }}
                />
              </div>
              <div className="ms-brand-text">
                <span className="ms-brand-kicker">{themeMeta.eraBadge}</span>
                <h1 className="ms-brand-title">
                  MarketSync — {themeMeta.armoryTitle}
                </h1>
                <span className="ms-brand-sub">{themeMeta.subtitle}</span>
              </div>
            </div>

            {/* One faction choice for the whole site: every tab reads homeFaction. */}
            <div className="ms-header-faction">
              {factionSwitch('')}
            </div>

            <div className="ms-header-actions">
              <div className="ms-header-cta-row">
                <a
                  href={CURSEFORGE_ADDON_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ms-btn ms-btn-curseforge"
                  data-testid="curseforge-download-btn"
                  title="Download the MarketSync WoW Addon from CurseForge"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.326 9.2045C19.6608 8.4418 21.3999 7.8256 23.5 7.625H16.25L15.1562 5.375H2.5L4.0312 8.1875C5.9062 8.5312 7.2188 9.6875 7.5938 11.4062C5.9062 11.75 4.6562 12.6875 3.9688 14.125H9.1875L10.375 18.625H14.6875L15.8438 14.125H20.0625C19.5312 12.875 18.5938 11.9688 17.25 11.5312C17.4688 10.6562 17.826 9.8608 18.326 9.2045Z" />
                  </svg>
                  <span>Download on CurseForge</span>
                </a>
                {harborUrl && (
                  <button type="button" className="ms-btn ms-btn-primary ms-enter-azeroth" onClick={toggleExplore}>
                    {activeTab === 'explore' ? 'Exit Azeroth' : 'Enter Azeroth'}
                  </button>
                )}
              </div>
              <div className="ms-auth-bar">
              {auth.authenticated && auth.user ? (
                <>
                  <span className="ms-user-pill" data-testid="user-battletag">
                    {auth.user.battletag}
                  </span>
                  <button
                    type="button"
                    className="ms-btn ms-btn-ghost ms-btn-xs"
                    data-testid="logout-btn"
                    onClick={() => void handleLogout()}
                  >
                    Logout
                  </button>
                </>
              ) : capabilities.oauth ? (
                <a
                  href="/api/auth/login?region=us"
                  className="ms-btn ms-btn-bnet"
                  data-testid="bnet-login-btn"
                >
                  Login with Battle.net
                </a>
              ) : null}
              </div>
            </div>
          </div>

          <div className="ms-header-nav-row">
            <div
              className="ms-flavor-tabs"
              role="tablist"
              aria-label="World of Warcraft Release Candidates"
            >
              {FLAVOR_IDS.map((fId) => {
                const cfg = FLAVORS[fId];
                const isActive = fId === flavor;

  const isWip = fId === 'anniversary' || fId === 'classicEra';
  return (
                  <button
                    key={fId}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`flavor-tab-${fId}`}
                    className={`ms-flavor-tab ${isActive ? 'is-active' : ''} ${isWip ? 'is-wip' : ''}`}
                    onClick={() => selectFlavor(fId)}
                  >
                    {cfg.shortLabel}
                  </button>
                );
              })}
            </div>

            <nav className="ms-main-nav" aria-label="Workspace Sections">
              <button
                type="button"
                data-testid="nav-auction-house"
                className={`ms-nav-tab ${activeTab === 'ah' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTab('ah');
                  closeItem();
                }}
              >
                Auction House
              </button>
              <button
                type="button"
                data-testid="nav-analytics"
                className={`ms-nav-tab ${activeTab === 'analytics' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTab('analytics');
                  closeItem();
                }}
              >
                Analytics
              </button>
              <button
                type="button"
                data-testid="nav-professions"
                className={`ms-nav-tab ${activeTab === 'craft' ? 'is-active' : ''}`}
                onClick={() => { setActiveTab('craft'); closeItem(); }}
              >
                Professions
              </button>
              <button
                type="button"
                data-testid="nav-shopping-lists"
                className={`ms-nav-tab ${activeTab === 'lists' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTab('lists');
                  closeItem();
                }}
              >
                Shopping Lists
                <span className="ms-nav-count">{activeListItemCount}</span>
              </button>
              <button
                type="button"
                data-testid="nav-alerts"
                className={`ms-nav-tab ${activeTab === 'alerts' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTab('alerts');
                  closeItem();
                }}
              >
                Alerts &amp; Notifications
                {unreadNotifCount > 0 && (
                  <span className="ms-nav-count">{unreadNotifCount}</span>
                )}
              </button>
            </nav>
          </div>
        </div>
      </header>}

      <main className="ms-main" inert={harborAuction && Boolean(selectedItem)}>
        {harborUrl && mapOpened && (
          <HarborPanel url={harborUrl} active={activeTab === 'explore'} />
        )}
        {indexError && activeTab !== 'explore' && (
          <div className="ms-alert-error" role="alert">
            Dataset index unavailable: {indexError}{' '}
            <button
              type="button"
              className="ms-btn ms-btn-ghost ms-btn-xs"
              onClick={() => void loadIndex()}
            >
              Retry
            </button>
          </div>
        )}

        {activeTab === 'ah' && (
          <section className="ms-panel ms-auction-panel" aria-label="Auction House Browser">
            <div className="ms-controls-bar">
              <div className="ms-field-group">
                <label htmlFor="ruleset-select">{partitionLabel}</label>
                <select
                  id="ruleset-select"
                  data-testid="ruleset-select"
                  className="ms-select"
                  value={partitionKey}
                  onChange={(e) => choosePartition(e.target.value)}
                >
                  {partitionOptions.map((p) => (
                    <option key={p.key} value={p.key}>
                      {flavor === 'forever' || p.label === p.key
                        ? `${p.label} (${p.entryCount.toLocaleString()})`
                        : `${p.label} (${p.key}) (${p.entryCount.toLocaleString()})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ms-field-group ms-field-search">
                <label htmlFor="auction-search-input">Search Items</label>
                <div className="ms-inline-row">
                  <input
                    id="auction-search-input"
                    data-testid="auction-search-input"
                    type="search"
                    className="ms-input"
                    placeholder='Item name or ID'
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                  <label
                    className="ms-exact-toggle"
                    title="Exact item name match (or wrap search in quotes)"
                  >
                    <input
                      type="checkbox"
                      checked={exactMatch}
                      onChange={(e) => {
                        setExactMatch(e.target.checked);
                        setPage(1);
                      }}
                    />
                    <span>Exact</span>
                  </label>
                </div>
              </div>

              <div className="ms-field-group ms-field-levels">
                <label htmlFor="min-level-input">{flavor === 'retail' ? 'Item level' : 'Level range'}</label>
                <div className="ms-inline-row">
                  <input
                    id="min-level-input"
                    data-testid="min-level-input"
                    type="number"
                    min={1}
                    max={999}
                    placeholder="Min"
                    className="ms-input ms-input-lvl"
                    value={minLevel}
                    onChange={(e) => {
                      setMinLevel(e.target.value);
                      setPage(1);
                    }}
                  />
                  <span className="ms-lvl-sep">-</span>
                  <input
                    id="max-level-input"
                    data-testid="max-level-input"
                    type="number"
                    min={1}
                    max={999}
                    placeholder="Max"
                    aria-label="Maximum level"
                    className="ms-input ms-input-lvl"
                    value={maxLevel}
                    onChange={(e) => {
                      setMaxLevel(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>

              <div className="ms-field-group">
                <label htmlFor="quality-filter">Rarity</label>
                <select
                  id="quality-filter"
                  data-testid="quality-filter"
                  className="ms-select"
                  value={qualityFilter}
                  onChange={(e) => {
                    setQualityFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Rarities</option>
                  <option value="0">Poor</option>
                  <option value="1">Common</option>
                  <option value="2">Uncommon</option>
                  <option value="3">Rare</option>
                  <option value="4">Epic</option>
                  <option value="5">Legendary</option>
                </select>
              </div>

              <div className="ms-field-group">
                <label htmlFor="sort-select">Sort By</label>
                <div className="ms-inline-row">
                  <select
                    id="sort-select"
                    data-testid="sort-select"
                    className="ms-select"
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value as SortField);
                      setPage(1);
                    }}
                  >
                    <option value="minPrice">Unit price</option>
                    <option value="maxPrice">Highest unit price</option>
                    <option value="quality">Rarity</option>
                    <option value="level">{flavor === 'retail' ? 'Item level' : 'Level'}</option>
                    <option value="totalQty">Available</option>
                    <option value="listings">Listings</option>
                    <option value="name">Item Name</option>
                    <option value="category">Category</option>
                  </select>
                  <button
                    type="button"
                    className="ms-btn ms-btn-secondary"
                    aria-label={`Sort direction ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                    onClick={() =>
                      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                    }
                  >
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </button>
                  <button
                    type="button"
                    className="ms-btn ms-btn-ghost"
                    data-testid="reset-filters-btn"
                    onClick={resetAhFilters}
                    disabled={!hasActiveFilters}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <div className="ms-market-bar">
              {marketTabs('', 'Market')}

              <div className="ms-stats-strip">
                {activeBlockMeta && (
                  <span className="ms-capture-time">
                    {archivedBlock ? 'Archive' : 'Updated'}{' '}
                    <time dateTime={new Date(activeBlockMeta.timestamp * 1000).toISOString()}>
                      {captureDate.format(activeBlockMeta.timestamp * 1000)}
                    </time>
                  </span>
                )}
                {isSimulated && <span className="ms-badge ms-badge-simulated">Simulated</span>}
                <button type="button" className="ms-btn ms-btn-ghost ms-btn-xs"
                  disabled={refreshingIndex} onClick={() => void loadIndex()}>
                  {refreshingIndex ? 'Refreshing…' : 'Refresh'}
                </button>
                {indexCheckedAt && (
                  <span className="ms-capture-time">
                    Checked <time data-testid="dataset-checked-at" dateTime={new Date(indexCheckedAt).toISOString()}>
                      {checkedDate.format(indexCheckedAt)}
                    </time>
                  </span>
                )}
                <details className="ms-capture-history" key={flavor}>
                  <summary className="ms-btn ms-btn-ghost ms-btn-xs">History</summary>
                  <div className="ms-capture-menu ms-field-group">
                    <label htmlFor="snapshot-select">Market capture</label>
                    <select id="snapshot-select" className="ms-select" value={archivedBlock?.path ?? ''}
                      onChange={(event) => {
                        setArchivePath(event.target.value);
                        setPage(1);
                        closeItem();
                        event.currentTarget.closest('details')?.removeAttribute('open');
                      }}>
                      <option value="">Latest market</option>
                      {flavorBlocks.map((block) => (
                        <option key={block.path} value={block.path}>
                          {checkedDate.format(block.timestamp * 1000)}{block.simulated ? ' · Simulated' : ''}
                          {block.isLegacyPath ? ' · Legacy' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </details>
              </div>
            </div>

            <div className="ms-ah-workspace">
              {/* Era-Specific In-Game Auction House Category Tree Sidebar */}
              <aside
                className="ms-ah-sidebar"
                aria-label="Auction House Categories"
                data-testid="ah-category-sidebar"
                data-expanded={mobileCategoriesOpen}
              >
                <div className="ms-ah-sidebar-head">
                  <span className="ms-category-label">Categories</span>
                  <button type="button" className="ms-category-toggle" aria-controls="auction-categories"
                    aria-expanded={mobileCategoriesOpen} onClick={() => setMobileCategoriesOpen((open) => !open)}>
                    {ahCategory === 'all' ? 'Categories' : eraCategories.find((category) => category.id === ahCategory)?.label ?? 'Unclassified'}
                  </button>
                  {ahCategory !== 'all' && (
                    <button
                      type="button"
                      className="ms-ah-clear-cat"
                      onClick={() => {
                        setAhCategory('all');
                        setAhSubcategory('all');
                        setPage(1);
                      }}
                    >
                      All
                    </button>
                  )}
                </div>
                <ul className="ms-ah-cat-list" id="auction-categories">
                  <li>
                    <button
                      type="button"
                      data-testid="ah-category-all"
                      className={`ms-ah-cat-btn ${ahCategory === 'all' ? 'is-active' : ''}`}
                      onClick={() => {
                        setAhCategory('all');
                        setAhSubcategory('all');
                        setPage(1);
                      }}
                    >
                      <span>All Categories</span>
                    </button>
                  </li>
                  {[...eraCategories, { id: 'unclassified', label: 'Unclassified', subCategories: [] }].map((cat) => {
                    const isCatActive = ahCategory === cat.id;
                    const count = categoryCounts[cat.id] ?? 0;
                    if (count === 0 && !isCatActive) return null;

  return (
                      <li key={cat.id} className="ms-ah-cat-node">
                        <button
                          type="button"
                          data-testid={`ah-category-${cat.id}`}
                          aria-pressed={isCatActive && ahSubcategory === 'all'}
                          className={`ms-ah-cat-btn ${isCatActive && ahSubcategory === 'all' ? 'is-active' : ''} ${isCatActive ? 'is-expanded' : ''}`}
                          onClick={() => {
                            if (isCatActive && ahSubcategory === 'all') {
                              setAhCategory('all');
                              setAhSubcategory('all');
                            } else {
                              setAhCategory(cat.id);
                              setAhSubcategory('all');
                            }
                            setPage(1);
                          }}
                        >
                          <span>{cat.label}</span>
                          {count > 0 && (
                            <span className="ms-ah-cat-count">{count}</span>
                          )}
                        </button>
                        {isCatActive &&
                          cat.subCategories &&
                          cat.subCategories.length > 0 && (
                            <ul className="ms-ah-subcat-list">
                              {cat.subCategories.map((sub) => {
                                const isSubActive = ahSubcategory === sub.id;
                                const subCount =
                                  categoryCounts[`${cat.id}:${sub.id}`] ?? 0;
                                if (subCount === 0 && !isSubActive) return null;

  return (
                                  <li key={sub.id}>
                                    <button
                                      type="button"
                                      data-testid={`ah-subcategory-${cat.id}-${sub.id}`}
                                      aria-pressed={isSubActive}
                                      className={`ms-ah-subcat-btn ${isSubActive ? 'is-active' : ''}`}
                                      onClick={() => {
                                        setAhSubcategory(
                                          isSubActive ? 'all' : sub.id,
                                        );
                                        setPage(1);
                                      }}
                                    >
                                      <span>{sub.label}</span>
                                      {subCount > 0 && (
                                        <span className="ms-ah-cat-count">
                                          {subCount}
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                      </li>
                    );
                  })}
                </ul>
              </aside>

              {/* Main Auction House Browse Table */}
              <div className="ms-ah-results">
                {(flavor === 'anniversary' || flavor === 'classicEra') && (
                  <div className="ms-sticky-note" role="note">
                    <strong>{flavorConfig.shortLabel} — Data Collection In Progress</strong>
                    Blizzard does not provide a public Auction House API for {flavorConfig.shortLabel}.
                    We&apos;re working on a community addon method to gather and sync auction data from players.
                  </div>
                )}
                  <div className="ms-table-wrap ms-auction-table-wrap" tabIndex={0} aria-label="Auction listings">
                    <table className="ms-table" data-testid="auction-table">
                      <thead>
                        <tr>
                          <th className="ms-col-item">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('name', 'asc')}
                            >
                              <span>
                                {flavor === 'retail' ? 'Name' : 'Rarity / Item'}
                              </span>
                              {sortBy === 'name' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                          <th className="ms-col-lvl">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('level', 'desc')}
                            >
                              <span>
                                {flavor === 'retail' ? 'iLvl' : 'Lvl'}
                              </span>
                              {sortBy === 'level' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                          <th className="ms-col-cat">
                            <button type="button" className="ms-th-sort" onClick={() => toggleColumnSort('category')}>
                              Category {sortBy === 'category' && (sortDir === 'asc' ? '▲' : '▼')}
                            </button>
                          </th>
                          <th className="ms-col-price">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('minPrice', 'asc')}
                            >
                              <span>
                                Unit Price
                              </span>
                              {sortBy === 'minPrice' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                          <th className="ms-col-price">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('maxPrice', 'asc')}
                            >
                              <span>High Price</span>
                              {sortBy === 'maxPrice' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                          <th className="ms-col-qty">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('totalQty', 'desc')}
                            >
                              <span>Quantity</span>
                              {sortBy === 'totalQty' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                          <th className="ms-col-listings">
                            <button
                              type="button"
                              className="ms-th-sort"
                              onClick={() => toggleColumnSort('listings', 'desc')}
                            >
                              <span>Listings</span>
                              {sortBy === 'listings' && (
                                <span className="ms-sort-arrow">
                                  {sortDir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rowsReadyPath === selectedBlockPath ? rows : []).map((row) => {
                          const displayLvl = flavor === 'retail' ? row.itemLevel : row.reqLevel ?? row.itemLevel;
                          const wowheadUrl = getWowheadItemUrl(row.itemId, flavor, row.petSpeciesId);

  return (
                            <tr
                              key={row.itemKey}
                              className="ms-clickable-row"
                              onClick={() => openItem(row)}
                            >
                              <td className="ms-col-item">
                                <div className="ms-item-cell">
                                  <a className="ms-item-icon-link" href={wowheadUrl} tabIndex={-1}
                                    aria-label={row.name} data-disable-wowhead-touch-tooltip="true"
                                    onClick={(event) => clickItemLink(event, row)}>
                                    <ItemBadge quality={row.quality} category={row.category} isPetCage={row.isPetCage}
                                      icon={row.icon} iconUrl={row.iconUrl} />
                                  </a>
                                  <div className="ms-item-title-cell">
                                    <a className={`ms-item-link ms-item-name ms-quality-text-${row.quality}`}
                                      href={wowheadUrl} data-disable-wowhead-touch-tooltip="true"
                                      onClick={(event) => clickItemLink(event, row)}>
                                      {row.name}
                                    </a>
                                    <span className="ms-muted ms-mono">
                                      {row.isPetCage
                                        ? `Pet Cage • Species #${row.petSpeciesId}`
                                        : `#${row.itemKey}${row.variants ? ` · ${row.variants.length} variants` : ''}`}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="ms-col-lvl ms-mono">
                                {displayLvl ?? '—'}
                              </td>
                              <td className="ms-col-cat">
                                {row.subCategory || row.category}
                              </td>
                              <td className="ms-col-price">
                                <CopperDisplay copper={row.minPrice} />
                              </td>
                              <td className="ms-col-price">
                                <CopperDisplay copper={row.maxPrice} />
                              </td>
                              <td className="ms-col-qty">
                                {row.totalQty.toLocaleString('en-US')}
                              </td>
                              <td className="ms-col-listings">
                                {row.listings.toLocaleString('en-US')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {(marketLoading || (snapshotSummary && rowsReadyPath !== selectedBlockPath)) && (
                        <tfoot><tr><td colSpan={7} role="status">Loading auction listings…</td></tr></tfoot>
                      )}
                      {snapshotError && (
                        <tfoot><tr><td colSpan={7}><div className="ms-alert-error" role="alert">{snapshotError}</div></td></tr></tfoot>
                      )}
                      {!marketLoading && !snapshotError && rowsReadyPath === selectedBlockPath && rows.length === 0 && (
                        <tfoot><tr><td colSpan={7}>
                          <div className="ms-empty-box" data-testid="empty-market-state" role="status">
                            <p>
                              <strong>{nameLookupPending ? 'Looking up item names…' : 'No matching auctions'}</strong>{' '}
                              for {flavorConfig.shortLabel} / {activePartitionLabel} / {faction}.
                            </p>
                            <p className="ms-muted">
                              {hasActiveFilters
                                ? 'Try clearing your search, level range, category, or rarity filter.'
                                : marketEmptyMessage}
                            </p>
                            {currentLookup?.failed && <p className="ms-muted">Wowhead name lookup is unavailable. You can still search by item ID.</p>}
                          </div>
                        </td></tr></tfoot>
                      )}
                    </table>
                  </div>
              </div>
            </div>

            <div className="ms-pagination">
              <span className="ms-muted">
                Page {page} of {totalPages} ({totalCount.toLocaleString('en-US')}{' '}
                matching items)
                {marketCapture?.status === 'partial' && ' · Partial capture'}
              </span>
              <div className="ms-inline-row">
                <button
                  type="button"
                  className="ms-btn ms-btn-secondary"
                  data-testid="pagination-prev"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="ms-btn ms-btn-secondary"
                  data-testid="pagination-next"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        )}

        {(activeTab === 'analytics' || activeTab === 'craft') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="ms-panel" style={{ padding: '12px 16px' }}>
              <div className="ms-market-bar" style={{ margin: 0 }}>
                <div className="ms-inline-row" style={{ gap: '12px', flexWrap: 'wrap' }}>
                  <div className="ms-field-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    <label htmlFor="analytics-ruleset-select" style={{ margin: 0 }}>
                      {partitionLabel}
                    </label>
                    <select
                      id="analytics-ruleset-select"
                      className="ms-select"
                      value={partitionKey}
                      onChange={(e) => choosePartition(e.target.value)}
                    >
                      {partitionOptions.map((p) => (
                        <option key={p.key} value={p.key}>
                          {flavor === 'forever' || p.label === p.key
                            ? `${p.label} (${p.entryCount.toLocaleString()})`
                            : `${p.label} (${p.key}) (${p.entryCount.toLocaleString()})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {marketTabs('analytics-', 'Market')}
                </div>

                {activeBlockMeta && (
                  <span className="ms-capture-time">
                    {archivedBlock ? 'Archive' : 'Latest'}{' '}
                    <time dateTime={new Date(activeBlockMeta.timestamp * 1000).toISOString()}>
                      {captureDate.format(activeBlockMeta.timestamp * 1000)}
                    </time>
                  </span>
                )}
              </div>
            </div>

            {(flavor === 'anniversary' || flavor === 'classicEra') && (
              <div className="ms-sticky-note" role="note">
                <strong>{flavorConfig.shortLabel} — Data Collection In Progress</strong>
                Blizzard does not provide a public Auction House API for {flavorConfig.shortLabel}.
                We&apos;re working on a community addon method to gather and sync auction data from players.
              </div>
            )}

            {isCraftVisible ? craftPanel : <MarketAnalyticsPanel
              variant="desktop"
              flavor={flavor}
              eraLabel={flavorConfig.shortLabel}
              marketLabel={activePartitionLabel}
              faction={faction}
              analytics={marketAnalytics}
              loading={analyticsLoading || (!activeBlockMeta && marketLoading)}
              error={indexError || analyticsError}
              windowHours={analyticsHours}
              onWindowHoursChange={setAnalyticsHours}
              activeCategory={analyticsCategory}
              onCategoryChange={setAnalyticsCategory}
              onSelectItem={openItem}
              moneyMakers={
                <MoneyMakersPanel
                  flavor={flavor}
                  path={selectedBlockPath}
                  partitionKey={partitionKey}
                  faction={faction}
                  analytics={marketAnalytics}
                  windowLabel={ANALYTICS_WINDOW_LABELS[analyticsHours] ?? `${analyticsHours}-hour`}
                  onSelectItem={(row) => openItem(row)}
                />
              }
            />}
          </div>
        )}

        {activeTab === 'lists' && shoppingPanel}

        {activeTab === 'alerts' && alertsPanel}
      </main>

      {itemDetails}

      {!harborAuction && <footer className="ms-footer" data-testid="trademark-footer">
        <p>
          <strong>MarketSyncWeb</strong> — Open-source community Auction House
          browser &amp; shopping list companion (GPL-3.0) ·{' '}
          <a
            href={CURSEFORGE_ADDON_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-footer-link"
          >
            Download MarketSync on CurseForge ↗
          </a>
        </p>
        <p>
          Not affiliated with, endorsed by, or sponsored by Blizzard
          Entertainment, Inc. World of Warcraft, Battle.net, and related logos
          are trademarks or registered trademarks of Blizzard Entertainment,
          Inc. in the U.S. and/or other countries.
        </p>
      </footer>}
    </div>
  );
}
