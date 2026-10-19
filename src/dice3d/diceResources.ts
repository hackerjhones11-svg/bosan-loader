import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SYMBOL_IDS } from '../game/symbols';
import { VISUAL_CORNER_RADIUS } from './dieCollider';
import { FACE_LAYOUT, atlasUvRect, decalQuaternion } from './faceMap';
import { DIE_HALF, DIE_SIZE } from './trayConfig';
import { DIE_IVORY, createBlobShadowTexture, createHaloTexture, createSymbolAtlas } from './textures';

/** The flat part of each rounded face is DIE_SIZE - 2·radius; the decal sits just inside it. */
const DECAL_SIZE = DIE_SIZE - 2 * VISUAL_CORNER_RADIUS - 0.01;
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

/** Per-die materials: emphasis (body edge glow, halo, contact shadow) differs die to die. */
export interface DieMaterials {
  body: MeshPhysicalMaterial;
  shadow: MeshBasicMaterial;
  halo: MeshBasicMaterial;
}

export interface DiceResources {
  bodyGeometry: BufferGeometry;
  faceGeometry: BufferGeometry;
  faceMaterial: MeshPhysicalMaterial;
  shadowGeometry: BufferGeometry;
  haloGeometry: BufferGeometry;
  perDie: DieMaterials[];
  dispose(): void;
}

/**
 * Shared by all six dice: one body geometry, one face geometry and one symbol
 * atlas. The face decals share a single material. Each die owns a cheap clone
 * of the body, shadow and halo materials, so the result emphasis (a warm glow
 * on the rounded ivory edges, never on the symbols) can differ per die.
 */
export function createDiceResources(): DiceResources {
  const cellPx = 256;
  const atlas: Texture = createSymbolAtlas(cellPx);
  atlas.anisotropy = 4;
  const shadowTexture = createBlobShadowTexture();
  const haloTexture = createHaloTexture();

  const surface = { roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.32 };
  const bodyMaterial = new MeshPhysicalMaterial({
    ...surface,
    color: new Color(DIE_IVORY),
    emissive: new Color('#f3c56f'),
    emissiveIntensity: 0,
  });
  const faceMaterial = new MeshPhysicalMaterial({
    ...surface,
    color: new Color('#ffffff'),
    map: atlas,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    color: new Color('#04140e'),
  });
  const haloMaterial = new MeshBasicMaterial({
    map: haloTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const perDie: DieMaterials[] = Array.from({ length: 6 }, () => ({
    body: bodyMaterial.clone(),
    shadow: shadowMaterial.clone(),
    halo: haloMaterial.clone(),
  }));

  const bodyGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, VISUAL_CORNER_RADIUS);
  const faceGeometry = createFaceGeometry(cellPx);
  const shadowGeometry = new PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  const haloGeometry = new PlaneGeometry(2.5, 2.5).rotateX(-Math.PI / 2);

  return {
    bodyGeometry,
    faceGeometry,
    faceMaterial,
    shadowGeometry,
    haloGeometry,
    perDie,
    dispose() {
      bodyGeometry.dispose();
      faceGeometry.dispose();
      shadowGeometry.dispose();
      haloGeometry.dispose();
      for (const m of [bodyMaterial, faceMaterial, shadowMaterial, haloMaterial]) m.dispose();
      for (const d of perDie) {
        d.body.dispose();
        d.shadow.dispose();
        d.halo.dispose();
      }
      atlas.dispose();
      shadowTexture.dispose();
      haloTexture.dispose();
    },
  };
}
