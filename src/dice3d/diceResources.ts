import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SYMBOL_IDS } from '../game/symbols';
import { FACE_LAYOUT, atlasUvRect, decalQuaternion } from './faceMap';
import { DIE_HALF, DIE_SIZE } from './trayConfig';
import { DIE_IVORY, createBlobShadowTexture, createSymbolAtlas } from './textures';

const CORNER_RADIUS = 0.11;
/** The flat part of each rounded face is DIE_SIZE - 2·radius; the decal sits just inside it. */
const DECAL_SIZE = DIE_SIZE - 2 * CORNER_RADIUS - 0.01;
const DECAL_LIFT = 0.0015;

/**
 * Builds the six face decals of one die as a single geometry. Each decal is a
 * plane placed with faceMap.decalQuaternion (plane +Y = artwork up) and UVs
 * pointing at that symbol's atlas cell, so orientation comes only from FACE_LAYOUT.
 */
function createFaceGeometry(atlasCellPx: number): BufferGeometry {
  const inset = 1.5 / (atlasCellPx * 3);
  const parts = SYMBOL_IDS.map((id) => {
    const plane = new PlaneGeometry(DECAL_SIZE, DECAL_SIZE);
    const { u0, v0, u1, v1 } = atlasUvRect(id);
    const uv = plane.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + inset + uv.getX(i) * (u1 - u0 - 2 * inset), v0 + inset + uv.getY(i) * (v1 - v0 - 2 * inset));
    }
    plane.applyQuaternion(decalQuaternion(id));
    const offset = new Vector3(...FACE_LAYOUT[id].normal).multiplyScalar(DIE_HALF + DECAL_LIFT);
    plane.translate(offset.x, offset.y, offset.z);
    return plane;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('Could not build die face geometry');
  return merged;
}

export interface DiceResources {
  bodyGeometry: BufferGeometry;
  faceGeometry: BufferGeometry;
  bodyMaterial: MeshPhysicalMaterial;
  faceMaterial: MeshPhysicalMaterial;
  shadowGeometry: BufferGeometry;
  shadowMaterial: MeshBasicMaterial;
  ringGeometry: BufferGeometry;
  ringMaterial: MeshBasicMaterial;
  /** Sets the brief warm glow used to highlight a fresh result (0 = off). */
  setGlow(amount: number): void;
  dispose(): void;
}

/** Shared by all six dice: one body geometry, one face geometry, one atlas. */
export function createDiceResources(): DiceResources {
  const cellPx = 256;
  const atlas: Texture = createSymbolAtlas(cellPx);
  atlas.anisotropy = 4;
  const shadowTexture = createBlobShadowTexture();

  const common = {
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    emissive: new Color('#ffcf7a'),
    emissiveIntensity: 0,
  };
  const bodyMaterial = new MeshPhysicalMaterial({ ...common, color: new Color(DIE_IVORY) });
  const faceMaterial = new MeshPhysicalMaterial({
    ...common,
    color: new Color('#ffffff'),
    map: atlas,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const shadowGeometry = new PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    color: new Color('#04140e'),
  });

  const ringGeometry = new RingGeometry(0.8, 0.9, 48).rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({
    color: new Color('#d9b45f'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: DoubleSide,
  });

  const bodyGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, CORNER_RADIUS);
  const faceGeometry = createFaceGeometry(cellPx);

  return {
    bodyGeometry,
    faceGeometry,
    bodyMaterial,
    faceMaterial,
    shadowGeometry,
    shadowMaterial,
    ringGeometry,
    ringMaterial,
    setGlow(amount) {
      bodyMaterial.emissiveIntensity = amount;
      faceMaterial.emissiveIntensity = amount;
    },
    dispose() {
      bodyGeometry.dispose();
      faceGeometry.dispose();
      shadowGeometry.dispose();
      ringGeometry.dispose();
      bodyMaterial.dispose();
      faceMaterial.dispose();
      shadowMaterial.dispose();
      ringMaterial.dispose();
      atlas.dispose();
      shadowTexture.dispose();
    },
  };
}
