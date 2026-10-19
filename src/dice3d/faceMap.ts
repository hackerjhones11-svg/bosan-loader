import { Matrix4, Quaternion, Vector3 } from 'three';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';

/**
 * FACE MAP: the only place that decides how symbols relate to die orientation.
 * The decal mesh, the texture atlas UVs, the roll planner, the reduced-motion
 * path and the tests all read from here.
 *
 * Coordinate conventions
 * - Die-local frame: a cube of edge 1 centred on the origin, faces perpendicular
 *   to the local axes.
 * - World frame: +Y points up from the felt. The camera sits on the +Z side,
 *   looking toward -Z and down, so for a face lying flat on the felt the
 *   direction that reads as "up" on screen is world -Z (VIEW_UP_ON_TABLE).
 *
 * Per symbol (FACE_LAYOUT):
 * - `normal`: outward face normal in die-local coordinates.
 * - `up`: die-local direction toward the top edge of the artwork on that face
 *   (perpendicular to `normal`).
 * Texture orientation follows from these two: the decal for a face is a plane
 * whose local +Z is `normal` and local +Y is `up`, and its UVs map the atlas
 * cell with v increasing toward the top of the artwork.
 *
 * Final orientation
 * - restQuaternion(symbol, yaw) is the die orientation that puts `symbol`
 *   exactly face-up (normal → +Y) with its artwork upright for the viewer
 *   (up → -Z), then turned by `yaw` about world +Y.
 * - For physics-driven rolls, the planner takes the body's settled pose S and
 *   picks one of the 24 rotations that map a cube onto itself, R, so that S·R
 *   shows the target symbol on top. Because R maps the cube onto itself, the
 *   rendered cube occupies exactly the physics body's volume for the whole
 *   tumble. Only which painted face ends up where changes, so nothing ever snaps.
 */

export type Vec3Tuple = readonly [number, number, number];

export interface FaceSpec {
  readonly normal: Vec3Tuple;
  readonly up: Vec3Tuple;
}

// Opposite pairs: Jhandi/Burja (±Y), Itta/Paan (±X), Hukum/Chidi (±Z).
// Real dice vary by maker; this layout is used consistently everywhere.
export const FACE_LAYOUT: Readonly<Record<SymbolId, FaceSpec>> = {
  jhandi: { normal: [0, 1, 0], up: [0, 0, -1] },
  burja: { normal: [0, -1, 0], up: [0, 0, 1] },
  itta: { normal: [1, 0, 0], up: [0, 1, 0] },
  paan: { normal: [-1, 0, 0], up: [0, 1, 0] },
  hukum: { normal: [0, 0, 1], up: [0, 1, 0] },
  chidi: { normal: [0, 0, -1], up: [0, 1, 0] },
};

export const WORLD_UP: Readonly<Vector3> = new Vector3(0, 1, 0);
export const VIEW_UP_ON_TABLE: Readonly<Vector3> = new Vector3(0, 0, -1);

/** Orthonormal frame of a face: right × up = normal. */
export function faceFrame(symbol: SymbolId): { normal: Vector3; up: Vector3; right: Vector3 } {
  const { normal, up } = FACE_LAYOUT[symbol];
  const n = new Vector3(...normal);
  const u = new Vector3(...up);
  return { normal: n, up: u, right: new Vector3().crossVectors(u, n) };
}

/** Rotation taking a plane (normal +Z, artwork up +Y) onto the symbol's face. */
export function decalQuaternion(symbol: SymbolId): Quaternion {
  const { normal, up, right } = faceFrame(symbol);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
}

/** Die orientation with `symbol` face-up, artwork upright to the viewer, turned by `yaw` radians. */
export function restQuaternion(symbol: SymbolId, yaw = 0): Quaternion {
  const { normal, up, right } = faceFrame(symbol);
  const local = new Matrix4().makeBasis(right, up, normal);
  // Map right → +X, up → -Z (screen-up on the table), normal → +Y.
  const world = new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0));
  const base = new Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
  const turn = new Quaternion().setFromAxisAngle(WORLD_UP, yaw);
  return turn.multiply(base);
}

/** Which symbol faces up for a die orientation, and how flat it is (1 = perfectly flat). */
export function upwardFace(q: Quaternion): { symbol: SymbolId; alignment: number } {
  let best: SymbolId = SYMBOL_IDS[0];
  let alignment = -Infinity;
  const v = new Vector3();
  for (const id of SYMBOL_IDS) {
    const y = v.set(...FACE_LAYOUT[id].normal).applyQuaternion(q).y;
    if (y > alignment) {
      alignment = y;
      best = id;
    }
  }
  return { symbol: best, alignment };
}

/** How upright the face-up artwork reads to the viewer: 1 = perfectly upright, ≥ cos 45° after symmetry choice. */
export function readability(q: Quaternion, symbol: SymbolId): number {
  return new Vector3(...FACE_LAYOUT[symbol].up).applyQuaternion(q).dot(VIEW_UP_ON_TABLE);
}

/** The 24 proper rotations mapping a cube onto itself (signed permutation matrices with det +1). */
export const CUBE_SYMMETRIES: readonly Quaternion[] = (() => {
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const result: Quaternion[] = [];
  for (const perm of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const cols = perm.map((axis, c) => {
        const v = [0, 0, 0];
        v[axis] = signs & (1 << c) ? -1 : 1;
        return new Vector3(v[0], v[1], v[2]);
      });
      const m = new Matrix4().makeBasis(cols[0], cols[1], cols[2]);
      if (m.determinant() > 0) result.push(new Quaternion().setFromRotationMatrix(m));
    }
  }
  return result;
})();

const LOCAL_AXES: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/**
 * Removes residual tilt from a settled pose: finds the local axis pointing most
 * nearly up and applies the minimal rotation that makes it exactly +Y,
 * preserving yaw. For a die resting on the felt the correction is a fraction of a degree.
 */
export function snapUpright(q: Quaternion): Quaternion {
  let bestAxis = LOCAL_AXES[0];
  let bestY = -Infinity;
  const v = new Vector3();
  for (const axis of LOCAL_AXES) {
    const y = v.copy(axis).applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      bestAxis = axis;
    }
  }
  const worldAxis = bestAxis.clone().applyQuaternion(q).normalize();
  const correction = new Quaternion().setFromUnitVectors(worldAxis, WORLD_UP);
  return correction.multiply(q.clone()).normalize();
}

/**
 * For a settled, upright body orientation S, returns the cube symmetry R such
 * that S·R shows `target` face-up, choosing among the four valid options the
 * one whose artwork reads most upright from the camera.
 */
export function symmetryForTarget(settled: Quaternion, target: SymbolId): { symmetry: Quaternion; final: Quaternion } {
  let best: { symmetry: Quaternion; final: Quaternion; score: number } | null = null;
  const normal = new Vector3();
  for (const r of CUBE_SYMMETRIES) {
    const candidate = settled.clone().multiply(r);
    const y = normal.set(...FACE_LAYOUT[target].normal).applyQuaternion(candidate).y;
    if (y < 0.99) continue;
    const score = readability(candidate, target);
    if (!best || score > best.score) best = { symmetry: r.clone(), final: candidate, score };
  }
  if (!best) throw new Error('settled orientation is not upright; snapUpright() first');
  return { symmetry: best.symmetry, final: best.final };
}

// ── Texture atlas ───────────────────────────────────────────────────────────
// One canvas texture holds all six symbols in a 3 × 2 grid, row-major in
// SYMBOL_IDS order. Canvas row 0 is the top of the image; with the default
// texture flipY, v = 1 is the top edge.

export const ATLAS_COLUMNS = 3;
export const ATLAS_ROWS = 2;

export function atlasCell(symbol: SymbolId): { column: number; row: number } {
  const index = SYMBOL_IDS.indexOf(symbol);
  return { column: index % ATLAS_COLUMNS, row: Math.floor(index / ATLAS_COLUMNS) };
}

/** UV rectangle of a symbol's atlas cell; (u0, v0) is the bottom-left of the artwork. */
export function atlasUvRect(symbol: SymbolId): { u0: number; v0: number; u1: number; v1: number } {
  const { column, row } = atlasCell(symbol);
  return {
    u0: column / ATLAS_COLUMNS,
    u1: (column + 1) / ATLAS_COLUMNS,
    v0: 1 - (row + 1) / ATLAS_ROWS,
    v1: 1 - row / ATLAS_ROWS,
  };
}
