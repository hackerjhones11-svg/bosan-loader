/**
 * Cryptographically secure, unbiased integer generation for game outcomes.
 *
 * Outcomes are drawn from crypto.getRandomValues as uint32 words. Taking
 * `word % n` directly is biased whenever 2^32 is not a multiple of n (for
 * n = 6, values 0-3 would be very slightly favoured). Rejection sampling
 * fixes this: any word at or above the largest multiple of n that fits in
 * 2^32 is discarded and redrawn, so every accepted residue is equally likely.
 *
 * Math.random is never used here.
 */

/** Fills the array with uniformly random uint32 values. Injectable for tests. */
export type RandomFill = (target: Uint32Array<ArrayBuffer>) => void;

export const UINT32_RANGE = 2 ** 32;

export const cryptoFill: RandomFill = (target) => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    // Never fall back to a weaker generator for outcomes.
    throw new Error('Secure random numbers are unavailable (crypto.getRandomValues missing).');
  }
  cryptoApi.getRandomValues(target);
};

/** Largest exclusive bound below which uint32 words map uniformly onto [0, n). */
export function rejectionLimit(maxExclusive: number): number {
  return UINT32_RANGE - (UINT32_RANGE % maxExclusive);
}

function assertBound(maxExclusive: number): void {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`);
  }
}

/**
 * Returns `count` independent, uniform integers in [0, maxExclusive).
 * Words are requested in batches; rejected words simply trigger another batch.
 */
export function secureRandomInts(count: number, maxExclusive: number, fill: RandomFill = cryptoFill): number[] {
  assertBound(maxExclusive);
  const limit = rejectionLimit(maxExclusive);
  const out: number[] = [];
  // Rejection probability is < 1e-9 for small n; the cap only guards a broken source.
  let batches = 0;
  while (out.length < count) {
    if (++batches > 1000) throw new Error('Random source repeatedly produced out-of-range values.');
    const words = new Uint32Array(count - out.length);
    fill(words);
    for (const word of words) {
      if (word < limit) out.push(word % maxExclusive);
    }
  }
  return out;
}

export function secureRandomInt(maxExclusive: number, fill: RandomFill = cryptoFill): number {
  return secureRandomInts(1, maxExclusive, fill)[0];
}
