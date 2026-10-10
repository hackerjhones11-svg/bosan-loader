import { CAP_HEIGHT } from './glyphData';
import { WORDMARKS, type LayoutMode, type WordmarkLayout } from './layout';
import { A_BAR, H_BAR } from './parts';

/**
 * The miniature construction site, laid out around the real glyph positions.
 * Everything is in scene units (font units, ground at y = 0, y down).
 *
 * Scale reference: a worker is 180 units tall (~1.8 m), so one metre ≈ 100
 * units and the letters stand roughly 6 m tall. The truck is ~8.4 m long,
 * the tower cranes ~17–19 m to the jib.
 */

export const WORKER_HEIGHT = 180;

/** The A crossbar rests on dunnage inside the A before it is raised:
 * its underside (y = -261 when set) sits at y = -24. */
export const A_BAR_REST_DY = 261 - 24;

export interface CraneSpec {
  id: 'L' | 'R';
  mastX: number;
  /** +1 when the jib points toward +x */
  dir: 1 | -1;
  /** ground the crane stands on */
  baseY: number;
  /** y of the jib's bottom chord, where the trolley runs */
  jibY: number;
  jibLength: number;
  counterLength: number;
  /** cat head apex above the jib's bottom chord */
  headHeight: number;
  /** trolley x and hook drop while idle */
  parkX: number;
  parkDrop: number;
}

export interface WorkerSpec {
  x: number;
  y: number;
  face: 1 | -1;
}

export interface SitePlan {
  mode: LayoutMode;
  wordmark: WordmarkLayout;
  craneL: CraneSpec;
  craneR: CraneSpec;
  /** rear end x when parked / off screen; the truck faces +x */
  truck: { parkX: number; offX: number; y: number };
  /** offset of the B bowls from their final position while on the laydown */
  bowlsLaydown: { dx: number; dy: number };
  /** height the bowls are hoisted to before travelling (offset from final) */
  bowlsClearDy: number;
  /** H crossbar travel height (offset of its underside above the H top) */
  heroBridle: number;
  station: { x: number; y: number; surveyor: boolean };
  lines: { baselines: number[]; x0: number; x1: number };
  workers: {
    surveyor: WorkerSpec;
    bowls: WorkerSpec & { walkTo: number };
    aBar: WorkerSpec;
    scaffold: WorkerSpec;
    rigger: WorkerSpec;
  };
  /** composition bounds including equipment */
  extents: { x0: number; y0: number; x1: number; y1: number };
}

/** Truck geometry (local: rear end at x = 0, ground y = 0, facing +x). */
export const TRUCK = {
  length: 840,
  bedEnd: 655,
  bedTop: -118,
  cabX: 668,
  cabTop: -292,
  wheelR: 46,
  axles: [205, 305, 742],
  /** the H crossbar lies on dunnage on the deck */
  bar: { x0: 150, y1: -118 - 12 },
};

function plan(mode: LayoutMode): SitePlan {
  const wm = WORDMARKS[mode];
  const g = wm.glyphs;
  const ground = g.H.y; // HILLS sits on the ground in both layouts
  const hillsRight = g.S2.ink.x1;
  const bowlsFinalX0 = g.B.x + 204;
  const aBarCentre = g.A.x + (A_BAR[0][0] + A_BAR[1][0]) / 2;
  const hBarX0 = g.H.x + H_BAR.x0;

  if (mode === 'wide') {
    const bowlsLayX0 = g.B.ink.x0 - 500;
    const craneL: CraneSpec = {
      id: 'L',
      mastX: bowlsLayX0 - 330,
      dir: 1,
      baseY: ground,
      jibY: -1600,
      jibLength: 0,
      counterLength: 740,
      headHeight: 330,
      parkX: bowlsLayX0 + 157,
      parkDrop: 170,
    };
    craneL.jibLength = aBarCentre + 190 - craneL.mastX;

    const truckPark = hillsRight + 190;
    const craneR: CraneSpec = {
      id: 'R',
      mastX: truckPark + TRUCK.length + 290,
      dir: -1,
      baseY: ground,
      jibY: -1780,
      jibLength: 0,
      counterLength: 760,
      headHeight: 340,
      parkX: truckPark + TRUCK.bar.x0 + 183,
      parkDrop: 170,
    };
    craneR.jibLength = craneR.mastX - (hBarX0 - 30);

    const extX = Math.max(-(craneL.mastX - craneL.counterLength), craneR.mastX + craneR.counterLength) + 140;
    const gap = (g.N.ink.x1 + g.H.ink.x0) / 2;

    return {
      mode,
      wordmark: wm,
      craneL,
      craneR,
      truck: { parkX: truckPark, offX: extX + 1000, y: ground },
      bowlsLaydown: { dx: bowlsLayX0 - bowlsFinalX0, dy: -34 },
      bowlsClearDy: -654,
      heroBridle: 132,
      station: { x: gap + 70, y: ground, surveyor: true },
      lines: { baselines: [ground], x0: -extX + 220, x1: extX - 220 },
      workers: {
        surveyor: { x: gap - 50, y: ground, face: 1 },
        bowls: { x: bowlsLayX0 - 120, y: ground, face: 1, walkTo: g.B.ink.x0 - 130 },
        aBar: { x: g.A.x + 150, y: ground, face: 1 },
        scaffold: { x: g.H.x + 262, y: ground - 128, face: 1 },
        rigger: { x: truckPark + 300, y: ground, face: 1 },
      },
      extents: { x0: -extX, y0: craneR.jibY - craneR.headHeight - 40, x1: extX, y1: 70 },
    };
  }

  // Two lines: BOSAN stands on an upper level, HILLS on the ground. Crane L
  // reaches over BOSAN; crane R is a lower crane whose jib runs between the
  // lines so it can set the H crossbar.
  const upper = g.B.y;
  const bowlsLayX0 = g.H.ink.x0 - 360;
  const craneL: CraneSpec = {
    id: 'L',
    mastX: g.B.ink.x0 - 300,
    dir: 1,
    baseY: ground,
    jibY: upper - CAP_HEIGHT - 940,
    jibLength: 0,
    counterLength: 400,
    headHeight: 300,
    parkX: bowlsLayX0 + 157,
    parkDrop: 170,
  };
  craneL.jibLength = aBarCentre + 180 - craneL.mastX;

  const truckPark = hillsRight + 120;
  const craneR: CraneSpec = {
    id: 'R',
    mastX: truckPark + 600,
    dir: -1,
    baseY: ground,
    jibY: upper + 118,
    jibLength: 0,
    counterLength: 360,
    headHeight: 150,
    parkX: truckPark + TRUCK.bar.x0 + 183,
    parkDrop: 134,
  };
  craneR.jibLength = craneR.mastX - (hBarX0 - 30);

  const extX =
    Math.max(
      -(craneL.mastX - craneL.counterLength),
      craneR.mastX + craneR.counterLength,
      truckPark + TRUCK.length,
    ) + 60;

  return {
    mode,
    wordmark: wm,
    craneL,
    craneR,
    truck: { parkX: truckPark, offX: extX + 1000, y: ground },
    bowlsLaydown: { dx: bowlsLayX0 - bowlsFinalX0, dy: ground - upper - 34 },
    bowlsClearDy: -654,
    heroBridle: 70,
    station: { x: (g.I.ink.x1 + g.L1.ink.x0) / 2, y: ground, surveyor: false },
    lines: { baselines: [upper, ground], x0: -extX + 80, x1: extX - 80 },
    workers: {
      surveyor: { x: 0, y: ground, face: 1 },
      bowls: { x: bowlsLayX0 - 110, y: ground, face: 1, walkTo: bowlsLayX0 - 110 },
      aBar: { x: g.A.x + 150, y: upper, face: 1 },
      scaffold: { x: g.H.x + 262, y: ground - 128, face: 1 },
      rigger: { x: truckPark + 300, y: ground, face: 1 },
    },
    extents: { x0: -extX, y0: craneL.jibY - craneL.headHeight - 40, x1: extX, y1: 70 },
  };
}

export const SITES: Record<LayoutMode, SitePlan> = {
  wide: plan('wide'),
  stacked: plan('stacked'),
};
