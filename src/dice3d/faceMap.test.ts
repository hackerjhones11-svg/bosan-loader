import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SYMBOL_IDS } from '../game/symbols';
import { FACE_LAYOUT, VIEW_UP_ON_TABLE, atlasUvRect, decalQuaternion, restQuaternion, upwardFace } from './faceMap';

const YAWS = [0, 0.3, -0.7, Math.PI / 2, Math.PI, -2.4];

describe('face layout', () => {
  it('puts each symbol on its own face with a perpendicular artwork-up vector', () => {
    const normals = new Set(SYMBOL_IDS.map((id) => FACE_LAYOUT[id].normal.join(',')));
    expect(normals.size).toBe(6);
    for (const id of SYMBOL_IDS) {
      const n = new Vector3(...FACE_LAYOUT[id].normal);
      const u = new Vector3(...FACE_LAYOUT[id].up);
      expect(n.length()).toBeCloseTo(1);
      expect(u.length()).toBeCloseTo(1);
      expect(n.dot(u)).toBeCloseTo(0);
    }
  });

  it('orients each decal so its normal and artwork-up match the layout', () => {
    for (const id of SYMBOL_IDS) {
      const q = decalQuaternion(id);
      const normal = new Vector3(0, 0, 1).applyQuaternion(q);
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(normal.distanceTo(new Vector3(...FACE_LAYOUT[id].normal))).toBeLessThan(1e-9);
      expect(up.distanceTo(new Vector3(...FACE_LAYOUT[id].up))).toBeLessThan(1e-9);
    }
  });

  it('gives each symbol a distinct atlas cell inside [0, 1]', () => {
    const cells = SYMBOL_IDS.map((id) => atlasUvRect(id));
    expect(new Set(cells.map((c) => `${c.u0},${c.v0}`)).size).toBe(6);
    for (const c of cells) {
      expect(c.u0).toBeGreaterThanOrEqual(0);
      expect(c.v0).toBeGreaterThanOrEqual(0);
      expect(c.u1).toBeLessThanOrEqual(1);
      expect(c.v1).toBeLessThanOrEqual(1);
      expect(c.u1).toBeGreaterThan(c.u0);
      expect(c.v1).toBeGreaterThan(c.v0);
    }
  });
});

describe('final orientation', () => {
  it('restQuaternion puts every symbol face-up, upright to the viewer, at any yaw', () => {
    for (const id of SYMBOL_IDS) {
      for (const yaw of YAWS) {
        const q = restQuaternion(id, yaw);
        const { symbol, alignment } = upwardFace(q);
        expect(symbol).toBe(id);
        expect(alignment).toBeCloseTo(1, 9);
        // Artwork top points toward screen-up (-Z), turned by exactly `yaw`.
        const expectedUp = VIEW_UP_ON_TABLE.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw);
        const up = new Vector3(...FACE_LAYOUT[id].up).applyQuaternion(q);
        expect(up.distanceTo(expectedUp)).toBeLessThan(1e-9);
      }
    }
  });
});
