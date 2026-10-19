import { Body, Box, ContactMaterial, GSSolver, Material, Plane, Vec3, World, type ContactEquation } from 'cannon-es';
import { Quaternion, Vector3 } from 'three';
import type { Faces } from '../game/roll';
import { restQuaternion, snapUpright, symmetryForTarget, upwardFace } from './faceMap';
import { DIE_HALF, type TrayDims } from './trayConfig';
import { visualRandom, type VisualRandom } from './visualRandom';

/**
 * Plans the motion of one roll whose outcome is ALREADY decided.
 *
 * 1. Simulate a throw with cannon-es, entirely ahead of time (a few ms),
 *    recording every body's pose at SAMPLE_RATE.
 * 2. Reject throws that end badly (a die leaning, stacked, or taking too long)
 *    and re-throw with different visual-only launch parameters.
 * 3. For each die, take the settled body pose S and choose a cube symmetry R
 *    (faceMap.symmetryForTarget) so that S·R has the recorded symbol on top.
 *    The whole track is rendered as body·R. R maps the cube onto itself, so the
 *    die's silhouette, contacts and shadows are exactly the simulated ones.
 * 4. Over the last BLEND_SECONDS, ease the residual sub-degree tilt and
 *    millimetre height error into the exact final pose.
 *
 * The physics never chooses the result: whatever face the body lands on, the
 * symmetry makes `faces[i]` the one painted there. If no acceptable throw is
 * found (or physics fails), a procedural tumble ending on the same faces is used.
 */

export const SAMPLE_RATE = 120;
const STEP = 1 / SAMPLE_RATE;
const MAX_SIM_SECONDS = 4;
const BLEND_SECONDS = 0.22;
const GRAVITY = -42;
const CEILING_HEIGHT = 7;
const IDEAL_DURATION = 1.75;
const MAX_ACCEPTED_DURATION = 2.4;

export interface DiePose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export type ImpactSurface = 'die' | 'wall' | 'felt';

export interface ImpactEvent {
  /** Seconds from the start of the throw. */
  readonly t: number;
  readonly die: number;
  /** Approach speed along the contact normal (die units / s). */
  readonly strength: number;
  readonly surface: ImpactSurface;
}

export interface RollPlan {
  readonly faces: Faces;
  readonly dims: TrayDims;
  readonly sampleRate: number;
  readonly sampleCount: number;
  /**
   * Visual pose per die per sample, packed [px, py, pz, qx, qy, qz, qw].
   * Symmetry and final correction are already applied: the last sample is the
   * exact final pose with faces[i] on top.
   */
  readonly tracks: readonly Float32Array[];
  readonly finalPoses: readonly DiePose[];
  /** Throw length in seconds (first to last sample). */
  readonly duration: number;
  /** Time after which every die is moving gently (start of the Settling phase). */
  readonly settleAt: number;
  readonly impacts: readonly ImpactEvent[];
  readonly source: 'physics' | 'procedural';
  readonly attempts: number;
}

export interface PlanOptions {
  random?: VisualRandom;
  maxAttempts?: number;
  /** Testing hook: skip physics and use the procedural tumble. */
  forceProcedural?: boolean;
}

interface Launch {
  positions: Vector3[];
  quaternions: Quaternion[];
  velocities: Vector3[];
  spins: Vector3[];
}

interface SimResult {
  bodyTracks: Float32Array[];
  sampleCount: number;
  duration: number;
  settleAt: number;
  impacts: ImpactEvent[];
  valid: boolean;
}

function randomUnitQuaternion(random: VisualRandom): Quaternion {
  // Shoemake's method: uniform over rotations.
  const u1 = random();
  const u2 = random() * Math.PI * 2;
  const u3 = random() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return new Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}

function randomUnitVector(random: VisualRandom): Vector3 {
  const z = random() * 2 - 1;
  const phi = random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(phi), z, r * Math.sin(phi));
}

/**
 * A handful of dice leaving the hand together, thrown along the tray's long
 * axis. Spacing ≥ cube diagonal (√3 ≈ 1.73) so no two dice start overlapping
 * whatever their orientation.
 */
function makeLaunch(dims: TrayDims, random: VisualRandom): Launch {
  const alongX = dims.halfWidth >= dims.halfDepth;
  const halfA = alongX ? dims.halfWidth : dims.halfDepth;
  const halfB = alongX ? dims.halfDepth : dims.halfWidth;
  const dir = random() < 0.5 ? 1 : -1;
  const spacing = 1.78;
  const centreA = -dir * (halfA - 1.55);
  const centreB = (random() * 2 - 1) * Math.max(0, halfB - spacing - DIE_HALF - 0.35);
  const speed = 8 + random() * 3;

  const launch: Launch = { positions: [], quaternions: [], velocities: [], spins: [] };
  for (let i = 0; i < 6; i++) {
    const row = i < 3 ? -0.5 : 0.5;
    const column = (i % 3) - 1;
    const a = centreA + row * spacing + (random() - 0.5) * 0.08;
    const b = centreB + column * spacing + (random() - 0.5) * 0.08;
    const y = 1.9 + random() * 0.9;
    const va = dir * speed * (0.85 + random() * 0.3);
    const vb = (random() * 2 - 1) * 1.6 - centreB * 0.35;
    const vy = 0.6 + random() * 2.2;
    launch.positions.push(alongX ? new Vector3(a, y, b) : new Vector3(b, y, a));
    launch.velocities.push(alongX ? new Vector3(va, vy, vb) : new Vector3(vb, vy, va));
    launch.quaternions.push(randomUnitQuaternion(random));
    launch.spins.push(randomUnitVector(random).multiplyScalar(11 + random() * 12));
  }
  return launch;
}

function addStaticPlane(world: World, material: Material, position: Vec3, axis: Vec3, angle: number): Body {
  const body = new Body({ mass: 0, material, shape: new Plane() });
  body.position.copy(position);
  body.quaternion.setFromAxisAngle(axis, angle);
  world.addBody(body);
  return body;
}

function simulate(dims: TrayDims, launch: Launch): SimResult {
  const world = new World({ gravity: new Vec3(0, GRAVITY, 0), allowSleep: true });
  const solver = new GSSolver();
  solver.iterations = 14;
  world.solver = solver;
  world.defaultContactMaterial.friction = 0.2;

  const diceMaterial = new Material('dice');
  const feltMaterial = new Material('felt');
  const wallMaterial = new Material('wall');
  world.addContactMaterial(new ContactMaterial(diceMaterial, feltMaterial, { friction: 0.34, restitution: 0.3 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, wallMaterial, { friction: 0.08, restitution: 0.52 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, diceMaterial, { friction: 0.12, restitution: 0.4 }));

  const X = new Vec3(1, 0, 0);
  const Y = new Vec3(0, 1, 0);
  const felt = addStaticPlane(world, feltMaterial, new Vec3(0, 0, 0), X, -Math.PI / 2);
  const walls = new Set<Body>([
    addStaticPlane(world, wallMaterial, new Vec3(-dims.halfWidth, 0, 0), Y, Math.PI / 2),
    addStaticPlane(world, wallMaterial, new Vec3(dims.halfWidth, 0, 0), Y, -Math.PI / 2),
    addStaticPlane(world, wallMaterial, new Vec3(0, 0, -dims.halfDepth), Y, 0),
    addStaticPlane(world, wallMaterial, new Vec3(0, 0, dims.halfDepth), Y, Math.PI),
    addStaticPlane(world, wallMaterial, new Vec3(0, CEILING_HEIGHT, 0), X, Math.PI / 2),
  ]);

  const impacts: ImpactEvent[] = [];
  const lastImpact = new Map<string, number>();
  let time = 0;

  const dice: Body[] = launch.positions.map((p, i) => {
    const body = new Body({
      mass: 1,
      material: diceMaterial,
      shape: new Box(new Vec3(DIE_HALF, DIE_HALF, DIE_HALF)),
      linearDamping: 0.12,
      angularDamping: 0.14,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.18,
    });
    body.position.set(p.x, p.y, p.z);
    const q = launch.quaternions[i];
    body.quaternion.set(q.x, q.y, q.z, q.w);
    const v = launch.velocities[i];
    body.velocity.set(v.x, v.y, v.z);
    const w = launch.spins[i];
    body.angularVelocity.set(w.x, w.y, w.z);
    body.addEventListener('collide', (event: { body: Body; contact: ContactEquation }) => {
      const other = event.body;
      const otherDie = dice.indexOf(other);
      // Die-die contacts are reported to both bodies; keep one.
      if (otherDie !== -1 && otherDie < i) return;
      const surface: ImpactSurface = otherDie !== -1 ? 'die' : walls.has(other) ? 'wall' : other === felt ? 'felt' : 'wall';
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength < 0.8) return;
      const key = `${i}:${surface}`;
      if (time - (lastImpact.get(key) ?? -1) < 0.045) return;
      lastImpact.set(key, time);
      impacts.push({ t: time, die: i, strength, surface });
    });
    world.addBody(body);
    return body;
  });

  const maxSamples = Math.ceil(MAX_SIM_SECONDS * SAMPLE_RATE) + 1;
  const bodyTracks = dice.map(() => new Float32Array(maxSamples * 7));
  const write = (sample: number) => {
    dice.forEach((body, i) => {
      const o = sample * 7;
      const track = bodyTracks[i];
      track[o] = body.position.x;
      track[o + 1] = body.position.y;
      track[o + 2] = body.position.z;
      track[o + 3] = body.quaternion.x;
      track[o + 4] = body.quaternion.y;
      track[o + 5] = body.quaternion.z;
      track[o + 6] = body.quaternion.w;
    });
  };

  write(0);
  let sample = 0;
  let lastLively = 0;
  let quietSteps = 0;
  while (sample < maxSamples - 1) {
    world.step(STEP);
    time += STEP;
    sample += 1;
    write(sample);
    let maxLinear = 0;
    let maxAngular = 0;
    for (const body of dice) {
      maxLinear = Math.max(maxLinear, body.velocity.length());
      maxAngular = Math.max(maxAngular, body.angularVelocity.length());
    }
    if (maxLinear > 0.9 || maxAngular > 2.6) lastLively = time;
    quietSteps = maxLinear < 0.06 && maxAngular < 0.12 ? quietSteps + 1 : 0;
    const allAsleep = dice.every((b) => b.sleepState === Body.SLEEPING);
    if (allAsleep || quietSteps >= 10) break;
  }

  const sampleCount = sample + 1;
  const duration = sample * STEP;
  const valid =
    sample < maxSamples - 1 &&
    dice.every((body) => {
      const q = new Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      const flat = Math.abs(upwardFaceAxisY(q)) > 0.996;
      const onFelt = Math.abs(body.position.y - DIE_HALF) < 0.04;
      const inside =
        Math.abs(body.position.x) <= dims.halfWidth - DIE_HALF + 0.03 &&
        Math.abs(body.position.z) <= dims.halfDepth - DIE_HALF + 0.03;
      return flat && onFelt && inside;
    });

  return {
    bodyTracks: bodyTracks.map((t) => t.slice(0, sampleCount * 7)),
    sampleCount,
    duration,
    settleAt: Math.min(lastLively, Math.max(0, duration - 0.2)),
    impacts,
    valid,
  };
}

/** Largest |world-Y component| among the die's local axes: 1 when lying perfectly flat. */
function upwardFaceAxisY(q: Quaternion): number {
  return upwardFace(q).alignment;
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Converts body tracks into visual tracks ending exactly on the recorded faces. */
function buildPlanFromSim(faces: Faces, dims: TrayDims, sim: SimResult, attempts: number): RollPlan {
  const last = sim.sampleCount - 1;
  const finalPoses: DiePose[] = [];
  const tracks = sim.bodyTracks.map((bodyTrack, i) => {
    const o = last * 7;
    const settled = snapUpright(
      new Quaternion(bodyTrack[o + 3], bodyTrack[o + 4], bodyTrack[o + 5], bodyTrack[o + 6]).normalize(),
    );
    const { symmetry, final } = symmetryForTarget(settled, faces[i]);
    const finalPosition = new Vector3(bodyTrack[o], DIE_HALF, bodyTrack[o + 2]);
    finalPoses.push({ position: finalPosition, quaternion: final });

    const out = new Float32Array(bodyTrack.length);
    const p = new Vector3();
    const q = new Quaternion();
    const blendStart = sim.duration - BLEND_SECONDS;
    for (let s = 0; s < sim.sampleCount; s++) {
      const k = s * 7;
      p.set(bodyTrack[k], bodyTrack[k + 1], bodyTrack[k + 2]);
      q.set(bodyTrack[k + 3], bodyTrack[k + 4], bodyTrack[k + 5], bodyTrack[k + 6]).normalize().multiply(symmetry);
      const t = s * STEP;
      if (s === last) {
        p.copy(finalPosition);
        q.copy(final);
      } else if (t > blendStart) {
        const w = smoothstep((t - blendStart) / BLEND_SECONDS);
        p.lerp(finalPosition, w);
        q.slerp(final, w);
      }
      out[k] = p.x;
      out[k + 1] = p.y;
      out[k + 2] = p.z;
      out[k + 3] = q.x;
      out[k + 4] = q.y;
      out[k + 5] = q.z;
      out[k + 6] = q.w;
    }
    return out;
  });

  return {
    faces,
    dims,
    sampleRate: SAMPLE_RATE,
    sampleCount: sim.sampleCount,
    tracks,
    finalPoses,
    duration: sim.duration,
    settleAt: sim.settleAt,
    impacts: sim.impacts,
    source: 'physics',
    attempts,
  };
}

/**
 * Fallback: an analytic tumble (arc, decaying bounces, spin unwinding into the
 * final orientation) onto a loose grid. Always valid by construction.
 */
export function planProcedural(faces: Faces, dims: TrayDims, random: VisualRandom, attempts = 0): RollPlan {
  const launch = makeLaunch(dims, random);
  const cols = 3;
  const spacingX = Math.min(2.1, (dims.halfWidth * 2 - 1.6) / cols);
  const spacingZ = Math.min(2.0, dims.halfDepth - 0.9);
  const finalPoses: DiePose[] = faces.map((face, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - 1) * spacingX + (random() - 0.5) * 0.35;
    const z = (row - 0.5) * spacingZ + (random() - 0.5) * 0.35;
    const yaw = (random() - 0.5) * 0.7;
    return { position: new Vector3(x, DIE_HALF, z), quaternion: restQuaternion(face, yaw) };
  });

  const duration = 1.7;
  const sampleCount = Math.round(duration * SAMPLE_RATE) + 1;
  const tracks = finalPoses.map((finalPose, i) => {
    const start = launch.positions[i];
    const startQ = launch.quaternions[i];
    const axis = randomUnitVector(random);
    const spin = Math.PI * 2 * (2 + Math.floor(random() * 2));
    const end = 1.25 + i * 0.05 + random() * 0.12;
    const out = new Float32Array(sampleCount * 7);
    const p = new Vector3();
    const q = new Quaternion();
    const turn = new Quaternion();
    for (let s = 0; s < sampleCount; s++) {
      const t = Math.min(1, (s * STEP) / end);
      const ease = 1 - Math.pow(1 - t, 3);
      p.lerpVectors(start, finalPose.position, ease);
      // Arc down from launch height, then three shrinking hops.
      const fall = (1 - Math.min(1, t / 0.28)) ** 2 * (start.y - DIE_HALF);
      const hop = t > 0.28 ? Math.abs(Math.sin(((t - 0.28) / 0.72) * Math.PI * 3)) * 0.7 * (1 - t) ** 2 : 0;
      p.y = DIE_HALF + fall + hop;
      turn.setFromAxisAngle(axis, spin * (1 - ease));
      q.copy(finalPose.quaternion).multiply(turn);
      if (t < 0.15) q.slerp(startQ, 1 - t / 0.15);
      if (s === sampleCount - 1) {
        p.copy(finalPose.position);
        q.copy(finalPose.quaternion);
      }
      const k = s * 7;
      out.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], k);
    }
    return out;
  });

  const impacts: ImpactEvent[] = finalPoses.flatMap((_, i) =>
    [0.28, 0.52, 0.75].map((frac, n) => ({ t: frac * 1.3 + i * 0.03, die: i, strength: 6 / (n + 1), surface: 'felt' as const })),
  );

  return {
    faces,
    dims,
    sampleRate: SAMPLE_RATE,
    sampleCount,
    tracks,
    finalPoses,
    duration,
    settleAt: duration - 0.45,
    impacts,
    source: 'procedural',
    attempts,
  };
}

export function planRoll(faces: Faces, dims: TrayDims, options: PlanOptions = {}): RollPlan {
  const random = options.random ?? visualRandom;
  const maxAttempts = options.maxAttempts ?? 10;
  if (options.forceProcedural) return planProcedural(faces, dims, random);

  let best: SimResult | null = null;
  let attempts = 0;
  try {
    for (; attempts < maxAttempts; ) {
      attempts += 1;
      const sim = simulate(dims, makeLaunch(dims, random));
      if (!sim.valid) continue;
      if (sim.duration <= MAX_ACCEPTED_DURATION && sim.duration >= 0.9) {
        best = sim;
        break;
      }
      if (!best || Math.abs(sim.duration - IDEAL_DURATION) < Math.abs(best.duration - IDEAL_DURATION)) best = sim;
    }
  } catch (error) {
    console.warn('[dice] physics planning failed, using procedural tumble', error);
    best = null;
  }
  if (!best) return planProcedural(faces, dims, random, attempts);
  return buildPlanFromSim(faces, dims, best, attempts);
}

const tmpQ = new Quaternion();

/** Reads the pose of die `die` at time `t` (seconds into the throw) into `outP`/`outQ`. */
export function samplePlan(plan: RollPlan, die: number, t: number, outP: Vector3, outQ: Quaternion): void {
  const track = plan.tracks[die];
  const f = Math.min(Math.max(t, 0) * plan.sampleRate, plan.sampleCount - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, plan.sampleCount - 1);
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
    tmpQ.set(track[b + 3], track[b + 4], track[b + 5], track[b + 6]);
    outQ.slerp(tmpQ, frac);
  }
}
