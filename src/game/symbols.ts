/**
 * The six Langur Burja symbols. Every die carries exactly one of each.
 * The order of SYMBOL_IDS is the canonical display order used by the mat,
 * history summaries and help content.
 */
export const SYMBOL_IDS = ['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi'] as const;

export type SymbolId = (typeof SYMBOL_IDS)[number];

/** Ink colour family. Always paired with the symbol name so colour is never the only cue. */
export type SymbolTone = 'red' | 'black';

export interface SymbolInfo {
  readonly id: SymbolId;
  /** Romanised Nepali name, e.g. "Jhandi". */
  readonly latin: string;
  /** Devanagari name, e.g. "झण्डी". */
  readonly nepali: string;
  /** Plain English description, e.g. "Flag". */
  readonly english: string;
  readonly tone: SymbolTone;
}

export const SYMBOLS: Readonly<Record<SymbolId, SymbolInfo>> = {
  jhandi: { id: 'jhandi', latin: 'Jhandi', nepali: 'झण्डी', english: 'Flag', tone: 'red' },
  burja: { id: 'burja', latin: 'Burja', nepali: 'बुर्जा', english: 'Crown', tone: 'black' },
  itta: { id: 'itta', latin: 'Itta', nepali: 'इट्टा', english: 'Diamond', tone: 'red' },
  paan: { id: 'paan', latin: 'Paan', nepali: 'पान', english: 'Heart', tone: 'red' },
  hukum: { id: 'hukum', latin: 'Hukum', nepali: 'हुकुम', english: 'Spade', tone: 'black' },
  chidi: { id: 'chidi', latin: 'Chidi', nepali: 'चिडी', english: 'Club', tone: 'black' },
};

const SYMBOL_SET: ReadonlySet<string> = new Set(SYMBOL_IDS);

export function isSymbolId(value: unknown): value is SymbolId {
  return typeof value === 'string' && SYMBOL_SET.has(value);
}
