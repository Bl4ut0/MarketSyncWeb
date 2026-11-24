import { formatCopper, splitCopper } from '@marketsync/shared';

interface CopperDisplayProps {
  copper: number;
  className?: string;
}

export function CopperDisplay({ copper, className }: CopperDisplayProps) {
  const safe = Number.isSafeInteger(copper) && copper >= 0 ? copper : 0;
  const parts = splitCopper(safe);
  const title = formatCopper(safe);

  return (
    <span className={`ms-copper ${className ?? ''}`} title={title} aria-label={title}>
      {parts.gold > 0 && (
        <span className="ms-coin ms-coin-g">
          {parts.gold.toLocaleString('en-US')}
          <span className="ms-coin-unit" aria-hidden="true">g</span>
        </span>
      )}
      {(parts.gold > 0 || parts.silver > 0) && (
        <span className="ms-coin ms-coin-s">
          {parts.gold > 0 ? String(parts.silver).padStart(2, '0') : parts.silver}
          <span className="ms-coin-unit" aria-hidden="true">s</span>
        </span>
      )}
      <span className="ms-coin ms-coin-c">
        {parts.gold > 0 || parts.silver > 0
          ? String(parts.copper).padStart(2, '0')
          : parts.copper}
        <span className="ms-coin-unit" aria-hidden="true">c</span>
      </span>
    </span>
  );
}
