import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { INK, SYMBOL_ART } from '../game/symbolArt';
import { SYMBOL_IDS } from '../game/symbols';
import { ATLAS_COLUMNS, ATLAS_ROWS, atlasCell } from './faceMap';
import type { VisualRandom } from './visualRandom';
import { seededVisualRandom } from './visualRandom';

/** Ivory used for the die body and for the background of each face decal, so the two read as one surface. */
export const DIE_IVORY = INK.ivory;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, srgb = true): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * All six symbols in one atlas (layout defined in faceMap.ts), drawn from the
 * same path data as the UI's inline SVG.
 */
export function createSymbolAtlas(cell = 256): CanvasTexture {
  const [canvas, ctx] = makeCanvas(cell * ATLAS_COLUMNS, cell * ATLAS_ROWS);
  ctx.fillStyle = DIE_IVORY;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const artSize = cell * 0.74;
  for (const id of SYMBOL_IDS) {
    const { column, row } = atlasCell(id);
    ctx.save();
    ctx.translate(column * cell + (cell - artSize) / 2, row * cell + (cell - artSize) / 2);
    ctx.scale(artSize / 100, artSize / 100);
    for (const part of SYMBOL_ART[id]) {
      ctx.fillStyle = INK[part.ink];
      ctx.fill(new Path2D(part.d));
    }
    ctx.restore();
  }
  return finish(canvas);
}

/** Fine-grained emerald felt with soft mottling. Tiled across the tray floor. */
export function createFeltTexture(size = 256, random: VisualRandom = seededVisualRandom(7)): CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const base = [17, 84, 62];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mottle =
        Math.sin((x / size) * Math.PI * 4) * Math.sin((y / size) * Math.PI * 6) * 4 +
        Math.sin(((x + y) / size) * Math.PI * 2) * 3;
      const grain = (random() - 0.5) * 22;
      const fibre = random() < 0.035 ? 14 : 0;
      const k = (y * size + x) * 4;
      const v = mottle + grain + fibre;
      image.data[k] = Math.max(0, Math.min(255, base[0] + v * 0.55));
      image.data[k + 1] = Math.max(0, Math.min(255, base[1] + v));
      image.data[k + 2] = Math.max(0, Math.min(255, base[2] + v * 0.8));
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = finish(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Warm walnut grain: long wavy streaks over a base gradient. */
export function createWoodTexture(random: VisualRandom = seededVisualRandom(11)): CanvasTexture {
  const width = 1024;
  const height = 256;
  const [canvas, ctx] = makeCanvas(width, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#6a3a1f');
  gradient.addColorStop(0.5, '#7b4526');
  gradient.addColorStop(1, '#63361d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 140; i++) {
    const y0 = random() * height;
    const amp = 2 + random() * 6;
    const freq = 0.004 + random() * 0.01;
    const phase = random() * Math.PI * 2;
    const dark = random() < 0.6;
    ctx.strokeStyle = dark ? `rgba(38, 18, 8, ${0.08 + random() * 0.22})` : `rgba(176, 116, 70, ${0.05 + random() * 0.12})`;
    ctx.lineWidth = 0.6 + random() * 2.2;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.25;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = finish(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Soft radial blob for contact shadows under each die. Alpha-only, so not colour-managed. */
export function createBlobShadowTexture(size = 128): CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas, false);
}

/**
 * Soft warm glow for the result halo under matching dice: a gentle radial
 * falloff rather than a ring, so it reads as light on the felt.
 */
export function createHaloTexture(size = 128): CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 216, 150, 0.85)');
  g.addColorStop(0.38, 'rgba(240, 190, 105, 0.55)');
  g.addColorStop(0.7, 'rgba(214, 160, 80, 0.16)');
  g.addColorStop(1, 'rgba(200, 150, 70, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

export function disposeTextures(...textures: (Texture | null | undefined)[]): void {
  for (const t of textures) t?.dispose();
}
