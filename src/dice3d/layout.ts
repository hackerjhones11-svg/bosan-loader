import { Quaternion, Vector3 } from 'three';
import type { SymbolId } from '../game/symbols';
import { restQuaternion } from './faceMap';
import type { DiePose } from './rollPlanner';
import { DIE_HALF, type TrayDims } from './trayConfig';

/** Two yaw-rotated unit cubes on the felt cannot overlap if centres are ≥ √2 apart. */
const MIN_SEPARATION = Math.SQRT2 + 0.04;
const WALL_CLEARANCE = Math.SQRT1_2 + 0.03;

// Small fixed yaws so the resting arrangement looks placed by hand, not gridded.
const NATURAL_YAWS = [0.08, -0.12, 0.05, -0.06, 0.14, -0.1];

/** Neat 3 × 2 arrangement showing the given faces, used on first load and for recovery snaps. */
export function gridLayout(faces: readonly SymbolId[], dims: TrayDims): DiePose[] {
  const spacingX = Math.min(1.9, (dims.halfWidth * 2 - 2) / 2);
  const spacingZ = Math.min(1.9, dims.halfDepth * 2 - 2.4);
  return faces.map((face, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      position: new Vector3((col - 1) * spacingX, DIE_HALF, (row - 0.5) * spacingZ),
      quaternion: restQuaternion(face, NATURAL_YAWS[i % NATURAL_YAWS.length]),
    };
  });
}

/**
 * Moves resting dice into a (possibly smaller) tray after a resize or
 * orientation change: clamp inside the walls, then push apart any pair that
 * could overlap. Orientations are untouched, so visible faces never change.
 */
export function fitPosesToTray(poses: readonly DiePose[], dims: TrayDims): DiePose[] {
  const pts = poses.map((p) => new Vector3(p.position.x, DIE_HALF, p.position.z));
  const limitX = dims.halfWidth - WALL_CLEARANCE;
  const limitZ = dims.halfDepth - WALL_CLEARANCE;
  const clamp = (v: Vector3) => {
    v.x = Math.max(-limitX, Math.min(limitX, v.x));
    v.z = Math.max(-limitZ, Math.min(limitZ, v.z));
  };
  pts.forEach(clamp);
  for (let iteration = 0; iteration < 60; iteration++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x;
        const dz = pts[j].z - pts[i].z;
        const dist = Math.hypot(dx, dz);
        if (dist >= MIN_SEPARATION) continue;
        const push = (MIN_SEPARATION - dist) / 2 + 0.001;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        pts[i].x -= nx * push;
        pts[i].z -= nz * push;
        pts[j].x += nx * push;
        pts[j].z += nz * push;
        clamp(pts[i]);
        clamp(pts[j]);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return poses.map((p, i) => ({ position: pts[i], quaternion: p.quaternion.clone() }));
}

export function clonePoses(poses: readonly DiePose[]): DiePose[] {
  return poses.map((p) => ({ position: p.position.clone(), quaternion: (p.quaternion as Quaternion).clone() }));
}
