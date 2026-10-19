import { useEffect, useMemo } from 'react';
import { Color, ExtrudeGeometry, MeshStandardMaterial, PlaneGeometry, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import { createFeltTexture, createWoodTexture } from './textures';
import { BASE_THICKNESS, RIM, type TrayDims } from './trayConfig';

function roundedRect(shape: Shape, hw: number, hd: number, r: number): Shape {
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return shape;
}

const BEVEL = 0.06;

/** Shape-plane (x, y) → world (x, z), extrusion → world +Y. */
function layFlat<T extends BufferGeometry>(geometry: T): T {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function buildTray(dims: TrayDims) {
  const { halfWidth: hw, halfDepth: hd } = dims;
  const ow = hw + RIM.width;
  const od = hd + RIM.width;

  // Raised rim: a rounded outer frame with a rectangular hole. ExtrudeGeometry's
  // bevel shrinks holes, so the hole is cut BEVEL larger to keep the inner wall
  // exactly on the physics wall plane.
  const rimShape = roundedRect(new Shape(), ow - BEVEL, od - BEVEL, RIM.cornerRadius);
  rimShape.holes.push(roundedRect(new Shape(), hw + BEVEL, hd + BEVEL, 0.12));
  const rim = layFlat(
    new ExtrudeGeometry(rimShape, {
      depth: RIM.height - 2 * BEVEL,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 3,
      curveSegments: 10,
    }),
  );
  rim.translate(0, BEVEL, 0);

  const base = layFlat(
    new ExtrudeGeometry(roundedRect(new Shape(), ow + 0.12, od + 0.12, RIM.cornerRadius + 0.1), {
      depth: BASE_THICKNESS - 0.08,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 10,
    }),
  );
  // Top sits just under the felt plane to avoid z-fighting.
  base.translate(0, -BASE_THICKNESS + 0.03, 0);

  const felt = new PlaneGeometry(hw * 2 + 0.2, hd * 2 + 0.2).rotateX(-Math.PI / 2);

  // Thin antique-gold inlay on the rim top, just outside the felt.
  const inlayShape = roundedRect(new Shape(), hw + 0.2, hd + 0.2, 0.16);
  inlayShape.holes.push(roundedRect(new Shape(), hw + 0.165, hd + 0.165, 0.13));
  const inlay = layFlat(new ShapeGeometry(inlayShape, 8));
  inlay.translate(0, RIM.height + 0.003, 0);

  return { rim, base, felt, inlay };
}

export function Tray({ dims }: { dims: TrayDims }) {
  const materials = useMemo(() => {
    const felt = createFeltTexture();
    const wood = createWoodTexture();
    wood.repeat.set(0.11, 0.42);
    const woodDark = wood.clone();
    woodDark.repeat.set(0.09, 0.3);
    return {
      textures: [felt, wood, woodDark],
      felt: new MeshStandardMaterial({ map: felt, roughness: 0.96, metalness: 0, color: new Color('#ffffff') }),
      rim: new MeshStandardMaterial({ map: wood, roughness: 0.48, metalness: 0.02 }),
      base: new MeshStandardMaterial({ map: woodDark, roughness: 0.6, color: new Color('#a07a62') }),
      inlay: new MeshStandardMaterial({ color: new Color('#b8954e'), roughness: 0.32, metalness: 0.75 }),
    };
  }, []);

  const geometry = useMemo(() => buildTray(dims), [dims]);

  useEffect(() => {
    materials.textures[0].repeat.set(dims.halfWidth / 1.6, dims.halfDepth / 1.6);
  }, [dims, materials]);

  useEffect(
    () => () => {
      geometry.rim.dispose();
      geometry.base.dispose();
      geometry.felt.dispose();
      geometry.inlay.dispose();
    },
    [geometry],
  );

  useEffect(
    () => () => {
      for (const t of materials.textures) t.dispose();
      materials.felt.dispose();
      materials.rim.dispose();
      materials.base.dispose();
      materials.inlay.dispose();
    },
    [materials],
  );

  return (
    <group>
      <mesh geometry={geometry.felt} material={materials.felt} receiveShadow />
      <mesh geometry={geometry.rim} material={materials.rim} castShadow receiveShadow />
      <mesh geometry={geometry.base} material={materials.base} receiveShadow />
      <mesh geometry={geometry.inlay} material={materials.inlay} />
    </group>
  );
}
