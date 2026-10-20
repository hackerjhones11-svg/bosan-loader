# Langur Burja · Jhandi Burja dice

A tactile six-dice simulator for **Langur Burja** (also called **Jhandi Burja**), the traditional dice game
played in Nepal during Dashain and Tihar. Roll six illustrated dice on an emerald-felt tray, then read the
counts of each symbol. It is a **simulator only**: there is no betting, money, wallet or payout logic.

| # | ID       | Name            | Symbol  |
|---|----------|-----------------|---------|
| 1 | `jhandi` | Jhandi / झण्डी  | Flag    |
| 2 | `burja`  | Burja / बुर्जा   | Crown   |
| 3 | `itta`   | Itta / इट्टा     | Diamond |
| 4 | `paan`   | Paan / पान      | Heart   |
| 5 | `hukum`  | Hukum / हुकुम    | Spade   |
| 6 | `chidi`  | Chidi / चिडी     | Club    |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (admin tools: http://localhost:5173/admin)
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | Typecheck + lint + tests |
| `npm run diag:distribution` | Optional developer tool: tallies 200,000 fair rolls. Informational, **not** a test gate |
| `npm run diag:simulation` | Optional developer tool: motion quality and controller statistics over many simulated rolls |

Development switches (query string):

- `?renderer=2d`: force the 2D fallback (no WebGL).
- `?renderer=3d-fail`: dev builds only; simulate a 3D initialisation crash to exercise recovery.
- `?motion=reduced`: force reduced motion (otherwise follows `prefers-reduced-motion`).
- `?lookahead=0`: dev builds only; play rolls without the look-ahead search, for comparison.

## How a roll works

A roll takes about 5–6 seconds from pressing Roll to the finished reveal. Every duration lives in one
place, `src/game/rollTiming.ts` (`ROLL_TIMING`), shared by the 3D tray, the 2D fallback and the reveal:

| Time (s) | What happens |
|---|---|
| 0 – 0.3 | the hands start shaking the tray (`buildUp`) |
| 0.3 – 3.35 | energetic shaking; dice slide, tumble, hop, hit the rim and each other. From 1.5 s (`steerFrom`) a landing may be steered toward the recorded face, which the shake makes indistinguishable from a tray-made tumble. At 2.2 s (`branchAt`) the roll continues along the best of several looked-ahead continuations |
| 3.35 – 3.65 | the hands stop: the shake fades out (`shakeEnd`, `shakeFade`) |
| 3.65 – ~5.1 | dice coast on their remaining momentum, make their last tumbles and settle (median rest ≈ 5.1 s) |
| rest + 0.16 | brief hold on the final arrangement (`revealHold`) |
| … + 0.62 | halos, staggered counts and summary; Roll is ready again (`revealDuration`), ≈ 5.9 s in total |

1. **Outcome first.** `rollStore.requestRoll()` draws six independent faces with `crypto.getRandomValues`
   and creates one frozen `RollRecord` (`id`, `timestamp`, `faces`, derived `counts`, `mode`).
   Everything else (dice, mat, history, the screen-reader announcement) is derived from that object.
2. **Unbiased draws.** `src/game/random.ts` uses rejection sampling: uint32 words at or above
   `2^32 − (2^32 mod 6)` are discarded, so each symbol has exactly a 1-in-6 chance on every die.
   An ESLint rule bans `Math.random` everywhere except `src/dice3d/visualRandom.ts`, which only varies
   the shake, the starting spins and sound textures.
3. **A shaken tray** (`src/dice3d/diceSimulation.ts`, `shake.ts`, `dieCollider.ts`). A live cannon-es world
   runs at a fixed 180 Hz step in *tray space*: the felt, the four walls and an invisible lid are static, and
   the hands appear as one shared pseudo-force −m·a(t) on every die. a(t) is a ~2 Hz stroke along a drifting
   axis plus a weaker cross-stroke, a slow swell and a few jolts with an upward kick, all re-drawn every
   roll. Dice are dynamic bodies with chamfered convex hulls that wrap the rounded visual dice exactly. They
   start from wherever they rest, so the roll begins with the real dice the player can see.
4. **Landing on the recorded faces.** Because the dice start visible, the physics itself must finish on the
   recorded faces; nothing is relabelled or swapped. After the shake, a controller acts only at settled
   landings:
   - a die landing with its recorded face up is *caught* (felt absorbs most of its spin);
   - otherwise a breadth-first search over its possible tumbles (a die can only tip over the edge under one
     of its four sides, moving one die-width) finds the shortest sequence that ends with the face up without
     hitting a wall or a settling die, preferring directions that don't reverse a moving die. The die is
     then given exactly the spin a cube needs to roll over one edge;
   - a die that rests cocked against a wall or on another die gets a small shove;
   - bounded recovery: a die that lands wrong with no feasible tumble, or is still on a wrong face at
     `recoverFrom`, rolls over the edge(s) under its own sides along a scripted path: one die-width per
     quarter turn, paced like a real tip-over, lowest corner on the felt, kept inside the walls and away from
     other dice (kinematic, so it still pushes neighbours, and each edge makes a felt tap). By `hardStop`
     every die is resolved, and an absolute bound ends the roll whatever happens.
   The rendered die is the physics body every frame, so its face never changes after it stops. The resting
   faces are checked against the record once more before the reveal.
5. **Look-ahead** (`branchSearch.ts`, `branchWorker.ts`). How the hands carry on shaking after `branchAt`
   is free, so the roll does not have to commit to one continuation blindly. When Roll is pressed, a Web
   Worker gets the roll's faces, tray, starting poses and seed, replays it up to the branch point (runs
   with the same seed are bit-for-bit identical) and then tries up to 12 continuations of the shake (new
   stroke axis, strength and phase blended in over 0.35 s, re-drawn jolts), each with the same
   controller. It scores how much visible help each one's dice needed (recovery rolls, above all ones
   started from rest, nudges, settling outside 4.6–5.3 s), abandons a continuation as soon as it cannot
   win, and stops early on a perfect one. The simulation on screen holds at the branch point until a
   continuation is chosen: the best one when the worker finishes, or the best so far when playback gets
   within 0.1 s of it. Playback never waits, nothing on screen changes, and the outcome was fixed before
   any of this: the search only picks how the dice get there. Without a worker (unsupported, failed,
   single-core device) the roll plays its first continuation, as the controller alone would.
6. **Playback** (`DiceSet.tsx`) advances the simulation slightly ahead of the frame being drawn within a
   CPU budget, so it stays in time on slow devices (if it cannot, playback slows instead of skipping). The
   tray and dice tremble by a scaled-down copy of the same shake. A hidden tab completes the roll at once
   instead of replaying queued steps later.

The developer diagnostic `npm run diag:simulation` reports, over many rolls, rest times, path length per
die, tray coverage, wall and die-to-die contacts, tumbles, penetration and how often each controller
intervention was needed.

### Sound (`src/audio/soundEngine.ts`)

Synthesised with Web Audio (no files): every collision the simulation reports becomes a short percussive
voice (bright clack for die-on-die, woody knock for the rim, muffled tap on felt) whose level follows the
impact speed, with slight pitch variation. Under them, a felt "slide" bed and tiny rattle grains follow how
vigorously the dice move, so the sound builds with the shake, thins as the dice coast and is silent at rest.
Repeats per die are throttled, overlapping voices are capped, everything runs through a per-roll bus and a
compressor (no stacking across rolls, no clipping), and audio starts only from the Roll gesture and is never
required for a roll to complete.

### Reveal

When all six dice are confirmed at rest, the store records the roll (`completeRoll` → `revealing`). The
arrangement is held for a moment; then a soft warm halo appears under dice whose symbol came up more than
once, with a single gentle glow along their ivory edges (never over the symbols). The mat's counts turn over
tile by tile, a summary such as "Paan ×3 · Jhandi ×2 · Burja ×1" appears, and the Roll button becomes
available again (`result`). Hovering or tapping a mat tile lights the matching dice.

### State machine

```
idle ──requestRoll──▶ rolling ──markSettling──▶ settling ──completeRoll──▶ revealing ──(timer)──▶ result
```

Only one roll can be active, including its reveal; every trigger (button, Space/Enter, admin) goes through
the same guard. `completeRoll` is idempotent per roll id, so history gets exactly one entry. A watchdog
completes a stuck roll with its already-selected result; a renderer that is still making progress on a slow
device keeps it at bay with `keepAlive`.

Reduced motion replaces the shaken tumble with a short dip: the dice shrink away where they are and
return showing the recorded faces, followed by the same reveal.

### Face map (`src/dice3d/faceMap.ts`)

The only place that relates symbols to orientation. Die-local frame: unit cube at the origin. World: +Y up,
camera on the +Z side, so "screen-up" for a face lying on the felt is −Z.

| Symbol | Face normal | Artwork up | Opposite |
|---|---|---|---|
| Jhandi | +Y | −Z | Burja |
| Burja  | −Y | +Z | Jhandi |
| Itta   | +X | +Y | Paan |
| Paan   | −X | +Y | Itta |
| Hukum  | +Z | +Y | Chidi |
| Chidi  | −Z | +Y | Hukum |

- Texture orientation: each face decal is a plane whose +Z is the normal and +Y the artwork-up
  (`decalQuaternion`), with UVs into a 3 × 2 atlas cell (`atlasUvRect`).
- `upwardFace(q)` reads which symbol is up for any orientation; the controller drives the recorded face's
  normal to +Y, and `restQuaternion(symbol, yaw)` gives the face-up orientation used by reduced motion.

Real dice vary by maker; this layout is used consistently by the decals, the physics controller, the tests
and the fallback.

## Admin testing (`/admin`)

The `/admin` route adds a panel for choosing each die's face for the next roll, previewing counts, arming or
clearing the override and running a test roll, plus an optional distribution diagnostic.

> **Security note:** this is a client-side prototype with no backend. `/admin` is merely unlinked,
> **not** authenticated. Anyone who can load the app can open it. A hidden route or a client-side PIN is not
> security. If a backend is added, test controls must be authenticated and validated server-side, with
> credentials kept out of the client bundle.

Integrity does not rely on secrecy:

- While an override is armed, while the test roll is in motion, and on its result, the game screen shows a
  **TEST MODE** banner, an outlined tray and a TEST tag on the Roll button.
- The roll is stored with `mode: "test"` and is labelled TEST in history (also after reload).
- The override is consumed by exactly one roll, then fair random mode resumes automatically.
- Overrides live only in memory in the `/admin` tab. Nothing reaches `/` or other tabs.

## Project layout

```
src/
  game/        symbols, SVG artwork (single source), secure RNG, RollRecord, store, history, storage
  dice3d/      face map, collider, shake, live simulation + outcome controller, look-ahead search + worker,
               tray, dice, camera fit, 3D stage
  fallback2d/  2D dice cards (same store and engine)
  components/  header, roll control, result mat, history, help dialog, live region, stage, test banner
  admin/       admin panel, distribution diagnostic
  audio/       procedural Web Audio sounds (no files, no autoplay)
  app/         app-wide store instances, preferences, UI state
  i18n/        English / Nepali strings
```

The six symbols are drawn once as SVG path data in `src/game/symbolArt.ts`. The same paths render the
inline SVG in the UI and, through `Path2D`, the canvas atlas that textures the 3D dice.

## Persistence

`localStorage` keys: `langur-burja:history:v1` (last 20 completed rolls: id, time, faces, mode) and
`langur-burja:prefs:v1` (sound on/off, language). Stored history is validated on load, counts are recomputed
from faces, and corrupted data is discarded. In-progress rolls are never stored. If storage is unavailable
the app keeps working in memory.

## Accessibility & performance

- Semantic buttons, a native `<dialog>` for help, visible focus, named icon buttons, and symbol names
  alongside colour. One polite live-region announcement per completed roll.
- Space/Enter roll only when focus is on the page itself, never inside controls or dialogs.
- Reduced motion swaps the shaken tumble for a quick shrink-and-return in place, then the same reveal.
- Sound is optional, starts only after a user gesture, and the mute preference persists.
- Rendering is on demand (idle frames are free). Device pixel ratio is capped (2, or 1.75 on touch devices).
  Geometry, materials and the symbol atlas are shared by all dice and disposed on unmount. One 1024² shadow
  map, no post-processing. Three.js and physics load in a lazy chunk; the initial bundle is ~83 kB gzip.
- The look-ahead search runs in a Web Worker (~56 kB gzip, loaded with the 3D tray), so it never costs a
  rendered frame; on this development machine a full search takes 0.35–0.5 s (median), well inside the
  ~2 s available.
- Without WebGL, or if the 3D view fails or loses its context, a 2D card view takes over using the same engine.

## Known limitations

- React Three Fiber 9 still constructs `THREE.Clock`, so three.js r18x logs a deprecation warning in the console.
- The 3D chunk is ~280 kB gzip; R3F references the whole three.js namespace, so it cannot be tree-shaken further.
- Sounds are synthesised, so they are deliberately restrained rather than recorded dice.
- Free physics does not always deliver the recorded face in time. With the look-ahead (40 simulated rolls
  per tray shape, `npm run diag:simulation`), 73–93% of rolls need no recovery roll at all and the rest
  average 0.07 (wide) to 0.28 (tall) per roll, none of them started from rest. Without it (no worker, or a
  device too slow to finish the search) it is about 1.6–1.9 per roll, as before the look-ahead, some
  starting from rest. The recovery roll is scripted rather than free physics, and a careful viewer may
  notice it.
- The look-ahead slightly favours calmer endings: dice collide with each other a little less after the
  branch point (median die-to-die contacts per roll ~26–34 vs ~36–41 without it).
- Free-flying dice can overlap the rim or felt by up to ~0.1 die-width for a single 5 ms physics step during
  the hardest hits of the shake (no continuous collision detection); this is not visible at normal speed.
