import { useEffect, useState } from 'react';
import {
  FLAVORS,
  FLAVOR_IDS,
  formatCopper,
  MAX_COPPER,
  normalizeItemKey,
  parseCopper,
  resolveItemMetadata,
  type AlertRule,
  type Capabilities,
  type FactionPartition,
  type FlavorId,
  type LinkedCharacter,
  type NotificationItem,
} from '@marketsync/shared';
import type { AuthMeResponse } from '../lib/api.js';
import { CopperDisplay } from './CopperDisplay.js';

interface AlertsPanelProps {
  capabilities: Capabilities;
  auth: AuthMeResponse;
  activeFlavor: FlavorId;
  activePartition: string;
  activeFaction: FactionPartition;
  notificationEmail: string;
  alerts: AlertRule[];
  notifications: NotificationItem[];
  statusMessage: string | null;
  onSaveEmail: (email: string) => Promise<void>;
  onCreateAlert: (payload: {
    flavor: FlavorId;
    partitionKey: string;
    faction: FactionPartition;
    itemKey: string;
    maxPriceCopper: number;
    emailEnabled: boolean;
  }) => Promise<void>;
  onToggleAlert: (id: string, enabled: boolean) => Promise<void>;
  onDeleteAlert: (id: string) => Promise<void>;
  onMarkRead: (id: string) => Promise<void>;
  onEvaluateNow: () => Promise<void>;
}

function formatCharacterLabel(char: LinkedCharacter): string {
  if (char.flavor === 'forever' && char.surname) {
    return `${char.name} ${char.surname}`;
  }
  return char.realmSlug ? `${char.name} — ${char.realmSlug}` : char.name;
}

export function AlertsPanel({
  capabilities,
  auth,
  activeFlavor,
  activePartition,
  activeFaction,
  notificationEmail,
  alerts,
  notifications,
  statusMessage,
  onSaveEmail,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onMarkRead,
  onEvaluateNow,
}: AlertsPanelProps) {
  const [emailInput, setEmailInput] = useState(notificationEmail);
  const [flavor, setFlavor] = useState<FlavorId>(activeFlavor);
  const [partitionKey, setPartitionKey] = useState(activePartition);
  const [faction, setFaction] = useState<FactionPartition>(activeFaction);

  useEffect(() => {
    setEmailInput(notificationEmail);
  }, [notificationEmail]);

  useEffect(() => {
    setFlavor(activeFlavor);
    setPartitionKey(activePartition);
    setFaction(activeFaction);
  }, [activeFlavor, activePartition, activeFaction]);
  const [itemKeyInput, setItemKeyInput] = useState('13468');
  const [maxPriceInput, setMaxPriceInput] = useState('10g 00s');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const isPersistent = capabilities.persistence;
  const isLoggedIn = auth.authenticated;
  const characters = auth.characters ?? [];

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    await onSaveEmail(emailInput.trim());
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let canonicalKey: string;
    try {
      canonicalKey = normalizeItemKey(itemKeyInput.trim()).canonicalKey;
    } catch {
      setFormError('Invalid Item ID or key (e.g. 13468 or 82800:1125)');
      return;
    }

    let maxPriceCopper: number;
    try {
      maxPriceCopper = parseCopper(maxPriceInput.trim());
      if (maxPriceCopper <= 0 || maxPriceCopper > MAX_COPPER) {
        setFormError(
          `Threshold must be between 1c and ${formatCopper(MAX_COPPER)}`,
        );
        return;
      }
    } catch {
      setFormError('Invalid copper or gold/silver/copper price (e.g. 5g 50s)');
      return;
    }

    await onCreateAlert({
      flavor,
      partitionKey: partitionKey.trim() || activePartition,
      faction,
      itemKey: canonicalKey,
      maxPriceCopper,
      emailEnabled,
    });
  };

  return (
    <section className="ms-panel ms-alerts-panel" aria-label="Alerts and Notifications">
      <div className="ms-panel-header">
        <div>
          <h2 className="ms-panel-title">Price Alerts &amp; Battle.net Account</h2>
          <p className="ms-muted">
            {isPersistent
              ? 'Link Battle.net characters, configure price drop alerts, and manage on-site + email notifications.'
              : 'Running in Zero-DB / Cloudflare Worker mode. Auction browsing and !MS1! shopping lists remain fully active; OAuth and server-side alerts require self-hosted mode.'}
          </p>
        </div>
        {isPersistent && isLoggedIn && (
          <button
            type="button"
            className="ms-btn ms-btn-secondary"
            onClick={() => void onEvaluateNow()}
          >
            Evaluate Alerts Now
          </button>
        )}
      </div>

      {statusMessage && (
        <div className="ms-status-note" role="status">
          {statusMessage}
        </div>
      )}

      {!isPersistent && (
        <div className="ms-empty-box">
          <p>
            <strong>Serverless Mode ({capabilities.mode}):</strong> Server-side
            OAuth, linked characters, and email notifications are disabled on
            this deployment. Use local Shopping Lists &amp; <code>!MS1!</code>{' '}
            export without any account required.
          </p>
        </div>
      )}

      <div className="ms-alerts-grid">
        {/* Linked Characters Card */}
        <div className="ms-subpanel">
          <h3>Linked Battle.net Characters</h3>
          <div data-testid="linked-characters">
            {!isLoggedIn ? (
              <p className="ms-muted">
                {capabilities.oauth
                  ? 'Sign in with Battle.net in the top bar to link Forever, Classic, and Retail characters.'
                  : 'Battle.net OAuth is not configured on this server.'}
              </p>
            ) : characters.length === 0 ? (
              <p className="ms-muted">
                No WoW characters returned for this Battle.net account yet.
              </p>
            ) : (
              <ul className="ms-char-list">
                {characters.map((ch) => (
                  <li key={ch.id} className="ms-char-card">
                    <div>
                      <strong>{formatCharacterLabel(ch)}</strong>
                      <div className="ms-muted">
                        {FLAVORS[ch.flavor]?.shortLabel ?? ch.flavor}
                        {ch.faction ? ` • ${ch.faction}` : ''}
                        {ch.ruleset ? ` • ${ch.ruleset}` : ''}
                      </div>
                    </div>
                    <span className="ms-badge">
                      {ch.level ? `Lv ${ch.level}` : ch.region.toUpperCase()}
                      {ch.className ? ` ${ch.className}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Notification Email Settings */}
        <div className="ms-subpanel">
          <h3>Notification Email Settings</h3>
          <form onSubmit={(e) => void handleSaveEmail(e)} className="ms-stack">
            <div className="ms-field-group">
              <label htmlFor="notification-email-input">Notification Email</label>
              <input
                id="notification-email-input"
                data-testid="notification-email-input"
                type="email"
                className="ms-input"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={!isPersistent || !isLoggedIn}
              />
            </div>
            <button
              type="submit"
              className="ms-btn ms-btn-primary"
              data-testid="save-notification-settings-btn"
              disabled={!isPersistent || !isLoggedIn}
            >
              Save Notification Settings
            </button>
          </form>
        </div>
      </div>

      {/* Create Alert Form */}
      <div className="ms-subpanel">
        <h3>Create Price Drop Alert</h3>
        <form
          onSubmit={(e) => void handleCreateAlert(e)}
          className="ms-add-item-form"
        >
          <div className="ms-field-group">
            <label htmlFor="alert-flavor">Era</label>
            <select
              id="alert-flavor"
              className="ms-select"
              value={flavor}
              onChange={(e) => setFlavor(e.target.value as FlavorId)}
              disabled={!isPersistent || !isLoggedIn}
            >
              {FLAVOR_IDS.map((f) => (
                <option key={f} value={f}>
                  {FLAVORS[f].shortLabel}
                </option>
              ))}
            </select>
          </div>

          <div className="ms-field-group">
            <label htmlFor="alert-partition">Ruleset / Realm</label>
            <input
              id="alert-partition"
              type="text"
              className="ms-input"
              value={partitionKey}
              onChange={(e) => setPartitionKey(e.target.value)}
              disabled={!isPersistent || !isLoggedIn}
            />
          </div>

          <div className="ms-field-group">
            <label htmlFor="alert-faction">Market</label>
            <select
              id="alert-faction"
              className="ms-select"
              value={faction}
              onChange={(e) => setFaction(e.target.value as FactionPartition)}
              disabled={!isPersistent || !isLoggedIn}
            >
              <option value="Alliance">Alliance</option>
              <option value="Horde">Horde</option>
              <option value="Neutral">Neutral</option>
              <option value="CrossFaction">CrossFaction</option>
              <option value="Commodities">Commodities</option>
            </select>
          </div>

          <div className="ms-field-group">
            <label htmlFor="alert-item-key">Item ID / Key</label>
            <input
              id="alert-item-key"
              type="text"
              className="ms-input"
              value={itemKeyInput}
              onChange={(e) => setItemKeyInput(e.target.value)}
              disabled={!isPersistent || !isLoggedIn}
            />
          </div>

          <div className="ms-field-group">
            <label htmlFor="alert-max-price">Target Max Price</label>
            <input
              id="alert-max-price"
              type="text"
              className="ms-input"
              value={maxPriceInput}
              onChange={(e) => setMaxPriceInput(e.target.value)}
              disabled={!isPersistent || !isLoggedIn}
            />
          </div>

          <div className="ms-field-group ms-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                disabled={!isPersistent || !isLoggedIn}
              />{' '}
              Email Alert
            </label>
          </div>

          <div className="ms-field-group ms-field-submit">
            <button
              type="submit"
              className="ms-btn ms-btn-primary"
              data-testid="create-alert-btn"
              disabled={!isPersistent || !isLoggedIn}
            >
              Create Alert
            </button>
          </div>
        </form>
        {formError && (
          <p className="ms-alert-inline" role="alert">
            {formError}
          </p>
        )}
      </div>

      {/* Alert Rules & Notification Inbox */}
      <div className="ms-alerts-grid">
        <div className="ms-subpanel">
          <h3>Active Alert Rules ({alerts.length})</h3>
          <div data-testid="alert-rules-list">
            {alerts.length === 0 ? (
              <p className="ms-muted">No alert rules configured.</p>
            ) : (
              <ul className="ms-rule-list">
                {alerts.map((rule) => {
                  const meta = resolveItemMetadata(rule.itemKey, rule.flavor);
                  return (
                    <li key={rule.id} className="ms-rule-item">
                      <div>
                        <strong>{meta.name}</strong>{' '}
                        <span className="ms-muted ms-mono">#{rule.itemKey}</span>
                        <div className="ms-muted">
                          {rule.flavor} / {rule.partitionKey} / {rule.faction} •{' '}
                          {rule.condition === 'above' ? '≥' : '≤'}{' '}
                          <CopperDisplay copper={rule.maxPriceCopper} />
                        </div>
                      </div>
                      <div className="ms-inline-row">
                        <button
                          type="button"
                          className="ms-btn ms-btn-ghost ms-btn-xs"
                          onClick={() =>
                            void onToggleAlert(rule.id, !rule.enabled)
                          }
                        >
                          {rule.enabled ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          className="ms-btn ms-btn-danger ms-btn-xs"
                          onClick={() => void onDeleteAlert(rule.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="ms-subpanel">
          <h3>Notification Inbox ({notifications.length})</h3>
          <div data-testid="notification-inbox">
            {notifications.length === 0 ? (
              <p className="ms-muted">No notifications yet.</p>
            ) : (
              <ul className="ms-rule-list">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`ms-rule-item ${n.read ? 'ms-notif-read' : 'ms-notif-unread'}`}
                  >
                    <div>
                      <strong>{n.itemName}</strong>{' '}
                      <span className="ms-badge">
                        {n.read ? 'Read' : 'New'}
                      </span>
                      <div className="ms-muted">
                        {n.flavor} / {n.partitionKey} / {n.faction} • Observed{' '}
                        <CopperDisplay copper={n.observedPriceCopper} /> (Target ≤{' '}
                        <CopperDisplay copper={n.thresholdPriceCopper} />)
                      </div>
                    </div>
                    {!n.read && (
                      <button
                        type="button"
                        className="ms-btn ms-btn-secondary ms-btn-xs"
                        onClick={() => void onMarkRead(n.id)}
                      >
                        Mark Read
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
