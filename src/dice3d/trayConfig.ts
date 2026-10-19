/**
 * Tray geometry in die units (one die edge = 1). The interior shape adapts to
 * the stage's aspect ratio so the dice stay large on both wide desktop and tall
 * phone screens. Physics walls and the rendered tray share these numbers.
 */
export const DIE_SIZE = 1;
export const DIE_HALF = DIE_SIZE / 2;

export interface TrayDims {
  /** Interior half-extent along X (left/right on screen). */
  readonly halfWidth: number;
  /** Interior half-extent along Z (depth, toward/away from camera). */
  readonly halfDepth: number;
}

export type TrayPreset = 'wide' | 'square' | 'tall';

export const TRAY_PRESETS: Readonly<Record<TrayPreset, TrayDims>> = {
  wide: { halfWidth: 5.1, halfDepth: 3.3 },
  square: { halfWidth: 4.3, halfDepth: 3.6 },
  tall: { halfWidth: 3.45, halfDepth: 4.1 },
};

export function presetForAspect(aspect: number): TrayPreset {
  if (aspect >= 1.35) return 'wide';
  if (aspect >= 1.0) return 'square';
  return 'tall';
}

/** Raised wooden rim around the felt. */
export const RIM = {
  width: 0.62,
  height: 0.72,
  cornerRadius: 0.55,
} as const;

export const BASE_THICKNESS = 0.38;
