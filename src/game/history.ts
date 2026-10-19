import { createRollRecord, isFaces, type RollRecord } from './roll';
import type { KeyValueStorage } from './storage';

export const HISTORY_KEY = 'langur-burja:history:v1';
export const HISTORY_LIMIT = 20;

/**
 * Stored shape. Only what is needed to rebuild a RollRecord is kept: no
 * personal data, and counts are recomputed from faces on load rather than trusted.
 */
interface StoredRoll {
  id: string;
  t: number;
  faces: string[];
  mode: 'random' | 'test';
}

interface StoredHistory {
  v: 1;
  rolls: StoredRoll[];
}

function toStored(roll: RollRecord): StoredRoll {
  return { id: roll.id, t: roll.timestamp, faces: [...roll.faces], mode: roll.mode };
}

function fromStored(value: unknown): RollRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Partial<StoredRoll>;
  if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 64) return null;
  if (typeof entry.t !== 'number' || !Number.isFinite(entry.t) || entry.t <= 0) return null;
  if (entry.mode !== 'random' && entry.mode !== 'test') return null;
  if (!isFaces(entry.faces)) return null;
  return createRollRecord(entry.faces, entry.mode, entry.t, entry.id);
}

/** Parses stored history, dropping anything malformed. Never throws. */
export function parseHistory(raw: string | null): RollRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const { v, rolls } = parsed as Partial<StoredHistory>;
  if (v !== 1 || !Array.isArray(rolls)) return [];
  const seen = new Set<string>();
  const result: RollRecord[] = [];
  for (const item of rolls) {
    const roll = fromStored(item);
    if (!roll || seen.has(roll.id)) continue;
    seen.add(roll.id);
    result.push(roll);
    if (result.length >= HISTORY_LIMIT) break;
  }
  return result;
}

export function loadHistory(storage: KeyValueStorage): RollRecord[] {
  const raw = storage.getItem(HISTORY_KEY);
  const rolls = parseHistory(raw);
  // Corrupted data is replaced with the cleaned version so the problem doesn't persist.
  if (raw !== null && rolls.length === 0) storage.removeItem(HISTORY_KEY);
  return rolls;
}

export function saveHistory(storage: KeyValueStorage, rolls: readonly RollRecord[]): void {
  const payload: StoredHistory = { v: 1, rolls: rolls.slice(0, HISTORY_LIMIT).map(toStored) };
  storage.setItem(HISTORY_KEY, JSON.stringify(payload));
}
