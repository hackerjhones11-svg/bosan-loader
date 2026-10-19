/**
 * Randomness for *appearance only*: launch spin, throw direction, 2D flicker.
 * Never used to choose or influence a roll outcome (see src/game/random.ts).
 */
export type VisualRandom = () => number;

export const visualRandom: VisualRandom = () => Math.random();

/** Small deterministic PRNG (mulberry32) for reproducible tests of the animation planner. */
export function seededVisualRandom(seed: number): VisualRandom {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
