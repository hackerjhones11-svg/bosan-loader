import { INK, SYMBOL_ART } from '../game/symbolArt';
import type { SymbolId } from '../game/symbols';

interface Props {
  id: SymbolId;
  size?: number | string;
  /** When given, the icon is announced with this name; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** Inline SVG rendering of the shared symbol artwork. */
export function SymbolIcon({ id, size = 32, label, className }: Props) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {SYMBOL_ART[id].map((part, i) => (
        <path key={i} d={part.d} fill={INK[part.ink]} />
      ))}
    </svg>
  );
}
