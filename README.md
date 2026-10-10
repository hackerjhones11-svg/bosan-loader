# BOSAN HILLS — opening sequence

A standalone React + Vite app containing the construction‑themed introduction
for the BOSAN HILLS presentation. When it ends, the page is the BOSAN HILLS
wordmark alone on pure black.

From black, a miniature site is set out. A surveyor's station throws the
baseline, and two tower cranes, a small truck and a crew of five assemble the
name from the real letterforms of Cormorant Garamond Medium:

- the stems are cast in lifts;
- the B's bowls are lifted in on a tag line;
- the A's crossbar is raised between its converging legs;
- the O and S are completed along their curves;
- the H crossbar arrives by truck and is set between its uprights as the final,
  quiet placement.

The letters then resolve into a flat white wordmark, the equipment withdraws,
and the name remains on black. The intro's final frame and the page beneath it
render the name pixel‑identically, so the handoff is invisible.

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL (usually http://localhost:5173).

`npm run build` produces a static build in `dist/`; `npm run preview` serves it.
Everything — fonts included — is bundled; there are no third‑party requests at
runtime.

### Reviewing

- **Reload the page** to play the complete introduction again from black.
- **Skip intro** appears bottom right after the opening black (also **Esc**).
- Query parameters for review:

  | parameter       | effect                                                         |
  | --------------- | -------------------------------------------------------------- |
  | `?assets=4000`  | simulate presentation assets that take 4 s to become ready     |
  | `?assets=never` | simulate assets that never arrive (shows the bounded fallback) |
  | `?duration=14`  | change the overall length of the introduction (seconds)        |
  | `?reduced=1`    | force the reduced‑motion version                               |
  | `?debug=1`      | expose `window.__bosanIntro` (`seek(t)`, `play()`, `tl`)       |

## Using the component

`src/intro` is self‑contained; copy the folder (plus `gsap` and the
`@fontsource` packages if you use them for surrounding UI).

```tsx
import { BosanIntro } from './intro';

function Presentation() {
  const [introDone, setIntroDone] = useState(false);
  const assetsReady = useMyPresentationAssets(); // boolean

  return (
    <>
      <OpeningScreen titleHidden={!introDone} />
      {!introDone && (
        <BosanIntro
          assetsReady={assetsReady}
          onComplete={() => setIntroDone(true)}
        />
      )}
    </>
  );
}
```

| prop             | default         | purpose                                                                                                                                                                               |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onComplete`     | —               | called once, after the black has fully opened (`{ skipped, timedOut }`)                                                                                                               |
| `onReveal`       | —               | called as the black begins to open — start the opening screen's own entrance here                                                                                                     |
| `assetsReady`    | `true`          | readiness of the presentation behind the intro. The construction always plays in full; if assets are not ready when it ends, the finished name holds on black — nothing replays and no percentage is shown |
| `maxAssetWait`   | `8000`          | longest (ms) the finished name waits for assets before handing off anyway                                                                                                             |
| `duration`       | `12`            | total length in seconds, including the handoff                                                                                                                                         |
| `reducedMotion`  | media query     | override `prefers-reduced-motion`                                                                                                                                                      |
| `label`          | `'BOSAN HILLS'` | accessible name                                                                                                                                                                         |
| `skippable`      | `true`          | show the Skip intro control after the opening black                                                                                                                                    |
| `lockScroll`     | `true`          | lock page scrolling while the intro is on screen (restored exactly afterwards)                                                                                                        |
| `focusTargetRef` | —               | element to focus if keyboard focus was inside the intro when it ends                                                                                                                   |

A ref exposes `replay()` and `skip()`. Remounting the component (for example
with a new `key`) is an equally clean way to replay; timelines and listeners
are torn down on unmount.

**Seamless handoff.** The intro positions the wordmark with `computeFrame(vw, vh)`.
Draw the opening screen's title with `<WordmarkSvg frame={computeFrame(vw, vh)} />`
in a full‑viewport box (as `src/opening/OpeningPlaceholder.tsx` does) and keep it
hidden until `onComplete`. The title then sits on exactly the same pixels, with
no duplicate and no shift. On viewports narrower than 720 px (or portrait) the
name sets on two lines, BOSAN / HILLS, and the construction site adapts.

Behaviour worth knowing:

- A bounded failsafe ends the intro even if something goes wrong. It counts only
  time the tab is visible, so a page opened in a background tab still plays its
  intro when viewed.
- Reduced motion shows the quiet white wordmark on black and dissolves after
  about 3.5 s, without any construction movement.
- The machinery is `aria-hidden`; the intro exposes the name as an image with an
  accessible label. The page behind is `inert` while the intro plays.

## Structure

```
src/
  intro/
    BosanIntro.tsx     lifecycle: playback, readiness hold, handoff, skip, replay,
                       reduced motion, scroll lock, failsafe
    timeline.ts        the single GSAP timeline and the small rig model (cranes,
                       loads, cables, crew, truck) it animates
    scene/             SVG artwork: IntroScene, tower crane + hook rig, truck,
                       articulated worker figure
    site.ts            the construction site laid out around the real glyph positions
    parts.ts           letter components cut from the exact glyph outlines
    layout.ts          tracking, optical pair spacing, one‑ and two‑line settings
    frame.ts           shared placement of the wordmark for intro and opening screen
    glyphData.ts       generated outlines (npm run glyphs)
  opening/             the opening screen: the wordmark alone on black
scripts/extract-glyphs.mjs   regenerates glyphData.ts from the bundled font
```

The wordmark is drawn from the font's actual outlines, extracted at build time.
It never depends on a web font loading and cannot shift when fonts arrive.
Cormorant Garamond and Inter are licensed under the SIL Open Font License 1.1.
