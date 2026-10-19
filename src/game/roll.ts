import { cryptoFill, secureRandomInts, type RandomFill } from './random';
import { SYMBOL_IDS, isSymbolId, type SymbolId } from './symbols';

export const DICE_COUNT = 6;

/** The upward symbol of each of the six dice, in die order (die 1 … die 6). */
export type Faces = readonly [SymbolId, SymbolId, SymbolId, SymbolId, SymbolId, SymbolId];

export type SymbolCounts = Readonly<Record<SymbolId, number>>;

/** `random` = fair crypto roll. `test` = admin-preset outcome, always disclosed. */
export type RollMode = 'random' | 'test';

/**
 * The single authoritative record of a roll. Dice animation, mat counts,
 * history and screen-reader announcements are all derived from this object.
 */
export interface RollRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly faces: Faces;
  readonly counts: SymbolCounts;
  readonly mode: RollMode;
}

export function isFaces(value: unknown): value is Faces {
  return Array.isArray(value) && value.length === DICE_COUNT && value.every(isSymbolId);
}

export function emptyCounts(): Record<SymbolId, number> {
  return { jhandi: 0, burja: 0, itta: 0, paan: 0, hukum: 0, chidi: 0 };
}

export function countFaces(faces: readonly SymbolId[]): SymbolCounts {
  const counts = emptyCounts();
  for (const face of faces) counts[face] += 1;
  return counts;
}

export function totalCount(counts: SymbolCounts): number {
  return SYMBOL_IDS.reduce((sum, id) => sum + counts[id], 0);
}

/**
 * Six independent fair dice: each face index is an unbiased draw from [0, 6)
 * mapped onto SYMBOL_IDS, so every symbol has probability exactly 1/6 per die.
 * Nothing about previous rolls or the user is consulted.
 */
export function rollFairFaces(fill: RandomFill = cryptoFill): Faces {
  const indices = secureRandomInts(DICE_COUNT, SYMBOL_IDS.length, fill);
  return indices.map((i) => SYMBOL_IDS[i]) as unknown as Faces;
}

export function makeRollId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createRollRecord(
  faces: Faces,
  mode: RollMode,
  timestamp: number = Date.now(),
  id: string = makeRollId(),
): RollRecord {
  if (!isFaces(faces)) throw new Error('A roll needs exactly six valid symbols.');
  const frozenFaces = Object.freeze([...faces]) as unknown as Faces;
  return Object.freeze({
    id,
    timestamp,
    faces: frozenFaces,
    counts: Object.freeze(countFaces(frozenFaces)),
    mode,
  });
}

/** Symbols with a nonzero count, most frequent first, ties in canonical order. */
export function rankedCounts(counts: SymbolCounts): { id: SymbolId; count: number }[] {
  return SYMBOL_IDS.filter((id) => counts[id] > 0)
    .map((id) => ({ id, count: counts[id] }))
    .sort((a, b) => b.count - a.count || SYMBOL_IDS.indexOf(a.id) - SYMBOL_IDS.indexOf(b.id));
}

/** Faces sorted into canonical symbol order, for compact readable history rows. */
export function sortedFaces(faces: Faces): SymbolId[] {
  return [...faces].sort((a, b) => SYMBOL_IDS.indexOf(a) - SYMBOL_IDS.indexOf(b));
}
