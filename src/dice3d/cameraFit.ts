import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { BASE_THICKNESS, RIM, type TrayDims } from './trayConfig';

/** Elevated view: high enough that every top face reads clearly, low enough to feel like a table. */
export const CAMERA_ELEVATION_DEG = 66;
const MARGIN_X = 0.035;
const MARGIN_Y = 0.045;

/**
 * Positions the camera so the whole tray (rim included) fills the viewport
 * with a small margin at any aspect ratio, centred on screen. Solves for
 * distance by bisection, then recentres; three passes converge.
 */
export function fitCamera(camera: PerspectiveCamera, dims: TrayDims, aspect: number): void {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const ox = dims.halfWidth + RIM.width;
  const oz = dims.halfDepth + RIM.width;
  const corners: Vector3[] = [];
  for (const x of [-ox, ox]) for (const z of [-oz, oz]) for (const y of [RIM.height, -BASE_THICKNESS]) corners.push(new Vector3(x, y, z));

  const elevation = MathUtils.degToRad(CAMERA_ELEVATION_DEG);
  const direction = new Vector3(0, Math.sin(elevation), Math.cos(elevation));
  const target = new Vector3(0, 0, 0);
  const projected = new Vector3();

  const place = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  };
  const bounds = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      projected.copy(c).project(camera);
      minX = Math.min(minX, projected.x);
      maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y);
      maxY = Math.max(maxY, projected.y);
    }
    return { minX, maxX, minY, maxY };
  };

  let distance = 20;
  for (let pass = 0; pass < 3; pass++) {
    let lo = 2;
    let hi = 120;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      place(mid);
      const b = bounds();
      const fits = b.minX >= -1 + MARGIN_X && b.maxX <= 1 - MARGIN_X && b.minY >= -1 + MARGIN_Y && b.maxY <= 1 - MARGIN_Y;
      if (fits) hi = mid;
      else lo = mid;
    }
    distance = hi;
    place(distance);
    const b = bounds();
    const centreY = (b.minY + b.maxY) / 2;
    const halfHeight = distance * Math.tan(MathUtils.degToRad(camera.fov / 2));
    const screenUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    target.addScaledVector(screenUp, centreY * halfHeight);
  }
  place(distance);
}
