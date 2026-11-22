# @hoard-engine/lighting

Light sources on a tile grid for the HOARD engine: visibility polygons
via exact ray casting (DDA grid walking with corner pinch rules),
animation effects (pulse, flicker, blink, sway, sweep, sparkle, aura,
gas), quantized repaint signatures and viewport culling. A
dependency-free leaf of the HOARD engine — pure computation, no game,
grid package, framework or canvas knowledge; the consumer renders the
returned light map data.

## Pluggable, interoperable, standalone

HOARD engine packages share the same design goals:

- **Pluggable.** Adopt a package on its own, or swap it out, without
  touching the rest of the engine — there is no central engine object
  to install and no package that owns the others.
- **Interoperable.** Packages compose with each other and with
  consumer code through data: minimal shapes, callback seams and plain
  values — never through shared state or a common framework.
- **As standalone as possible.** Each package is usable as-is in any
  project, HOARD-based or not; the leaf packages carry no dependencies
  and import no siblings.

This package meets all three by construction.

## Install

```bash
npm install @hoard-engine/lighting
```

Requires Node 18+ (ESM only).

## Usage

The package computes against a `LightingEnv` you define — every piece
of game knowledge is a callback (no state, no grid types imported):

```ts
import {
  createLight,
  lightPolygonFor,
  lightIntensityScale,
  type LightingEnv,
} from '@hoard-engine/lighting';

const env: LightingEnv = {
  gridWidth: 10,
  gridHeight: 10,
  // Raw cell facts: 'opaque' blocks but is lit, 'fog' blocks at its near
  // edge, 'actor' blocks unless ceiling/own-cell rules apply.
  cellOcclusion: (x, y) => (isWall(x, y) ? 'opaque' : unseen(x, y) ? 'fog' : 'open'),
  // Whether the step between two cells is blocked (closed door, wall edge).
  isStepBlocked: (from, to) => closedDoorOrWallEdge(from, to),
  // The region a cell belongs to; a gas cloud stays inside its region.
  roomOf: (x, y) => roomCharacter(x, y),
};

const light = createLight(2, 3); // color, radius, intensity, softness defaults

// Everything that can change occlusion, hashed by you into one token —
// including cellSize (see "Cache invalidation contract" below):
const occlusionKey = `${revision}|${actors}|${doors}|${rooms}|${cellSize}`;

// The lit-area polygon in world pixels (one endpoint per ray).
const polygon = lightPolygonFor(light, env, cellSize, occlusionKey, timeMs);

// How bright the light is right now (0..1), from its animation effect.
const brightness = lightIntensityScale(light, timeMs);
```

The package never asks for your game state: the consumer owns which
cells block, which steps are closed, which rooms exist and which lights
are active — and renders the returned polygons, centers, sparkles and
brightness values however it likes (the game renders them as blurred
radial-gradient fills).

## Falloff profiles

The package supplies visibility geometry and effect scalars; the rendered
attenuation is the consumer's. To let both projections share one curve,
the pure falloff scalar is here too: `lightFalloffAt` evaluates a profile
at a world-pixel distance from the light center, and
`sampleFalloffProfile` returns the same curve as an evenly spaced lookup
table to map onto gradient stops — `sampleFalloffProfile('legacy', 9)`
reproduces the nine stops of the legacy top-down gradient.

| Profile   | Curve                | Notes                                                                          |
| --------- | -------------------- | ------------------------------------------------------------------------------ |
| `legacy`  | `(1 - t)^2`          | The historically rendered falloff; the default when no profile is named        |
| `linear`  | `(1 - t)`            | The isometric consumer's current linear gradient                               |
| `smooth`  | `1 - smoothstep(t)`  | Flat at center and edge; a shared curve either projection can adopt for parity |

No new profile is implicit: pass the profile explicitly, and the
unnamed default stays the compatibility `legacy` profile, so existing
consumers keep their current intensity/visibility outputs until they opt
in. The falloff scalar is pure (0..1) — multiply it by the light's
intensity and animation scale as before — and no falloff choice softens
or changes the hard visibility polygon. Gradient construction, CSS-color
parsing/alpha and compositing remain renderer concerns.

## Cache invalidation contract

The occlusion-map, polygon and sweep-endpoint caches are scoped by the
environment object identity plus your `occlusionKey` token. The package
cannot see your game state, so the key is the whole contract: **it must
change whenever anything the `LightingEnv` callbacks can read changes —
doors, actors, fog/discovery, room data — and whenever `cellSize`
changes.** Reusing an old key after such a change silently reuses stale
occlusion data; `src/polygons.test.ts` ("occlusion cache invalidation
contract") pins down both sides of that behavior.

A stable environment with a changing revision token:

```ts
let revision = 0;
// ...whenever occlusion-relevant state changes:
revision += 1;

const env: LightingEnv = {
  gridWidth: 10,
  gridHeight: 10,
  cellOcclusion: (x, y) => /* reads live state */ 'open',
  isStepBlocked: (from, to) => /* reads live state */ false,
  roomOf: (x, y) => /* reads live state */ '',
};

// One token covering everything the callbacks can read, plus cellSize:
const occlusionKey = `rev-${revision}-${cellSize}`;
const polygon = lightPolygonFor(light, env, cellSize, occlusionKey, timeMs);
```

Two different environment objects never share a cache, even under the
same key. The polygon cache is bounded by
`MAX_LIGHT_POLYGON_CACHE_ENTRIES`, evicting the oldest entry first; the
occlusion-map, polygon and sweep-endpoint caches each hold only the
last-used environment+key, so alternating among several environments
within one frame recomputes on every switch.

## API

| Export                                                                                                | Description                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lightPolygonFor(light, env, cellSize, occlusionKey, timeMs?)`                                        | The lit-area polygon in world pixels (one endpoint per ray), from cache when occlusion has not changed                                                       |
| `computeLightPolygon(light, env, cellSize, occlusionKey, timeMs?)`                                    | The same polygon, computed directly — `lightPolygonFor` caches on top of it                                                                                  |
| `MAX_LIGHT_POLYGON_CACHE_ENTRIES`                                                                     | The polygon cache bound (64), keyed by geometry, the oldest entry evicted first                                                                              |
| `LightingEnv`                                                                                         | The consumer-defined environment: grid size plus the `cellOcclusion`, `isStepBlocked` and `roomOf` callbacks                                                 |
| `createLight(x, y, alignment?, options?)`                                                             | Creates a light source at a cell, filling in the default values                                                                                              |
| `LightSource`                                                                                         | A light source on the tile grid — the minimal shape the package consumes, structurally typed                                                                 |
| `LightEffect`                                                                                         | Animation effect values: 'static', 'pulse', 'flicker', 'sweep', 'sway', 'blink', 'sparkle', 'aura', 'gas' — open-ended, unknown values fall back to 'static' |
| `LightAlignment`                                                                                      | Where a light sits in its cell: corner and edge alignments, plus 'ceiling' for fixtures shining from above                                                   |
| `DEFAULT_LIGHT_COLOR` / `DEFAULT_LIGHT_RADIUS` / `DEFAULT_LIGHT_INTENSITY` / `DEFAULT_LIGHT_SOFTNESS` | Default light values: `'#FFB85C'`, 4 cells, 0.35, 0.25                                                                                                       |
| `LightOcclusion`                                                                                      | Raw cell occlusion facts: 'opaque', 'fog', 'actor', 'open'                                                                                                   |
| `LightCellBlock`                                                                                      | How light interacts with a cell: 'opaque' (blocks but is lit), 'fog' (blocks at its near edge), 'none'                                                       |
| `lightInViewport(light, viewport?)`                                                                   | Whether the light's glow can reach the viewport; gas lights always pass                                                                                      |
| `LightViewport`                                                                                       | The visible rectangle of the world, in grid cells — without it, every light counts as visible                                                                |
| `lightIntensityScale(light, timeMs)`                                                                  | The light's brightness multiplier (0..1) at a given time, from its animation effect                                                                          |
| `isAnimatedLight(light)`                                                                              | Whether the light animates and so needs per-frame evaluation                                                                                                 |
| `animatedLightSignature(light, timeMs)`                                                               | The quantized animation state as a comparable string — equal signatures produce identical output, so a consumer can skip the repaint                         |
| `lightRate(light)` / `DEFAULT_LIGHT_RATE`                                                             | The effect's loops per second (minimum 0.01, default 1)                                                                                                      |
| `lightSwayOffset(light, cellSize, timeMs)`                                                            | The pendulum offset of a swaying light's center, in pixels (zero for others)                                                                                 |
| `SWAY_STEP_CELLS`                                                                                     | The visible sway movement step: 1/32 of a cell, about a device pixel                                                                                         |
| `lightSweepAngle(light, timeMs)`                                                                      | The rotation angle of a sweep light's beam in radians, or undefined when it does not sweep                                                                   |
| `lightBlurPx(light, cellSize)`                                                                        | The blur radius in pixels for the light's shadow edges, from its softness (0..1)                                                                             |
| `LightFalloffProfile`                                                                                 | Named falloff curves: `'legacy'` (quadratic `(1-t)^2`, the compatibility default), `'linear'`, `'smooth'` — open-ended, unknown values evaluate as `'legacy'`  |
| `DEFAULT_FALLOFF_PROFILE`                                                                             | The profile used when none is named: `'legacy'` — a new profile is never implicit                                                                             |
| `falloffScalar(profile, t)`                                                                           | The falloff scalar in [0, 1] at normalized distance `t` (0 center, 1 radius edge); out-of-range clamps, NaN reads as 0                                        |
| `lightFalloffAt(light, cellSize, distancePx, profile?)`                                               | The falloff scalar at a world-pixel distance from the light center; zero/invalid radius means no reach beyond the center                                     |
| `sampleFalloffProfile(profile, sampleCount)`                                                          | The profile sampled into `sampleCount` evenly spaced scalars from center to edge — a lookup table for gradient stops                                         |
| `hash01(n)`                                                                                           | A deterministic pseudo-random value in [0, 1) — flicker and sparkles render the same at the same instant                                                     |
| `lightCenter(light, cellSize, timeMs?)`                                                               | The glow center in world pixels: the cell center, shifted by the alignment, plus the sway offset                                                             |
| `isCeilingLight(light)`                                                                               | Whether the light shines down from above — fully illuminating and ignoring actors                                                                            |
| `lightBlockFromOcclusion(light, occlusion, cell)`                                                     | The per-light rule for a raw occlusion fact: the light's own cell and ceiling lights never block                                                             |
| `lightBlockInCell(light, env, cell)`                                                                  | The same ruling, asked straight to the environment                                                                                                           |
| `computeSparkles(light, cellSize, timeMs)`                                                            | The currently visible sparkles of a light — twinkles inside its own cell, only brightness changing over time                                                 |
| `Sparkle`                                                                                             | One twinkle: center in pixels, arm half-length, and alpha 0..1                                                                                               |
| `Position`                                                                                            | A grid position in cell coordinates                                                                                                                          |

## Design notes

- Ray endpoints stop at closed edges and fog boundaries at the shared
  cell edge, penetrate partway into opaque cells (wall faces and actor
  sprites stay lit, the shadow starts behind them), and pass between
  diagonally adjacent blockers through their shared corner.
- Per-light rules: the light's own cell never blocks, and a ceiling
  light shines over actors ('opaque' and 'fog' cells still block it).
- Caches (occlusion maps, visibility polygons, sweep ray endpoints) are
  scoped by the environment object and the caller's occlusion key, so
  the package never re-marches rays between frames that did not change
  occlusion — see "Cache invalidation contract" above for what the key
  must cover. The polygon cache is keyed by geometry, not object
  identity — freshly recreated light objects still hit it — and is
  bounded by `MAX_LIGHT_POLYGON_CACHE_ENTRIES`, evicting the oldest
  entry first.

## Development

```bash
npm test          # vitest
npm run check     # tsc --noEmit
npm run lint      # eslint over src
npm run prettier  # prettier --check (fix via prettier:format)
npm run build     # tsc declarations + esbuild ESM bundle to dist/
npm publish       # prepublishOnly runs check + build + test first
```
