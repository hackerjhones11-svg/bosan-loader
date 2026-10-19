import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PMREMGenerator, type PerspectiveCamera } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { uiStore, useRollState } from '../app/appState';
import { isBusy } from '../game/rollStore';
import { fitCamera } from './cameraFit';
import { DiceSet } from './DiceSet';
import { Tray } from './Tray';
import { RIM, TRAY_PRESETS, presetForAspect, type TrayDims } from './trayConfig';

function CameraRig({ dims }: { dims: TrayDims }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    if (width > 0 && height > 0) fitCamera(camera, dims, width / height);
    invalidate();
  }, [camera, dims, width, height, invalidate]);
  return null;
}

/** Soft, warm image-based fill generated locally (no HDR download). */
function LocalEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.32;
    room.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Lighting({ dims }: { dims: TrayDims }) {
  const extent = Math.max(dims.halfWidth, dims.halfDepth) + RIM.width + 1;
  return (
    <>
      <hemisphereLight args={['#fff1da', '#2a1d12', 0.55]} />
      <directionalLight
        position={[-4.5, 12, 6.5]}
        intensity={2.3}
        color="#ffe6c2"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={3}
      />
      <directionalLight position={[7, 5, -6]} intensity={0.35} color="#d9e6ff" />
    </>
  );
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    onReady();
  });
  return null;
}

function Scene({ reducedMotion, onReady }: { reducedMotion: boolean; onReady: () => void }) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const busy = useRollState(isBusy);
  const desired = presetForAspect(height > 0 ? width / height : 1.5);
  const [preset, setPreset] = useState(desired);
  // The tray never changes shape mid-roll; a pending resize applies once the dice rest.
  useEffect(() => {
    if (!busy && preset !== desired) setPreset(desired);
  }, [busy, desired, preset]);
  const dims = TRAY_PRESETS[preset];

  return (
    <>
      <CameraRig dims={dims} />
      <LocalEnvironment />
      <Lighting dims={dims} />
      <Tray dims={dims} />
      <DiceSet dims={dims} reducedMotion={reducedMotion} />
      <FirstFrame onReady={onReady} />
    </>
  );
}

/** Dev-only switch (`?renderer=3d-fail`) to exercise the 3D → 2D recovery path. */
function SimulatedFailure(): null {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('renderer') === '3d-fail') {
    throw new Error('Simulated 3D initialisation failure');
  }
  return null;
}

function maxDpr(): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2);
}

export default function DiceStage3D({
  reducedMotion,
  onFail,
}: {
  reducedMotion: boolean;
  onFail: (reason: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    if (!ready) return;
    uiStore.set({ rendererReady: true, renderer: '3d' });
    return () => uiStore.set({ rendererReady: false, renderer: null });
  }, [ready]);

  return (
    <div className="stage3d">
      <Canvas
        shadows="percentage"
        dpr={[1, maxDpr()]}
        frameloop="demand"
        camera={{ fov: 30, near: 0.5, far: 120, position: [0, 14, 9] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            onFailRef.current('context-lost');
          });
        }}
        aria-hidden="true"
      >
        <SimulatedFailure />
        <Scene reducedMotion={reducedMotion} onReady={() => setReady(true)} />
      </Canvas>
    </div>
  );
}
