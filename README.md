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

Development switches (query string):

- `?renderer=2d`: force the 2D fallback (no WebGL).
- `?renderer=3d-fail`: dev builds only; simulate a 3D initialisation crash to exercise recovery.
- `?motion=reduced`: force reduced motion (otherwise follows `prefers-reduced-motion`).

## How a roll works

1. **Outcome first.** `rollStore.requestRoll()` draws six independent faces with `crypto.getRandomValues`
   and creates one frozen `RollRecord` (`id`, `timestamp`, `faces`, derived `counts`, `mode`).
   Everything else (dice, mat, history, the screen-reader announcement) is derived from that object.
2. **Unbiased draws.** `src/game/random.ts` uses rejection sampling: uint32 words at or above
   `2^32 − (2^32 mod 6)` are discarded, so each symbol has exactly a 1-in-6 chance on every die.
   An ESLint rule bans `Math.random` everywhere except `src/dice3d/visualRandom.ts`, which drives launch
   spin and the 2D flicker only.
3. **Physics without a say.** `src/dice3d/rollPlanner.ts` simulates the throw with cannon-es in a few
   milliseconds *before* anything moves, retrying with different (visual-only) launch parameters until all six
   dice rest flat, unstacked and inside the tray. For each die it then picks one of the 24 rotations that map a
   cube onto itself, `R`, so that `settledPose · R` has the recorded symbol on top, and renders the whole track
   as `bodyPose · R`. Because `R` maps the cube onto itself, the rendered die fills exactly the simulated
   volume all the way through (same contacts, same shadows) and nothing snaps. The last 0.22 s blends away
   sub-degree tilt into the exact final pose. If physics fails, a procedural tumble ending on the same faces
   is used.
4. **Playback** (`rollAnimation.ts`) is time-based and starts on the first rendered frame. A short "gather"
   lifts the dice into the throw, then the recorded track plays, with impact sounds scheduled from the
   simulated collisions. Sampling at or past the end always gives the exact final poses, so a dropped frame,
   a hidden tab or a watchdog finish can never show a different face.

### State machine

```
idle ──requestRoll──▶ rolling ──markSettling──▶ settling ──completeRoll──▶ result ──requestRoll──▶ …
```

Only one roll can be active; every trigger (button, Space/Enter, admin) goes through the same guard.
`completeRoll` is idempotent per roll id, so history never gets duplicates. A 9 s watchdog completes a
stuck roll with its already-selected result. A hidden tab finishes the roll immediately on the recorded result.

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
- Final quaternion: `restQuaternion(symbol, yaw)` puts the symbol face-up with its artwork upright to the
  viewer, turned by `yaw`. For physics rolls the final pose is `snapUpright(settled) · R`, where
  `symmetryForTarget` picks the `R` whose artwork reads most upright (always within 45°).
- `upwardFace(q)` reads back which symbol is up. Tests check it for every symbol, yaw and settled pose.

Real dice vary by maker; this layout is used consistently by the decals, planner, tests and fallback.

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
  dice3d/      face map, tray config, physics planner, playback, textures, tray, dice, camera fit, 3D stage
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
- Reduced motion swaps the tumble for a quick shrink-and-reveal at the same final poses.
- Sound is optional, starts only after a user gesture, and the mute preference persists.
- Rendering is on demand (idle frames are free). Device pixel ratio is capped (2, or 1.75 on touch devices).
  Geometry, materials and the symbol atlas are shared by all dice and disposed on unmount. One 1024² shadow
  map, no post-processing. Three.js and physics load in a lazy chunk; the initial bundle is ~82 kB gzip.
- Without WebGL, or if the 3D view fails or loses its context, a 2D card view takes over using the same engine.

## Known limitations

- React Three Fiber 9 still constructs `THREE.Clock`, so three.js r18x logs a deprecation warning in the console.
- The 3D chunk is ~275 kB gzip; R3F references the whole three.js namespace, so it cannot be tree-shaken further.
- Sounds are synthesised, so they are deliberately restrained rather than recorded dice.
