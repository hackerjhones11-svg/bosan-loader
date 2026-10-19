import { Body, ContactMaterial, GSSolver, Material, NaiveBroadphase, Plane, Vec3, World, type ContactEquation } from 'cannon-es';
import { Quaternion, Vector3 } from 'three';
import type { Faces } from '../game/roll';
import { ROLL_TIMING } from '../game/rollTiming';
import { createDieShape } from './dieCollider';
import { FACE_LAYOUT, upwardFace } from './faceMap';
import { createShake, type Shake } from './shake';
import { DIE_HALF, type TrayDims } from './trayConfig';
import { visualRandom, type VisualRandom } from './visualRandom';

/**
 * Live physics for one roll of six dice in a shaken tray.
 *
 * The world is simulated in TRAY SPACE: walls and felt are static, and the
 * hands shaking the tray appear as one shared pseudo-force −m·a(t) on every
 * die (see shake.ts). Dice are dynamic rigid bodies with chamfered hulls.
 *
 * The outcome is decided before this runs (crypto, in the store). Dice start
 * where they rest, showing the previous result, so the physical trajectory
 * itself must finish on the recorded faces; nothing is relabelled or swapped.
 * That is the job of the final-settling controller, active only after the
 * shake stops (ROLL_TIMING.steerFrom):
 *
 * - A die landing flat with its recorded face up while it is slowing down
 *   is "caught": most of its remaining spin is absorbed, as felt does, and
 *   extra rolling resistance keeps it from tipping again (it can still slide
 *   if bumped).
 * - A die landing flat on a wrong face is given its last tumble toward the
 *   right face: the angular velocity is turned toward the tipping axis that
 *   brings the recorded face up, with just enough speed to roll over one
 *   edge. This only happens at a landing or impact, when a real die's
 *   motion changes anyway, and the speed is similar to what it already has.
 * - A die that comes to rest cocked against a wall or another die, or on top
 *   of one, gets a small nudge so it slides off and settles again.
 * - Bounded recovery: after a few attempts, or at ROLL_TIMING.recoverFrom,
 *   an unresolved die rolls over its edge(s) to the recorded face along a
 *   scripted but physically shaped path (pivoting over an edge, centre
 *   rising and falling), and by ROLL_TIMING.hardStop everything is resolved.
 *
 * Every step is recorded, so rendering interpolates samples at any frame
 * rate, and fast-forwarding (tab hidden, tests) uses exactly the same code.
 */

export const PHYSICS = {
  gravity: 80,
  step: 1 / 180,
  solverIterations: 14,
  /** Invisible lid so a hard jolt can never throw a die out of the tray. */
  lidHeight: 3.4,
  feltFriction: 0.36,
  feltRestitution: 0.2,
  wallFriction: 0.12,
  wallRestitution: 0.42,
  dieFriction: 0.16,
  dieRestitution: 0.36,
  linearDamping: 0.04,
  angularDamping: 0.06,
  /** Peak stroke acceleration as a multiple of gravity. */
  shakeStrength: 1.75,
} as const;

/** Controller thresholds (die units, radians, seconds). */
const CONTROL = {
  /** A die is "lying on a face" when that face's normal is this close to vertical… */
  flat: 0.985,
  /** …and its centre is this close to the felt. */
  onFeltHeight: DIE_HALF + 0.06,
  /** Decisions happen only at a settled landing: below these speeds, not bouncing. */
  decideSpeed: 9,
  decideSpin: 14,
  decideBounce: 0.6,
  /** Measured reliable band for exactly one edge is ~1.3–1.5× the theoretical minimum. */
  tumbleMargin: 1.34,
  tumbleJitter: 0.08,
  /** A tumble may not turn a moving die by more than this (radians)… */
  maxTurn: (95 * Math.PI) / 180,
  /** …unless it is moving slower than this. */
  turnFreeSpeed: 1.0,
  /**
   * Where the centre lands after a tumble (one die-width on) must be at least
   * half a die from each wall plane (a die may come to rest flush against
   * the rim; the edge it pivots over never sweeps past the landing
   * footprint) and this far from any die that is itself settling.
   */
  wallRoom: DIE_HALF - 0.02,
  dieRoom: 1.12,
  /** Dice slower than this also block their current spot (faster ones only their projected one). */
  obstacleSpeed: 1.5,
  /** Typical time from starting a tumble to landing (plans must finish before recovery). */
  tumbleTime: 0.28,
  /** A steered tumble is judged again once it has landed, or after this long. */
  tumbleTimeout: 0.8,
  /** Cocked or stacked: nearly still while not lying flat on the felt, for this long. */
  cockedHold: 0.1,
  maxNudges: 2,
  nudgeCooldown: 0.35,
  /** Resting on the right face: below these speeds and this flat, for `restSteps`. */
  restSpeed: 0.12,
  restSpin: 0.25,
  restAlign: 0.995,
  restSteps: 6,
  /** All six resting this long ends the roll. */
  restHold: 0.08,
  /** Duration of the scripted recovery roll, per quarter turn. */
  recoveryQuarter: 0.2,
} as const;

export type ImpactSurface = 'die' | 'wall' | 'felt';

export interface ImpactEvent {
  /** Simulation time of the contact (s). */
  readonly t: number;
  readonly die: number;
  readonly strength: number;
  readonly surface: ImpactSurface;
}

export interface DiePose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface SimulationStats {
  steeredTumbles: number;
  caught: number;
  nudges: number;
  scriptedRecoveries: number;
}

type DieStatus = 'free' | 'tumbling' | 'caught' | 'scripted';

interface Scripted {
  start: number;
  duration: number;
  fromP: Vector3;
  fromQ: Quaternion;
  toP: Vector3;
  toQ: Quaternion;
  startMargin: number;
}

interface DieControl {
  status: DieStatus;
  tumbles: number;
  nudges: number;
  /** Time the current steered tumble began; it has "left" once the die tilts away. */
  tumbleAt: number;
  leftFlat: boolean;
  /** Where the recorded face should be after the current tumble (1 up, 0 side, −1 down); diagnostics. */
  expectUp: number;
  nudgeAt: number;
  lastImpact: number;
  cockedSince: number | null;
  restSteps: number;
  scripted: Scripted | null;
}

export interface SimulationOptions {
  random?: VisualRandom;
  timing?: typeof ROLL_TIMING;
  /** Testing hook: disable the outcome controller to observe free physics. */
  steering?: boolean;
  /** Diagnostics hook: controller decisions. */
  onControl?: (event: { t: number; die: number; kind: string; detail?: string }) => void;
}

const UP = new Vector3(0, 1, 0);
/** Seconds past hardStop after which a roll is finished outright, whatever its state. */
const ABSOLUTE_GRACE = 1.2;

/** Hull vertices of a die, for exact ground contact during scripted moves. */
const HULL = createDieShape().vertices.map((v) => new Vector3(v.x, v.y, v.z));
/** Largest distance from a die's centre to its hull: the radius it sweeps when turning. */
const SWEEP_MARGIN = Math.max(...HULL.map((v) => v.length())) + 0.01;
const SIDE_AXES = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];
const tmpV = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();

export class DiceSimulation {
  readonly faces: Faces;
  readonly dims: TrayDims;
  readonly shake: Shake;
  readonly timing: typeof ROLL_TIMING;
  readonly step = PHYSICS.step;
  readonly stats: SimulationStats = { steeredTumbles: 0, caught: 0, nudges: 0, scriptedRecoveries: 0 };
  /** Every collision worth hearing, in time order. */
  readonly impacts: ImpactEvent[] = [];

  time = 0;
  /** Simulation time at which all six dice were confirmed at rest on their faces. */
  restAt: number | null = null;

  private readonly world: World;
  private readonly bodies: Body[];
  private readonly control: DieControl[];
  private readonly random: VisualRandom;
  private readonly steering: boolean;
  private readonly onControl?: SimulationOptions['onControl'];
  private readonly maxSamples: number;
  private readonly tracks: Float32Array[];
  private readonly agitation: Float32Array;
  private readonly sliding: Float32Array;
  private samples = 0;
  private restSince: number | null = null;
  private readonly accel = { x: 0, y: 0, z: 0 };
  private readonly targetNormals: Vector3[];

  constructor(faces: Faces, dims: TrayDims, start: readonly DiePose[], options: SimulationOptions = {}) {
    this.faces = faces;
    this.dims = dims;
    this.random = options.random ?? visualRandom;
    this.timing = options.timing ?? ROLL_TIMING;
    this.steering = options.steering ?? true;
    this.onControl = options.onControl;
    this.shake = createShake(dims, this.random, { gravity: PHYSICS.gravity, strength: PHYSICS.shakeStrength, timing: this.timing });
    this.targetNormals = faces.map((f) => new Vector3(...FACE_LAYOUT[f].normal));

    const world = new World({ gravity: new Vec3(0, -PHYSICS.gravity, 0), allowSleep: false });
    world.broadphase = new NaiveBroadphase();
    const solver = new GSSolver();
    solver.iterations = PHYSICS.solverIterations;
    world.solver = solver;

    const dieMat = new Material('die');
    const feltMat = new Material('felt');
    const wallMat = new Material('wall');
    world.addContactMaterial(
      new ContactMaterial(dieMat, feltMat, { friction: PHYSICS.feltFriction, restitution: PHYSICS.feltRestitution }),
    );
    world.addContactMaterial(
      new ContactMaterial(dieMat, wallMat, { friction: PHYSICS.wallFriction, restitution: PHYSICS.wallRestitution }),
    );
    world.addContactMaterial(
      new ContactMaterial(dieMat, dieMat, { friction: PHYSICS.dieFriction, restitution: PHYSICS.dieRestitution }),
    );

    const plane = (material: Material, position: Vec3, axis: Vec3, angle: number) => {
      const body = new Body({ mass: 0, material, shape: new Plane() });
      body.position.copy(position);
      body.quaternion.setFromAxisAngle(axis, angle);
      world.addBody(body);
      return body;
    };
    const X = new Vec3(1, 0, 0);
    const Y = new Vec3(0, 1, 0);
    const felt = plane(feltMat, new Vec3(0, 0, 0), X, -Math.PI / 2);
    const walls = new Set<Body>([
      plane(wallMat, new Vec3(-dims.halfWidth, 0, 0), Y, Math.PI / 2),
      plane(wallMat, new Vec3(dims.halfWidth, 0, 0), Y, -Math.PI / 2),
      plane(wallMat, new Vec3(0, 0, -dims.halfDepth), Y, 0),
      plane(wallMat, new Vec3(0, 0, dims.halfDepth), Y, Math.PI),
      plane(wallMat, new Vec3(0, PHYSICS.lidHeight, 0), X, Math.PI / 2),
    ]);

    const shape = createDieShape();
    this.bodies = start.map((pose, i) => {
      const body = new Body({
        mass: 1,
        material: dieMat,
        shape,
        linearDamping: PHYSICS.linearDamping,
        angularDamping: PHYSICS.angularDamping,
      });
      body.position.set(pose.position.x, Math.max(pose.position.y, DIE_HALF), pose.position.z);
      body.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
      body.addEventListener('collide', (event: { body: Body; contact: ContactEquation }) => {
        const other = event.body;
        const j = this.bodies.indexOf(other);
        const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
        this.control[i].lastImpact = this.time;
        if (j !== -1) this.control[j].lastImpact = this.time;
        // Die-die contacts are reported to both bodies; record one.
        if (j !== -1 && j < i) return;
        if (strength < 0.5) return;
        const surface: ImpactSurface = j !== -1 ? 'die' : other === felt ? 'felt' : walls.has(other) ? 'wall' : 'wall';
        this.impacts.push({ t: this.time, die: i, strength, surface });
      });
      world.addBody(body);
      return body;
    });
    this.world = world;
    this.control = this.bodies.map(() => ({
      status: 'free',
      tumbles: 0,
      nudges: 0,
      tumbleAt: -1,
      leftFlat: false,
      expectUp: 0,
      nudgeAt: -1,
      lastImpact: -1,
      cockedSince: null,
      restSteps: 0,
      scripted: null,
    }));

    // Not every die is lifted by the hands in the same way: small, different
    // starting spins and slides so six dice never move as one block.
    for (const body of this.bodies) {
      const spin = 2 + this.random() * 5;
      const ax = this.random() - 0.5;
      const ay = this.random() - 0.5;
      const az = this.random() - 0.5;
      const len = Math.hypot(ax, ay, az) || 1;
      body.angularVelocity.set((ax / len) * spin, (ay / len) * spin, (az / len) * spin);
      const heading = this.random() * Math.PI * 2;
      const push = 0.6 + this.random() * 1.6;
      body.velocity.set(Math.cos(heading) * push, 0.8 + this.random() * 1.8, Math.sin(heading) * push);
    }

    this.maxSamples = Math.ceil((this.timing.hardStop + 2) / this.step) + 2;
    this.tracks = this.bodies.map(() => new Float32Array(this.maxSamples * 7));
    this.agitation = new Float32Array(this.maxSamples);
    this.sliding = new Float32Array(this.maxSamples);
    this.record();
  }

  get done(): boolean {
    return this.restAt !== null;
  }

  /** Number of recorded samples (time of the last one is (count − 1)·step). */
  get sampleCount(): number {
    return this.samples;
  }

  private record(): void {
    if (this.samples >= this.maxSamples) return;
    const k = this.samples;
    let agitation = 0;
    let sliding = 0;
    this.bodies.forEach((b, i) => {
      const o = k * 7;
      const track = this.tracks[i];
      track[o] = b.position.x;
      track[o + 1] = b.position.y;
      track[o + 2] = b.position.z;
      track[o + 3] = b.quaternion.x;
      track[o + 4] = b.quaternion.y;
      track[o + 5] = b.quaternion.z;
      track[o + 6] = b.quaternion.w;
      const speed = b.velocity.length();
      agitation += speed + b.angularVelocity.length() * 0.35;
      if (b.position.y < DIE_HALF + 0.12) sliding += Math.hypot(b.velocity.x, b.velocity.z);
    });
    this.agitation[k] = Math.min(1, agitation / 60);
    this.sliding[k] = Math.min(1, sliding / 40);
    this.samples += 1;
  }

  /** Advances by one fixed step. */
  stepOnce(): void {
    if (this.done) return;
    const t = this.time;
    const shaking = t < this.timing.shakeEnd + this.timing.shakeFade;
    if (shaking) {
      this.shake.accel(t, this.accel);
      for (const body of this.bodies) {
        if (body.type !== Body.DYNAMIC) continue;
        body.force.x -= body.mass * this.accel.x;
        body.force.y -= body.mass * this.accel.y;
        body.force.z -= body.mass * this.accel.z;
      }
    }
    for (let i = 0; i < 6; i++) if (this.control[i].scripted) this.driveScripted(i, t + this.step);

    this.world.step(this.step);
    this.time += this.step;

    if (this.steering && this.time >= this.timing.steerFrom) this.control.forEach((_, i) => this.controlDie(i));
    else if (!this.steering) this.checkFreeRest();
    if (this.steering) this.checkRest();
    this.record();
    // Absolute bound (never expected): recovery moves take well under a second.
    if (!this.done && this.time > this.timing.hardStop + ABSOLUTE_GRACE) this.forceFinish();
  }

  /**
   * Steps until simulation time reaches `t`, giving up when `deadline`
   * (a performance.now() value) passes, so a frame never stalls on physics.
   */
  advanceTo(t: number, deadline = Infinity): void {
    let n = 0;
    while (!this.done && this.time < t) {
      this.stepOnce();
      n += 1;
      if ((n & 7) === 0 && performance.now() > deadline) break;
    }
  }

  /** Fast-forwards to the end (always terminates: see ABSOLUTE_GRACE). */
  runToEnd(): void {
    while (!this.done) this.stepOnce();
  }

  /** Interpolated pose of die `i` at time `t` (clamped to the recorded range). */
  sample(i: number, t: number, outP: Vector3, outQ: Quaternion): void {
    const track = this.tracks[i];
    const f = Math.min(Math.max(t, 0) / this.step, this.samples - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, this.samples - 1);
    const frac = f - i0;
    const a = i0 * 7;
    const b = i1 * 7;
    outP.set(
      track[a] + (track[b] - track[a]) * frac,
      track[a + 1] + (track[b + 1] - track[a + 1]) * frac,
      track[a + 2] + (track[b + 2] - track[a + 2]) * frac,
    );
    outQ.set(track[a + 3], track[a + 4], track[a + 5], track[a + 6]);
    if (frac > 0) {
      tmpQ2.set(track[b + 3], track[b + 4], track[b + 5], track[b + 6]);
      outQ.slerp(tmpQ2, frac);
    }
  }

  /** Audio texture levels (0..1) at time t. */
  activity(t: number): { rattle: number; slide: number } {
    const k = Math.min(Math.max(0, Math.round(t / this.step)), this.samples - 1);
    return { rattle: this.agitation[k], slide: this.sliding[k] };
  }

  /**
   * Dice whose resting top face is not the recorded one, or not lying flat.
   * Always empty by construction; checked again before anything is revealed.
   */
  wrongDice(): number[] {
    return this.bodies.flatMap((_, i) => (this.targetNormal(i).y > CONTROL.restAlign ? [] : [i]));
  }

  /** Defensive path: send the given dice through the recovery roll and keep simulating. */
  repair(dice: readonly number[]): void {
    if (!dice.length) return;
    this.restAt = null;
    this.restSince = null;
    for (const i of dice) if (!this.control[i].scripted) this.beginScripted(i, 'repair');
  }

  /** Distance each die's centre travelled across the felt (diagnostics). */
  pathLengths(): number[] {
    return this.tracks.map((track) => {
      let length = 0;
      for (let k = 1; k < this.samples; k++) {
        const a = (k - 1) * 7;
        const b = k * 7;
        length += Math.hypot(track[b] - track[a], track[b + 2] - track[a + 2]);
      }
      return length;
    });
  }

  /** Final resting poses (valid once done). */
  finalPoses(): DiePose[] {
    return this.bodies.map((b) => ({
      position: new Vector3(b.position.x, b.position.y, b.position.z),
      quaternion: new Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w),
    }));
  }

  // ── Controller ────────────────────────────────────────────────────────

  private bodyQuat(i: number, out = tmpQ): Quaternion {
    const q = this.bodies[i].quaternion;
    return out.set(q.x, q.y, q.z, q.w);
  }

  /** World-space normal of die i's recorded face. */
  private targetNormal(i: number, out = tmpV): Vector3 {
    return out.copy(this.targetNormals[i]).applyQuaternion(this.bodyQuat(i));
  }

  private controlDie(i: number): void {
    const c = this.control[i];
    if (c.scripted) return;
    const body = this.bodies[i];
    const t = this.time;
    const timing = this.timing;
    const { alignment } = upwardFace(this.bodyQuat(i));
    const targetUp = this.targetNormal(i).y;
    const speed = body.velocity.length();
    const spin = body.angularVelocity.length();
    const flatOnFelt = alignment > CONTROL.flat && body.position.y < CONTROL.onFeltHeight;
    const correct = targetUp > CONTROL.flat;

    // Resting bookkeeping: the roll ends when all six rest on their faces.
    const resting = correct && targetUp > CONTROL.restAlign && flatOnFelt && speed < CONTROL.restSpeed && spin < CONTROL.restSpin;
    c.restSteps = resting ? c.restSteps + 1 : 0;

    if (c.status === 'caught') {
      if (targetUp < 0.9) {
        // Knocked over by another die: back into play.
        this.onControl?.({ t, die: i, kind: 'knocked' });
        c.status = 'free';
        body.angularDamping = PHYSICS.angularDamping;
        body.linearDamping = PHYSICS.linearDamping;
      }
      return;
    }

    if (c.status === 'tumbling') {
      if (!c.leftFlat && alignment < 0.95) c.leftFlat = true;
      // Landed after tipping over, or the tip was stopped (e.g. by a neighbour) and it is flat again.
      const elapsed = t - c.tumbleAt;
      const landed = flatOnFelt && (c.leftFlat || elapsed > 0.3);
      if (!landed && elapsed < CONTROL.tumbleTimeout) return;
      if (this.onControl) {
        const got = targetUp > 0.7 ? 1 : targetUp < -0.7 ? -1 : 0;
        this.onControl({ t, die: i, kind: 'landed', detail: landed ? (got === c.expectUp ? 'as-planned' : `off-plan(${c.leftFlat ? 'tipped' : 'no-tip'})`) : 'timeout' });
      }
      c.status = 'free';
    }

    if (t >= timing.settleAssistFrom) {
      // Stragglers skid to a stop a little sooner so the roll ends on time.
      body.linearDamping = Math.min(0.4, PHYSICS.linearDamping + (t - timing.settleAssistFrom) * 0.5);
    }

    // Cocked against a wall or die, or lying on another die.
    const nearlyStill = speed < 0.2 && spin < 0.4;
    if (nearlyStill && !flatOnFelt) c.cockedSince ??= t;
    else c.cockedSince = null;
    if (c.cockedSince !== null && t - c.cockedSince >= CONTROL.cockedHold) {
      c.cockedSince = null;
      if (c.nudges >= CONTROL.maxNudges || t >= timing.recoverFrom) this.beginScripted(i, 'cocked');
      else if (t - c.nudgeAt > CONTROL.nudgeCooldown) this.nudge(i, body.position.y > CONTROL.onFeltHeight + 0.1 ? 'stacked' : 'cocked');
      return;
    }

    // Late and still on a wrong face: bounded recovery. (A die already showing
    // its face but still rocking is left to settle; cocked dice are handled above.)
    if (t >= timing.recoverFrom && targetUp < 0.9) {
      this.beginScripted(i, flatOnFelt ? 'late-flat-wrong' : 'late-moving');
      return;
    }

    // Decide only at a settled landing.
    if (!flatOnFelt || speed > CONTROL.decideSpeed || spin > CONTROL.decideSpin || Math.abs(body.velocity.y) > CONTROL.decideBounce) {
      return;
    }
    if (correct) {
      this.catchDie(i);
      return;
    }
    this.steerTumble(i);
  }

  private catchDie(i: number): void {
    const body = this.bodies[i];
    const c = this.control[i];
    // Felt swallows most of a landing die's spin; keep a little sliding.
    body.angularVelocity.x *= 0.2;
    body.angularVelocity.z *= 0.2;
    body.angularVelocity.y *= 0.5;
    body.velocity.x *= 0.65;
    body.velocity.z *= 0.65;
    if (body.velocity.y > 0) body.velocity.y *= 0.3;
    body.angularDamping = 0.85;
    body.linearDamping = 0.35;
    c.status = 'caught';
    this.stats.caught += 1;
    this.onControl?.({ t: this.time, die: i, kind: 'catch' });
  }

  /**
   * Plans the die's remaining tumbles. A die can only tip over the edge under
   * one of its four side faces, and each tumble carries it one die-width that
   * way, so from a flat landing the options form a tiny grid: positions one
   * step apart along the die's own side directions, and the recorded face's
   * direction among {up, down, ±side₁, ±side₂}. A breadth-first search over
   * that grid finds the shortest sequence that ends with the face on top,
   * treating the walls and every die that is not moving as obstacles.
   * Returns the first move of the best plan, or null if nothing fits in time.
   */
  private planTumbles(i: number, why?: string[]): { dir: Vector3; length: number; turn: number; expectUp: number } | null {
    const body = this.bodies[i];
    const q = this.bodyQuat(i, new Quaternion());
    const { halfWidth, halfDepth } = this.dims;
    const sides: Vector3[] = [];
    for (const local of SIDE_AXES) {
      const w = local.clone().applyQuaternion(q);
      if (Math.abs(w.y) < 0.4) sides.push(w.setY(0).normalize());
    }
    if (sides.length !== 4) return null;
    // Discrete direction set for the recorded face: index 0 = up, 1 = down, 2.. = sides.
    const dirs = [UP, UP.clone().negate(), ...sides];
    const n = this.targetNormal(i, new Vector3());
    let face = 0;
    dirs.forEach((d, k) => {
      if (n.dot(d) > n.dot(dirs[face])) face = k;
    });
    // Other dice as obstacles: where they are if settling, and where they will
    // be in about a tumble's time if still moving (clamped to the tray).
    const obstacles: { x: number; z: number }[] = [];
    this.bodies.forEach((other, j) => {
      if (j === i) return;
      const v = other.velocity;
      const ahead = {
        x: Math.max(-halfWidth, Math.min(halfWidth, other.position.x + v.x * CONTROL.tumbleTime)),
        z: Math.max(-halfDepth, Math.min(halfDepth, other.position.z + v.z * CONTROL.tumbleTime)),
      };
      obstacles.push(ahead);
      if (v.length() <= CONTROL.obstacleSpeed) obstacles.push({ x: other.position.x, z: other.position.z });
    });
    const free = (x: number, z: number) =>
      Math.abs(x) <= halfWidth - CONTROL.wallRoom &&
      Math.abs(z) <= halfDepth - CONTROL.wallRoom &&
      obstacles.every((o) => Math.hypot(o.x - x, o.z - z) >= CONTROL.dieRoom);
    // opposite[k]: index of the direction pointing the other way.
    const opposite = dirs.map((d) => dirs.findIndex((e) => d.dot(e) < -0.9));
    // Tipping toward side s: up→s, down→−s, s→down, −s→up, perpendicular sides unchanged.
    const tip = (f: number, s: number): number => {
      if (f === 0) return s;
      if (f === 1) return opposite[s];
      if (f === s) return 1;
      if (f === opposite[s]) return 0;
      return f;
    };

    const horizontal = new Vector3(body.velocity.x, 0, body.velocity.z);
    const moving = horizontal.length();
    const travel = moving > 0.05 ? horizontal.clone().normalize() : null;
    const time = this.timing.recoverFrom - this.time;
    const maxDepth = Math.min(4, Math.floor(time / CONTROL.tumbleTime));
    if (maxDepth < 1) {
      why?.push('time');
      return null;
    }

    let best: { dir: Vector3; length: number; turn: number; cost: number; expectUp: number } | null = null;
    // Fallback when no sequence reaches the face: the free first move with the most open space.
    let reposition: { dir: Vector3; room: number; expectUp: number } | null = null;
    for (let first = 0; first < 4; first++) {
      const s0 = 2 + first;
      const dir = dirs[s0];
      const turn = travel ? Math.acos(Math.max(-1, Math.min(1, dir.dot(travel)))) : 0;
      if (turn > CONTROL.maxTurn && moving > CONTROL.turnFreeSpeed) {
        why?.push('turn');
        continue;
      }
      const x0 = body.position.x + dir.x;
      const z0 = body.position.z + dir.z;
      if (!free(x0, z0)) {
        why?.push('room');
        continue;
      }
      // BFS from the state after the first tumble.
      let frontier = [{ x: x0, z: z0, f: tip(face, s0) }];
      let length = 1;
      let found = frontier[0].f === 0;
      const seen = new Set<string>();
      while (!found && length < maxDepth && frontier.length) {
        const next: typeof frontier = [];
        for (const st of frontier) {
          for (let k = 0; k < 4 && !found; k++) {
            const d = dirs[2 + k];
            const x = st.x + d.x;
            const z = st.z + d.z;
            const key = `${Math.round(x * 4)},${Math.round(z * 4)},${tip(st.f, 2 + k)}`;
            if (seen.has(key) || !free(x, z)) continue;
            seen.add(key);
            const f = tip(st.f, 2 + k);
            if (f === 0) found = true;
            next.push({ x, z, f });
          }
          if (found) break;
        }
        length += 1;
        frontier = next;
      }
      if (!found) {
        why?.push(`depth${maxDepth}`);
        const room = Math.min(
          halfWidth - Math.abs(x0),
          halfDepth - Math.abs(z0),
          ...obstacles.map((o) => Math.hypot(o.x - x0, o.z - z0)),
        );
        const after = tip(face, s0);
        if (!reposition || room > reposition.room) reposition = { dir, room, expectUp: after === 0 ? 1 : after === 1 ? -1 : 0 };
        continue;
      }
      const cost = length + turn / Math.PI + this.random() * 0.15;
      const after = tip(face, s0);
      const expectUp = after === 0 ? 1 : after === 1 ? -1 : 0;
      if (!best || cost < best.cost) best = { dir, length, turn, cost, expectUp };
    }
    if (best) return best;
    // Boxed in by neighbours or walls: roll once toward open space, if there is
    // still time for the moves that will follow.
    if (reposition && maxDepth >= 3) {
      why?.push('reposition');
      return { dir: reposition.dir, length: Infinity, turn: 0, expectUp: reposition.expectUp };
    }
    return null;
  }

  /**
   * Starts the next tumble of the plan: a quarter turn over the edge under
   * the chosen side, with a speed in the measured band that passes exactly
   * one edge. A landing on the right face is then caught.
   */
  private steerTumble(i: number): void {
    const body = this.bodies[i];
    const c = this.control[i];
    const why: string[] = [];
    const plan = this.planTumbles(i, this.onControl ? why : undefined);
    if (!plan) {
      const slow = Math.hypot(body.velocity.x, body.velocity.z) < 0.5;
      this.onControl?.({ t: this.time, die: i, kind: 'hemmed', detail: [...new Set(why)].sort().join('+') });
      // Completely boxed in with time to spare: a small shove to make room (never too often).
      const early = this.time < this.timing.recoverFrom - 3 * CONTROL.tumbleTime;
      if (slow && early && this.time - c.nudgeAt > CONTROL.nudgeCooldown && c.nudges < CONTROL.maxNudges) this.nudge(i);
      return;
    }
    // Pass over one edge: the centre rises by h(√2 − 1) and a unit cube's
    // inertia about an edge is 2/3, so ½·(2/3)·ω² must exceed g·h(√2 − 1).
    const minSpin = Math.sqrt((2 * PHYSICS.gravity * DIE_HALF * (Math.SQRT2 - 1)) / (2 / 3));
    const spin = minSpin * (CONTROL.tumbleMargin + (this.random() - 0.5) * 2 * CONTROL.tumbleJitter);
    const dir = plan.dir;
    // Tipping toward `dir` is a rotation about up × dir.
    const axis = new Vector3().crossVectors(UP, dir);
    body.angularVelocity.set(axis.x * spin, body.angularVelocity.y * 0.25, axis.z * spin);
    // Pivoting about the bottom edge on the side it tips toward: the centre
    // moves with velocity ω × (centre − pivot) = ω·h·(dir + up).
    const roll = spin * DIE_HALF;
    body.velocity.set(dir.x * roll, roll, dir.z * roll);
    body.angularDamping = PHYSICS.angularDamping;
    c.status = 'tumbling';
    c.tumbleAt = this.time;
    c.leftFlat = false;
    c.tumbles += 1;
    c.expectUp = plan.expectUp;
    this.stats.steeredTumbles += 1;
    this.onControl?.({ t: this.time, die: i, kind: 'tumble', detail: `plan ${plan.length}` });
  }

  /** A small shove away from whatever the die is leaning on or sitting on. */
  private nudge(i: number, reason = 'hemmed'): void {
    const body = this.bodies[i];
    const c = this.control[i];
    const away = new Vector3();
    this.bodies.forEach((other, j) => {
      if (j === i) return;
      const dx = body.position.x - other.position.x;
      const dz = body.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.6) away.add(new Vector3(dx, 0, dz).divideScalar(Math.max(d2, 0.05)));
    });
    const { halfWidth, halfDepth } = this.dims;
    if (body.position.x > halfWidth - 1) away.x -= 1;
    if (body.position.x < -halfWidth + 1) away.x += 1;
    if (body.position.z > halfDepth - 1) away.z -= 1;
    if (body.position.z < -halfDepth + 1) away.z += 1;
    if (away.lengthSq() < 1e-4) away.set(this.random() - 0.5, 0, this.random() - 0.5);
    away.normalize();
    body.velocity.set(away.x * 2.6, 2.4, away.z * 2.6);
    body.angularVelocity.set((this.random() - 0.5) * 4, (this.random() - 0.5) * 3, (this.random() - 0.5) * 4);
    c.nudges += 1;
    c.nudgeAt = this.time;
    this.onControl?.({ t: this.time, die: i, kind: 'nudge', detail: reason });
    this.stats.nudges += 1;
  }

  /**
   * Bounded last resort: roll the die onto the recorded face along a scripted
   * path, as if it tipped over its edge(s) once more. The centre follows the
   * felt exactly (height from the hull's lowest vertex), keeps its corners
   * clear of the walls, and the body is kinematic for the move so it shoves
   * neighbours aside instead of passing through them.
   */
  private beginScripted(i: number, reason = 'forced'): void {
    const body = this.bodies[i];
    const c = this.control[i];
    const fromQ = this.bodyQuat(i, new Quaternion()).clone();
    const fromP = new Vector3(body.position.x, body.position.y, body.position.z);
    const n = this.targetNormal(i, new Vector3()).normalize();
    const toQ = new Quaternion().setFromUnitVectors(n, UP).multiply(fromQ);
    const angle = Math.acos(Math.min(1, Math.max(-1, n.y)));
    // Rolling over k edges carries the centre k die-widths away from the face that comes up.
    const away = new Vector3(-n.x, 0, -n.z);
    if (away.lengthSq() < 1e-4) away.set(this.random() - 0.5, 0, this.random() - 0.5);
    away.normalize().multiplyScalar(angle / (Math.PI / 2));
    const toP = this.freeSpot(i, new Vector3(fromP.x + away.x, DIE_HALF, fromP.z + away.z), SWEEP_MARGIN);
    const { halfWidth, halfDepth } = this.dims;
    c.scripted = {
      start: this.time,
      duration: Math.max(0.26, (angle / (Math.PI / 2)) * CONTROL.recoveryQuarter + fromP.distanceTo(toP) * 0.06),
      fromP,
      fromQ,
      toQ,
      toP,
      startMargin: Math.min(halfWidth - Math.abs(fromP.x), halfDepth - Math.abs(fromP.z)),
    };
    c.status = 'scripted';
    this.onControl?.({ t: this.time, die: i, kind: 'scripted', detail: `${reason} angle ${angle.toFixed(2)} tumbles ${c.tumbles} nudges ${c.nudges}` });
    body.type = Body.KINEMATIC;
    body.angularDamping = PHYSICS.angularDamping;
    body.linearDamping = PHYSICS.linearDamping;
    this.stats.scriptedRecoveries += 1;
  }

  /** Nearest spot to `want` on the felt that no other die occupies. */
  private freeSpot(i: number, want: Vector3, wallMargin: number): Vector3 {
    const p = want.clone();
    const limX = this.dims.halfWidth - wallMargin;
    const limZ = this.dims.halfDepth - wallMargin;
    for (let iteration = 0; iteration < 40; iteration++) {
      p.x = Math.max(-limX, Math.min(limX, p.x));
      p.z = Math.max(-limZ, Math.min(limZ, p.z));
      let moved = false;
      this.bodies.forEach((other, j) => {
        if (j === i) return;
        const dx = p.x - other.position.x;
        const dz = p.z - other.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.47) {
          const k = (1.47 - d + 0.01) / Math.max(d, 1e-3);
          p.x += (d > 1e-3 ? dx : 1) * k;
          p.z += (d > 1e-3 ? dz : 0) * k;
          moved = true;
        }
      });
      if (!moved) break;
    }
    return p;
  }

  /**
   * Moves a scripted die toward its pose at time `t`. cannon-es integrates
   * kinematic bodies by their velocity during the world step, so the move is
   * expressed as a velocity (letting neighbours be pushed correctly); only the
   * final step places the die exactly.
   */
  private driveScripted(i: number, t: number): void {
    const c = this.control[i];
    const s = c.scripted!;
    const body = this.bodies[i];
    const u = Math.min(1, (t - s.start) / s.duration);
    const e = u * u * (3 - 2 * u);
    const q = new Quaternion().slerpQuaternions(s.fromQ, s.toQ, e);
    const p = new Vector3().lerpVectors(s.fromP, s.toP, e);
    // Keep rotating corners off the walls: the allowed margin grows from where
    // the die started to the full sweep radius as it turns.
    const margin = Math.min(SWEEP_MARGIN, s.startMargin + (SWEEP_MARGIN - s.startMargin) * Math.min(1, 3 * e));
    p.x = Math.max(-(this.dims.halfWidth - margin), Math.min(this.dims.halfWidth - margin, p.x));
    p.z = Math.max(-(this.dims.halfDepth - margin), Math.min(this.dims.halfDepth - margin, p.z));
    // Rest the lowest corner on the felt (pivoting over an edge), plus a small lift.
    let lowest = Infinity;
    for (const v of HULL) lowest = Math.min(lowest, tmpV.copy(v).applyQuaternion(q).y);
    const ground = -lowest;
    p.y = Math.max(ground, s.fromP.y + (DIE_HALF - s.fromP.y) * e) + Math.sin(Math.PI * e) * 0.12;
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.angularVelocity.set(0, 0, 0);
    if (u < 1) {
      const dt = this.step;
      body.velocity.set((p.x - body.position.x) / dt, (p.y - body.position.y) / dt, (p.z - body.position.z) / dt);
      return;
    }
    body.position.set(s.toP.x, DIE_HALF, s.toP.z);
    body.type = Body.DYNAMIC;
    body.velocity.set(0, 0, 0);
    body.angularDamping = 0.85;
    body.linearDamping = 0.35;
    c.scripted = null;
    c.status = 'caught';
    c.restSteps = 0;
  }

  private dieAtRestOnTarget(i: number): boolean {
    const c = this.control[i];
    return c.status === 'caught' && !c.scripted && c.restSteps >= CONTROL.restSteps;
  }

  private checkRest(): void {
    const t = this.time;
    if (t < this.timing.steerFrom) return;
    const allResting = this.bodies.every((_, i) => this.dieAtRestOnTarget(i));
    if (!allResting) {
      this.restSince = null;
      if (t >= this.timing.hardStop) {
        // Out of time: every die not yet resting on its face takes the recovery
        // move now. Moves already under way simply finish; nothing jumps.
        this.control.forEach((c, i) => {
          if (!c.scripted && !this.dieAtRestOnTarget(i) && !(c.status === 'caught' && this.targetNormal(i).y > 0.99)) {
            this.beginScripted(i, 'hardstop');
          }
        });
      }
      return;
    }
    this.restSince ??= t;
    if (t - this.restSince >= CONTROL.restHold) this.finish();
  }

  /** Free physics mode (tests/diagnostics): done once everything is still. */
  private checkFreeRest(): void {
    if (this.time < this.timing.shakeEnd + this.timing.shakeFade) return;
    const still = this.bodies.every((b) => b.velocity.length() < CONTROL.restSpeed && b.angularVelocity.length() < CONTROL.restSpin);
    if (!still) {
      this.restSince = null;
      if (this.time >= this.timing.hardStop) this.finish();
      return;
    }
    this.restSince ??= this.time;
    if (this.time - this.restSince >= CONTROL.restHold) this.finish();
  }

  /** Immediately completes any unresolved die with its scripted recovery, then finishes. */
  private forceFinish(): void {
    for (let i = 0; i < 6; i++) {
      const c = this.control[i];
      if (!c.scripted && !this.dieAtRestOnTarget(i)) this.beginScripted(i);
      const s = this.control[i].scripted;
      if (s) this.driveScripted(i, s.start + s.duration);
      const body = this.bodies[i];
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
    }
    this.record();
    this.finish();
  }

  private finish(): void {
    if (this.restAt !== null) return;
    this.restAt = this.time;
  }
}
