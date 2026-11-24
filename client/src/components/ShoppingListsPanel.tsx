import { useState } from 'react';
import {
  encodeShoppingList,
  formatCopper,
  MAX_COPPER,
  normalizeItemKey,
  parseCopper,
  resolveItemMetadata,
  safeDecodeShoppingList,
  type FactionPartition,
  type FlavorId,
  type ShoppingList,
  type ShoppingListItem,
} from '@marketsync/shared';
import type { StoredShoppingList } from '../lib/shoppingListStore.js';
import { CopperDisplay } from './CopperDisplay.js';
import { ItemBadge } from './ItemBadge.js';

interface ShoppingListsPanelProps {
  lists: StoredShoppingList[];
  activeListId: string;
  activeFlavor: FlavorId;
  activePartition: string;
  activeFaction: FactionPartition;
  canCloudSync: boolean;
  onSelectList: (id: string) => void;
  onCreateList: (name: string) => void;
  onDeleteList: (id: string) => void;
  onUpdateList: (id: string, nextList: ShoppingList) => void;
  onImportList: (decoded: ShoppingList) => void;
  onSyncListToCloud?: (
    stored: StoredShoppingList,
  ) => Promise<{ ok: boolean; error?: string } | void>;
}

function MaxPriceCell({
  copper,
  onChange,
}: {
  copper: number | undefined;
  onChange: (nextCopper: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(null);
      setEditing(false);
      onChange(undefined);
      return;
    }
    try {
      const parsed = parseCopper(trimmed);
      if (parsed > MAX_COPPER) {
        setError(`Max ${MAX_COPPER}`);
        return;
      }
      setError(null);
      setEditing(false);
      onChange(parsed > 0 ? parsed : undefined);
    } catch {
      setError('Invalid price (e.g. 50000 or 5g 00s)');
    }
  };

  if (!editing) {
    return (
      <div className="ms-price-cell">
        <button
          type="button"
          className="ms-btn-inline"
          onClick={() => {
            setDraft(copper ? String(copper) : '');
            setError(null);
            setEditing(true);
          }}
          title="Click to edit max target price (copper or 10g 50s)"
        >
          {copper && copper > 0 ? <CopperDisplay copper={copper} /> : 'No limit'}
        </button>
      </div>
    );
  }

  return (
    <div className="ms-price-edit">
      <input
        type="text"
        className="ms-input ms-input-sm"
        value={draft}
        placeholder="e.g. 5g or 50000"
        aria-label="Max target price"
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setError(null);
            setEditing(false);
          }
        }}
      />
      {error && <span className="ms-field-error">{error}</span>}
    </div>
  );
}

export function ShoppingListsPanel({
  lists,
  activeListId,
  activeFlavor,
  activePartition,
  activeFaction,
  canCloudSync,
  onSelectList,
  onCreateList,
  onDeleteList,
  onUpdateList,
  onImportList,
  onSyncListToCloud,
}: ShoppingListsPanelProps) {
  const [newListName, setNewListName] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualMaxPrice, setManualMaxPrice] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const [exportModalText, setExportModalText] = useState<string | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const activeStored =
    lists.find((l) => l.id === activeListId) ?? lists[0] ?? null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;
    onCreateList(trimmed.slice(0, 64));
    setNewListName('');
  };

  const handleAddManualItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStored) return;
    setManualError(null);

    let itemId: number;
    let suffix = 0;
    try {
      const parsed = normalizeItemKey(manualKey.trim());
      itemId = parsed.itemId;
      suffix = parsed.suffix;
    } catch {
      setManualError('Enter a valid Item ID (e.g. 13444) or Pet Cage (82800:1125)');
      return;
    }

    let maxPrice: number | undefined;
    if (manualMaxPrice.trim()) {
      try {
        const c = parseCopper(manualMaxPrice.trim());
        if (c > MAX_COPPER) {
          setManualError(`Max price cannot exceed ${formatCopper(MAX_COPPER)}`);
          return;
        }
        if (c > 0) maxPrice = c;
      } catch {
        setManualError('Invalid max price (use copper integer or 10g 50s)');
        return;
      }
    }

    const meta = resolveItemMetadata(
      suffix > 0 ? `${itemId}:${suffix}` : String(itemId),
      activeStored.list.f,
    );
    const newItem: ShoppingListItem = {
      id: itemId,
      ...(suffix > 0 ? { s: suffix } : {}),
      q: Math.max(1, Math.trunc(manualQty) || 1),
      ...(maxPrice !== undefined ? { m: maxPrice } : {}),
      nm: meta.name,
      ...(manualNote.trim() ? { nt: manualNote.trim() } : {}),
    };

    onUpdateList(activeStored.id, {
      ...activeStored.list,
      i: [...activeStored.list.i, newItem],
    });
    setManualKey('');
    setManualQty(1);
    setManualMaxPrice('');
    setManualNote('');
  };

  const handleOpenExport = () => {
    if (!activeStored) return;
    setExportError(null);
    const sanitizedItems = activeStored.list.i.map((item) => ({
      ...item,
      q: Math.max(1, Math.trunc(Number(item.q) || 1)),
      ...(item.m !== undefined
        ? {
            m: Math.min(
              MAX_COPPER,
              Math.max(0, Math.trunc(Number(item.m) || 0)),
            ),
          }
        : {}),
    }));
    const listToEncode: ShoppingList = {
      ...activeStored.list,
      f: activeStored.list.f ?? activeFlavor,
      r: activeStored.list.r ?? activePartition,
      fa: activeStored.list.fa ?? activeFaction,
      i: sanitizedItems,
    };
    try {
      const encoded = encodeShoppingList(listToEncode);
      setExportCopied(false);
      setExportModalText(encoded);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Failed to encode !MS1! string.',
      );
    }
  };

  const handleConfirmImport = () => {
    const res = safeDecodeShoppingList(importText);
    if (!res.ok) {
      setImportError(`${res.code}: ${res.message}`);
      return;
    }
    setImportError(null);
    onImportList(res.list);
    setImportText('');
    setImportModalOpen(false);
  };

  const updateItemAt = (
    idx: number,
    patch: Partial<ShoppingListItem>,
  ) => {
    if (!activeStored) return;
    const nextItems = activeStored.list.i.map((item, i) => {
      if (i !== idx) return item;
      const merged: ShoppingListItem = { ...item, ...patch };
      if (patch.q !== undefined) {
        merged.q = Math.max(1, Math.trunc(Number(patch.q) || 1));
      }
      if (!merged.m || merged.m <= 0) delete merged.m;
      if (!merged.nt || !merged.nt.trim()) delete merged.nt;
      if (!merged.d) delete merged.d;
      if (!merged.a) delete merged.a;
      return merged;
    });
    onUpdateList(activeStored.id, { ...activeStored.list, i: nextItems });
  };

  const removeItemAt = (idx: number) => {
    if (!activeStored) return;
    onUpdateList(activeStored.id, {
      ...activeStored.list,
      i: activeStored.list.i.filter((_, i) => i !== idx),
    });
  };

  return (
    <section className="ms-panel ms-lists-panel" aria-label="Shopping Lists">
      <div className="ms-panel-header">
        <div>
          <h2 className="ms-panel-title">Login-Free Shopping Lists</h2>
          <p className="ms-muted">
            Saved automatically in your browser. Share with the MarketSync WoW
            addon using <code>!MS1!</code> strings.
          </p>
        </div>

        <div className="ms-toolbar-actions">
          <button
            type="button"
            className="ms-btn ms-btn-primary"
            data-testid="export-ms1-btn"
            onClick={handleOpenExport}
            disabled={!activeStored}
          >
            Export !MS1!
          </button>
          <button
            type="button"
            className="ms-btn ms-btn-secondary"
            data-testid="import-ms1-btn"
            onClick={() => {
              setImportError(null);
              setImportModalOpen(true);
            }}
          >
            Import !MS1!
          </button>
          {canCloudSync && activeStored && onSyncListToCloud && (
            <button
              type="button"
              className="ms-btn ms-btn-ghost"
              onClick={async () => {
                setSyncStatus('Syncing…');
                const res = await onSyncListToCloud(activeStored);
                if (res && !res.ok) {
                  setSyncStatus(res.error ?? 'Failed to sync list to account.');
                } else {
                  setSyncStatus('Synced to account ✓');
                }
              }}
            >
              Sync to Account
            </button>
          )}
        </div>
      </div>

      {syncStatus && <p className="ms-status-note">{syncStatus}</p>}
      {exportError && (
        <p
          className="ms-alert-inline"
          role="alert"
          data-testid="ms1-export-error"
        >
          {exportError}
        </p>
      )}

      <div className="ms-lists-controls">
        <div className="ms-field-group">
          <label htmlFor="shopping-list-select">Active List</label>
          <div className="ms-inline-row">
            <select
              id="shopping-list-select"
              data-testid="shopping-list-select"
              className="ms-select"
              value={activeStored?.id ?? ''}
              onChange={(e) => onSelectList(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.list.n} ({l.list.i.length})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ms-btn ms-btn-danger"
              data-testid="delete-list-btn"
              onClick={() => activeStored && onDeleteList(activeStored.id)}
              disabled={!activeStored}
            >
              Delete List
            </button>
          </div>
        </div>

        <form className="ms-field-group" onSubmit={handleCreate}>
          <label htmlFor="create-list-input">Create New List</label>
          <div className="ms-inline-row">
            <input
              id="create-list-input"
              data-testid="create-list-input"
              type="text"
              className="ms-input"
              placeholder="e.g. BWL Raid Prep"
              maxLength={64}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
            />
            <button
              type="submit"
              className="ms-btn ms-btn-primary"
              data-testid="create-list-btn"
            >
              Create List
            </button>
          </div>
        </form>
      </div>

      {activeStored && (
        <>
          <form className="ms-add-item-form" onSubmit={handleAddManualItem}>
            <div className="ms-field-group">
              <label htmlFor="manual-item-key">Item ID or Pet Key</label>
              <input
                id="manual-item-key"
                type="text"
                className="ms-input"
                placeholder="13444 or 82800:1125"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
              />
            </div>
            <div className="ms-field-group">
              <label htmlFor="manual-item-qty">Qty</label>
              <input
                id="manual-item-qty"
                type="number"
                min={1}
                className="ms-input ms-input-sm"
                value={manualQty}
                onChange={(e) =>
                  setManualQty(
                    Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                  )
                }
              />
            </div>
            <div className="ms-field-group">
              <label htmlFor="manual-item-price">Max Unit Price</label>
              <input
                id="manual-item-price"
                type="text"
                className="ms-input"
                placeholder="e.g. 5g 00s or 50000"
                value={manualMaxPrice}
                onChange={(e) => setManualMaxPrice(e.target.value)}
              />
            </div>
            <div className="ms-field-group">
              <label htmlFor="manual-item-note">Note</label>
              <input
                id="manual-item-note"
                type="text"
                className="ms-input"
                placeholder="Optional note"
                maxLength={256}
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
              />
            </div>
            <div className="ms-field-group ms-field-submit">
              <button type="submit" className="ms-btn ms-btn-secondary">
                Add Item
              </button>
            </div>
          </form>

          {manualError && (
            <p className="ms-alert-inline" role="alert">
              {manualError}
            </p>
          )}

          {activeStored.list.i.length === 0 ? (
            <div className="ms-empty-box">
              <p>
                This list is empty. Add items from the Auction House browser or
                enter an Item ID above.
              </p>
            </div>
          ) : (
            <div className="ms-table-wrap">
              <table className="ms-table">
                <thead>
                  <tr>
                    <th>Done</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Max Target Price</th>
                    <th>Note</th>
                    <th>Alert</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStored.list.i.map((item, idx) => {
                    const key =
                      item.s && item.s > 0
                        ? `${item.id}:${item.s}`
                        : String(item.id);
                    const meta = resolveItemMetadata(key, activeStored.list.f);
                    const displayName = item.nm || meta.name;
                    return (
                      <tr
                        key={`${key}-${idx}`}
                        data-testid="shopping-item-row"
                        className={item.d === 1 ? 'ms-row-done' : ''}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Mark ${displayName} done`}
                            checked={item.d === 1}
                            onChange={(e) =>
                              updateItemAt(idx, {
                                d: e.target.checked ? 1 : 0,
                              })
                            }
                          />
                        </td>
                        <td>
                          <div className="ms-item-cell">
                            <ItemBadge
                              quality={meta.quality}
                              category={meta.category}
                              isPetCage={meta.isPetCage}
                              icon={meta.icon}
                              iconUrl={meta.iconUrl}
                              size="sm"
                            />
                            <div className="ms-item-title-cell">
                              <span
                                className={`ms-quality-text-${meta.quality}`}
                              >
                                {displayName}
                              </span>
                              <span className="ms-muted ms-mono">#{key}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Quantity for ${displayName}`}
                            className="ms-input ms-input-xs"
                            value={item.q}
                            onChange={(e) =>
                              updateItemAt(idx, {
                                q: Math.max(
                                  1,
                                  Math.trunc(Number(e.target.value) || 1),
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <MaxPriceCell
                            copper={item.m}
                            onChange={(nextCopper) =>
                              updateItemAt(idx, { m: nextCopper })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            aria-label={`Note for ${displayName}`}
                            className="ms-input ms-input-note"
                            placeholder="Add note..."
                            maxLength={256}
                            value={item.nt ?? ''}
                            onChange={(e) =>
                              updateItemAt(idx, { nt: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Alert for ${displayName}`}
                            checked={item.a === 1}
                            onChange={(e) =>
                              updateItemAt(idx, {
                                a: e.target.checked ? 1 : 0,
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ms-btn ms-btn-ghost ms-btn-xs"
                            onClick={() => removeItemAt(idx)}
                            aria-label={`Remove ${displayName}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {exportModalText !== null && (
        <div
          className="ms-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Export MarketSync !MS1! String"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExportModalText(null);
          }}
        >
          <div className="ms-modal">
            <div className="ms-modal-header">
              <h3>Export !MS1! Addon String</h3>
              <button
                type="button"
                className="ms-btn ms-btn-ghost"
                onClick={() => setExportModalText(null)}
                aria-label="Close export modal"
              >
                ✕
              </button>
            </div>
            <p className="ms-muted">
              Copy this string and paste it into the MarketSync WoW addon via{' '}
              <code>/ms import</code> or the Shopping tab.
            </p>
            <textarea
              readOnly
              rows={4}
              className="ms-textarea ms-mono"
              data-testid="ms1-export-output"
              aria-label="Exported !MS1! string"
              value={exportModalText}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="ms-modal-footer">
              <button
                type="button"
                className="ms-btn ms-btn-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(exportModalText);
                    setExportCopied(true);
                  } catch {
                    setExportCopied(false);
                  }
                }}
              >
                {exportCopied ? 'Copied ✓' : 'Copy to Clipboard'}
              </button>
              <button
                type="button"
                className="ms-btn ms-btn-ghost"
                onClick={() => setExportModalText(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {importModalOpen && (
        <div
          className="ms-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Import MarketSync !MS1! String"
          onClick={(e) => {
            if (e.target === e.currentTarget) setImportModalOpen(false);
          }}
        >
          <div className="ms-modal">
            <div className="ms-modal-header">
              <h3>Import !MS1! Addon String</h3>
              <button
                type="button"
                className="ms-btn ms-btn-ghost"
                onClick={() => setImportModalOpen(false)}
                aria-label="Close import modal"
              >
                ✕
              </button>
            </div>
            <p className="ms-muted">
              Paste a valid <code>!MS1!...</code> string exported from MarketSync.
            </p>
            <textarea
              rows={4}
              className="ms-textarea ms-mono"
              data-testid="ms1-import-input"
              aria-label="Paste !MS1! string"
              placeholder="!MS1!..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            {importError && (
              <div
                role="alert"
                className="ms-alert-error"
                data-testid="ms1-import-error"
              >
                {importError}
              </div>
            )}
            <div className="ms-modal-footer">
              <button
                type="button"
                className="ms-btn ms-btn-primary"
                data-testid="ms1-import-confirm"
                onClick={handleConfirmImport}
              >
                Import List
              </button>
              <button
                type="button"
                className="ms-btn ms-btn-ghost"
                onClick={() => setImportModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
