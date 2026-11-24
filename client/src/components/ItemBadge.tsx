import { useState } from 'react';
import {
  DEFAULT_ITEM_ICON,
  getItemIconUrl,
  type ItemQuality,
} from '@marketsync/shared';

interface ItemBadgeProps {
  quality: ItemQuality;
  category: string;
  isPetCage: boolean;
  icon?: string;
  iconUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}

function getCategoryGlyph(category: string, isPetCage: boolean): string {
  if (isPetCage || category === 'Battle Pets') return '🐾';
  switch (category) {
    case 'Herbs':
      return '🌿';
    case 'Consumables':
      return '⚗';
    case 'Mining':
      return '⛏';
    case 'Enchanting':
      return '✦';
    case 'Gems':
      return '◆';
    case 'Cloth':
    case 'Leather':
    case 'Trade Goods':
      return '◈';
    case 'Weapons':
      return '⚔';
    case 'Armor':
      return '🛡';
    case 'Bags':
      return '🎒';
    case 'Projectile':
      return '➤';
    default:
      return '❖';
  }
}

export function ItemBadge({
  quality,
  category,
  isPetCage,
  icon,
  iconUrl,
  size = 'md',
}: ItemBadgeProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const resolvedUrl =
    iconUrl || (icon ? getItemIconUrl(icon) : getItemIconUrl(DEFAULT_ITEM_ICON));
  const glyph = getCategoryGlyph(category, isPetCage);

  return (
    <span
      className={`ms-item-badge ms-item-badge-${size} ms-quality-border-${quality}`}
    >
      {failedUrl !== resolvedUrl && resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt=""
          className="ms-item-icon-img"
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(resolvedUrl)}
        />
      ) : (
        <span className="ms-item-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
    </span>
  );
}
