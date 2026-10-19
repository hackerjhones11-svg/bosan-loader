import { ConvexPolyhedron, Vec3 } from 'cannon-es';
import { DIE_HALF } from './trayConfig';

/**
 * Collision hull for one die: a cube with every edge and corner chamfered,
 * sized to wrap the rendered rounded cube (corner radius r) as tightly as a
 * flat-faced hull can. Cutting r·(2 − √2) from each edge makes every 45°
 * bevel tangent to the visual rounding (the bevel plane x + y = 2h − c is at
 * distance r from the rounding's axis), so dice touch where they appear to
 * touch, and the bevels let them tip and roll like real rounded dice.
 *
 * Faces are generated from their outward normals: 6 axis faces, 12 edge
 * bevels and 8 corner triangles. For each normal we take the vertices that
 * maximise the dot product (its support set) and order them counter-clockwise
 * seen from outside, which is the winding cannon-es expects.
 */
export const VISUAL_CORNER_RADIUS = 0.11;

export function chamferForRadius(radius: number): number {
  return radius * (2 - Math.SQRT2);
}

export function createDieShape(half = DIE_HALF, chamfer = chamferForRadius(VISUAL_CORNER_RADIUS)): ConvexPolyhedron {
  const inner = half - chamfer;
  const vertices: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        vertices.push(new Vec3(sx * half, sy * inner, sz * inner));
        vertices.push(new Vec3(sx * inner, sy * half, sz * inner));
        vertices.push(new Vec3(sx * inner, sy * inner, sz * half));
      }
    }
  }

  const normals: Vec3[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      const v = [0, 0, 0];
      v[axis] = s;
      normals.push(new Vec3(v[0], v[1], v[2]));
    }
  }
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const v = [0, 0, 0];
        v[a] = sa;
        v[b] = sb;
        normals.push(new Vec3(v[0], v[1], v[2]).unit());
      }
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) normals.push(new Vec3(sx, sy, sz).unit());

  const faces = normals.map((n) => {
    const dots = vertices.map((v) => v.dot(n));
    const max = Math.max(...dots);
    const ids = dots.flatMap((d, i) => (d > max - 1e-9 ? [i] : []));
    const centre = new Vec3();
    for (const i of ids) centre.vadd(vertices[i], centre);
    centre.scale(1 / ids.length, centre);
    // Right-handed basis (u, w) in the face plane; increasing atan2 is CCW about n.
    const u = vertices[ids[0]].vsub(centre).unit();
    const w = n.cross(u);
    return ids
      .map((i) => {
        const d = vertices[i].vsub(centre);
        return { i, angle: Math.atan2(d.dot(w), d.dot(u)) };
      })
      .sort((a, b) => a.angle - b.angle)
      .map((e) => e.i);
  });

  // Separating-axis tests only need one normal per direction: 3 + 6 + 4 = 13.
  const axes = normals.filter((n) => n.x > 1e-9 || (Math.abs(n.x) < 1e-9 && (n.y > 1e-9 || (Math.abs(n.y) < 1e-9 && n.z > 0))));
  return new ConvexPolyhedron({ vertices, faces, axes });
}
