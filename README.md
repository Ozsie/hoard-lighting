# @hoard-engine/lighting

Light sources on a tile grid for the HOARD engine: visibility polygons
via exact ray casting (DDA grid walking with corner pinch rules),
animation effects (pulse, flicker, blink, sway, sweep, sparkle, aura,
gas), quantized repaint signatures and viewport culling. A
dependency-free leaf of the HOARD engine — pure computation, no game,
grid package, framework or canvas knowledge; the consumer renders the
returned light map data.

## Install

```bash
npm install @hoard-engine/lighting
```

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

// Everything that can change occlusion, hashed by you into one token:
const occlusionKey = `${actors}|${doors}|${rooms}|${cellSize}`;

// The lit-area polygon in world pixels (one endpoint per ray).
const polygon = lightPolygonFor(light, env, cellSize, occlusionKey, timeMs);

// How bright the light is right now (0..1), from its animation effect.
const brightness = lightIntensityScale(light, timeMs);
```

Ray endpoints stop at closed edges and fog boundaries at the shared cell
edge, penetrate partway into opaque cells (wall faces and actor sprites
stay lit, the shadow starts behind them), and pass between diagonally
adjacent blockers through their shared corner. Caches (occlusion maps,
visibility polygons, sweep ray endpoints) are scoped by the environment
object and the caller's occlusion key, so the package never re-marches
rays between frames that did not change occlusion.

The package never asks for your game state: the consumer owns which
cells block, which steps are closed, which rooms exist and which lights
are active — and renders the returned polygons, centers, sparkles and
brightness values however it likes (the game renders them as blurred
radial-gradient fills).
