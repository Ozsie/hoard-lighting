import { lightCenter } from './alignment';
import { SWAY_STEP_CELLS, lightSweepAngle } from './effects';
import { DEFAULT_LIGHT_RADIUS } from './lights';
import { lightBlockFromOcclusion } from './occlusion';
import { LightEffect, LightOcclusion as Occlusion } from './types';
import type {
  LightCellBlock,
  LightingEnv,
  LightSource,
  LightViewport,
  Position,
} from './types';

// Number of rays cast around a light source to build its visibility polygon.
const LIGHT_RAY_COUNT = 120;
// Blocker detection resolution, in sample points per cell: a ray only
// interacts with a cell it is still inside at one of these evenly spaced
// points along its length, so a cell the ray merely clips — a corner sliver
// between two sample points — never blocks. This is what lets light pass
// between diagonally adjacent blockers through their shared corner.
const LIGHT_RAY_STEPS_PER_CELL = 6;

// How far light reaches into a blocking ('opaque') cell, as a fraction of
// the ray's path through that cell. Enough to illuminate the near half — the
// wall face, or an actor sprite which sits near the middle of its cell —
// but not through the whole cell, which would look like the light passes
// out the other side.
const OPAQUE_CELL_PENETRATION = 0.5;

// Half the opening angle of a sweep light's beam.
const SWEEP_BEAM_HALF_ANGLE = Math.PI / 4;

// How far beyond its radius a light can still be seen, in cells: the
// softness blur reaches up to half a cell past the pool edge. This also
// covers a swaying light's swing, which stays well under half a cell.
const VIEWPORT_CULL_MARGIN_CELLS = 0.5;

// Whether a light's glow can reach the viewport; lights further away are
// culled entirely. The glow is bounded by a circle of the light's radius
// around its cell: every alignment keeps the glow center inside its own
// cell or on the cell's edge (the CENTER_* alignments), and a swaying
// light's swing is covered by the margin. Gas lights have no cheap bound
// (they fill their whole room region) and always pass.
export const lightInViewport = (
  light: LightSource,
  viewport?: LightViewport,
): boolean => {
  if (!viewport) return true;
  if (light.effect === LightEffect.GAS) return true;
  const centerX = light.position.x + 0.5;
  const centerY = light.position.y + 0.5;
  const extent =
    Math.max(light.radius ?? DEFAULT_LIGHT_RADIUS, 1) +
    VIEWPORT_CULL_MARGIN_CELLS;
  const nearestX = Math.min(
    Math.max(centerX, viewport.x),
    viewport.x + viewport.width,
  );
  const nearestY = Math.min(
    Math.max(centerY, viewport.y),
    viewport.y + viewport.height,
  );
  const dx = centerX - nearestX;
  const dy = centerY - nearestY;
  return dx * dx + dy * dy <= extent * extent;
};

// --- Occlusion map --------------------------------------------------------

// Per-cell light blocking, precomputed once per occlusion state (a move, a
// door, a discovery) so the rays do not re-query the environment for every
// cell they cross. The map holds the raw cell facts only; the light-specific
// rules — a ceiling light ignoring actors, the light's own cell never
// blocking — are applied at lookup time.
type OcclusionMap = {
  data: Uint8Array;
  width: number;
  height: number;
};

const encodeOcclusion = (occlusion: Occlusion): number => {
  switch (occlusion) {
    case Occlusion.OPAQUE:
      return 1;
    case Occlusion.FOG:
      return 2;
    case Occlusion.ACTOR:
      return 3;
    default:
      return 0;
  }
};

// Builds the occlusion map for an environment: one raw occlusion fact per
// cell of the grid rectangle, from the consumer's callbacks. Cells outside
// the rectangle read as fog, like `findCell` returning '' on a letter grid.
const buildOcclusionMap = (env: LightingEnv): OcclusionMap => {
  const width = env.gridWidth;
  const height = env.gridHeight;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = encodeOcclusion(env.cellOcclusion(x, y));
    }
  }
  return { data, width, height };
};

// Occlusion maps cached per environment object and occlusion key. A
// consumer's environment reads its state through the callbacks, so the
// occlusion key — an opaque token the caller computes from everything that
// can change occlusion — invalidates the map. Two different environments
// that happen to share a key never share a map.
let occlusionMapCache: {
  env: LightingEnv;
  key: string;
  map: OcclusionMap;
} | null = null;

const occlusionMapFor = (env: LightingEnv, key: string): OcclusionMap => {
  if (
    !occlusionMapCache ||
    occlusionMapCache.env !== env ||
    occlusionMapCache.key !== key
  ) {
    occlusionMapCache = { env, key, map: buildOcclusionMap(env) };
  }
  return occlusionMapCache.map;
};

// How a ray reads the occlusion map, applying the light-specific rules the
// raw map cannot encode. Cells outside it read as fog.
const lightBlockFromMap = (
  map: OcclusionMap,
  cell: Position,
  light: LightSource,
): LightCellBlock => {
  const { x, y } = cell;
  const occlusion: Occlusion =
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Occlusion.FOG
      : decodeOcclusion(map.data[y * map.width + x]);
  return lightBlockFromOcclusion(light, occlusion, cell);
};

const decodeOcclusion = (value: number): Occlusion =>
  value === 1
    ? Occlusion.OPAQUE
    : value === 2
      ? Occlusion.FOG
      : value === 3
        ? Occlusion.ACTOR
        : Occlusion.OPEN;

// Where a ray from `center` crosses the far edge of the given cell along
// the ray direction (capped at the light's radius). For the ray's previous
// cell this is also its entry point into the next cell.
const rayExitThroughCell = (
  center: Position,
  dirX: number,
  dirY: number,
  cell: Position,
  cellSize: number,
  radiusPx: number,
): Position => {
  const tX =
    dirX === 0
      ? Infinity
      : ((dirX > 0 ? cell.x + 1 : cell.x) * cellSize - center.x) / dirX;
  const tY =
    dirY === 0
      ? Infinity
      : ((dirY > 0 ? cell.y + 1 : cell.y) * cellSize - center.y) / dirY;
  const t = Math.min(tX, tY, radiusPx);
  return { x: center.x + dirX * t, y: center.y + dirY * t };
};

// --- Chord refinement ------------------------------------------------------

// A fixed circle of rays is a tessellation. Two adjacent rays can stop on
// different geometry — one on a wall's west face, its neighbor around the
// wall's south-west corner — and the straight chord between those
// endpoints then cuts across the wall corner's interior. The triangle
// that chord spans is lit ink bleeding onto the far side of walls.
// Refinement walks the polygon's chords and repairs exactly the chords
// whose segments sample a blocker's interior: face, edge and corner stops
// all land on cell boundary lines, so when such a chord's endpoints sit
// on two perpendicular boundary lines, inserting the lines' corner
// replaces it with the wall-hugging L-path — the true visibility
// boundary. Chords without a perpendicular-line pair fall back to an
// angular bisection probe: a fresh ray marches at the sector's mid-angle
// and its endpoint is inserted, converging on the transition angle. Every
// probe marches with the very same walk and blocking rules as a base
// ray, so blocking and propagation semantics never change — only the
// tessellation tightens. Sweep beams keep the bare fixed-ray polygon:
// their assembly is index-parallel to the rays, and an open-water cone
// has no corners to overshoot.

// How close a point's cell coordinates must be to a whole cell line to
// count as sitting on that boundary line; float noise never gets close.
const CHORD_LINE_EPS = 0.01;

// A chord only counts as cutting a blocker when its sampled points reach
// this deep into the cell interior; chords riding face lines stay clean.
const CHORD_LEAK_INSET_PX = 0.5;

// Perpendicular corner insertion repairs a chord completely; the
// bisection fallback needs its recursion depth bounded.
const CHORD_REFINE_DEPTH = 4;

// Angular slack when checking that an inserted vertex keeps the polygon's
// angular vertex order (radians).
const CHORD_ANGLE_EPS = 0.05;

// Absolute budget for refinement inserts, so pathological environments
// cannot grow a polygon without bound.
const MAX_REFINED_POINT_COUNT = 240;

// Casts `LIGHT_RAY_COUNT` rays from the light source and returns the polygon
// (in world pixel coordinates) of the lit area. Each ray walks the grid cell
// by cell, from one boundary crossing to the next, and stops at the first
// blocker: a blocked step (closed door or wall edge — stopped at the shared
// edge), a fog cell (stopped at its near edge) or an opaque cell — which is
// lit partway in, so the shadow starts behind it — or the light's radius.
// Rays pass freely between diagonally adjacent opaque cells, through their
// shared corner. The chord refinement pass then tightens the polygon wherever
// a straight chord between adjacent rays would cut across shadow, so no lit
// wedge bleeds behind a wall (see above). For sweep lights only the rays
// within the rotating beam cone contribute; the rest collapse onto the light
// source — assembled from the cached ray endpoints without marching anything.
export const computeLightPolygon = (
  light: LightSource,
  env: LightingEnv,
  cellSize: number,
  occlusionKey: string,
  timeMs = 0,
): Position[] =>
  computeLightPolygonPoints(light, env, cellSize, occlusionKey, timeMs, true);

// The polygon computation itself. `refine` decides whether the bare
// fixed-ray polygon gets the chord refinement pass: sweep lights need
// the bare endpoints in fixed index order (their beam assembly maps
// index -> angle), everyone else wants the leak-tight polygon.
const computeLightPolygonPoints = (
  light: LightSource,
  env: LightingEnv,
  cellSize: number,
  occlusionKey: string,
  timeMs: number,
  refine: boolean,
): Position[] => {
  const center = lightCenter(light, cellSize, timeMs);
  // Gas lights ignore their radius: the cloud expands until it leaves the
  // room region containing the light.
  const isGas = light.effect === LightEffect.GAS;
  const gasRoom = isGas
    ? env.roomOf(light.position.x, light.position.y)
    : undefined;
  const radiusPx = isGas
    ? Number.POSITIVE_INFINITY
    : (light.radius ?? DEFAULT_LIGHT_RADIUS) * cellSize;
  const map = occlusionMapFor(env, occlusionKey);
  // The midpoint of the shared edge between two adjacent cells, in world
  // pixels — where a ray stops when a door, wall or fog blocks the step.
  const sharedEdgeMidpoint = (from: Position, to: Position): Position => ({
    x: ((from.x + to.x) / 2 + 0.5) * cellSize,
    y: ((from.y + to.y) / 2 + 0.5) * cellSize,
  });
  // Where a ray entering `cell` from `from` stops, or null when the ray
  // passes through and the walk should continue.
  const rayStopInCell = (
    from: Position,
    cell: Position,
    dirX: number,
    dirY: number,
  ): Position | null => {
    if (gasRoom !== undefined && env.roomOf(cell.x, cell.y) !== gasRoom) {
      // Gas stays inside its room region: stop at the region boundary, so
      // the cloud never spills through open doorways or into other rooms.
      return sharedEdgeMidpoint(from, cell);
    }
    if (env.isStepBlocked(from, cell)) {
      // Stop at the shared edge the closed door or wall occupies, so its
      // face stays lit while the shadow starts behind it. Diagonal
      // transitions use the pinch-point rule, so a corner closed by two
      // walls stops the ray as well.
      return sharedEdgeMidpoint(from, cell);
    }
    const block = lightBlockFromMap(map, cell, light);
    if (block === 'opaque') {
      // Illuminate the blocking cell partway from its entry edge: enough
      // to light the wall face or actor sprite, so light never appears to
      // pass through the whole cell. The shadow starts right behind it.
      const entry = rayExitThroughCell(
        center,
        dirX,
        dirY,
        from,
        cellSize,
        radiusPx,
      );
      const exit = rayExitThroughCell(
        center,
        dirX,
        dirY,
        cell,
        cellSize,
        radiusPx,
      );
      return {
        x: entry.x + (exit.x - entry.x) * OPAQUE_CELL_PENETRATION,
        y: entry.y + (exit.y - entry.y) * OPAQUE_CELL_PENETRATION,
      };
    }
    if (block === 'fog') {
      // Undiscovered or outside the grid: light stops at the near edge.
      return sharedEdgeMidpoint(from, cell);
    }
    return null;
  };
  // For sweep lights: the beam only covers rays within its half angle of
  // the sweep direction; the rest collapse onto the light source.
  const sweep = lightSweepAngle(light, timeMs);
  if (sweep !== undefined) {
    // A sweep beam only selects which rays contribute to the polygon:
    // each ray's endpoint is time-independent, so all 120 endpoints are
    // marched once per occlusion state and every frame just re-selects
    // the rays inside the rotating beam — no per-frame ray marching.
    const endpoints = sweepRayEndpointsFor(light, env, cellSize, occlusionKey);
    return endpoints.map((endpoint, index) => {
      const angle = (2 * Math.PI * index) / LIGHT_RAY_COUNT;
      let diff = Math.abs(angle - sweep) % (2 * Math.PI);
      if (diff > Math.PI) {
        diff = 2 * Math.PI - diff;
      }
      return diff > SWEEP_BEAM_HALF_ANGLE
        ? { x: center.x, y: center.y }
        : endpoint;
    });
  }

  // The single-ray walk every ray runs — the base circle and every
  // refinement probe alike. Marches from the light center along the unit
  // direction and returns the ray's endpoint.
  const marchRay = (dirX: number, dirY: number): Position => {
    let end: Position = {
      x: center.x + dirX * radiusPx,
      y: center.y + dirY * radiusPx,
    };
    let prevCell = light.position;
    // Exact grid traversal: each step jumps to the next grid line the ray
    // crosses (a DDA walk), visiting every cell along the ray. A cell only
    // blocks when the ray is still inside it at one of the evenly spaced
    // sample points — cells the ray merely clips are skipped, which lets
    // light pass between diagonally adjacent blockers. Skipped cells also
    // leave `prevCell` untouched, so the next checked cell is entered from
    // the last checked one, diagonally when the walk stepped around a
    // corner — matching the pinch-point rule for diagonal transitions.
    const sampleStep = cellSize / LIGHT_RAY_STEPS_PER_CELL;
    let cellX = Math.floor(center.x / cellSize);
    let cellY = Math.floor(center.y / cellSize);
    const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
    const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
    let tMaxX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : ((stepX > 0 ? cellX + 1 : cellX) * cellSize - center.x) / dirX;
    let tMaxY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : ((stepY > 0 ? cellY + 1 : cellY) * cellSize - center.y) / dirY;
    const tDeltaX =
      stepX === 0 ? Number.POSITIVE_INFINITY : cellSize / Math.abs(dirX);
    const tDeltaY =
      stepY === 0 ? Number.POSITIVE_INFINITY : cellSize / Math.abs(dirY);

    // A swaying, corner-aligned light can start with its center in a cell
    // other than its nominal one; that first cell is entered from the
    // light's own cell, like every other step of the walk.
    if (cellX !== prevCell.x || cellY !== prevCell.y) {
      const tOut = Math.min(tMaxX, tMaxY);
      if (sampleStep < tOut && sampleStep <= radiusPx) {
        const stop = rayStopInCell(
          prevCell,
          { x: cellX, y: cellY },
          dirX,
          dirY,
        );
        if (stop) {
          return stop;
        }
        prevCell = { x: cellX, y: cellY };
      }
    }

    for (;;) {
      const tNext = Math.min(tMaxX, tMaxY);
      if (tNext >= radiusPx) {
        break;
      }
      // A ray crossing an exact grid corner steps diagonally into the cell
      // beyond it; the pinch-point rule then decides whether the diagonal
      // step is blocked.
      const advanceX = tMaxX === tNext;
      const advanceY = tMaxY === tNext;
      if (advanceX) {
        cellX += stepX;
        tMaxX += tDeltaX;
      }
      if (advanceY) {
        cellY += stepY;
        tMaxY += tDeltaY;
      }
      // The first sample point inside this cell, if any: the ray only
      // interacts with cells it is still inside at a sample point.
      const tOut = Math.min(tMaxX, tMaxY);
      const tSample = Math.max(1, Math.ceil(tNext / sampleStep)) * sampleStep;
      if (tSample < tOut && tSample <= radiusPx) {
        const cell = { x: cellX, y: cellY };
        const stop = rayStopInCell(prevCell, cell, dirX, dirY);
        if (stop) {
          end = stop;
          break;
        }
        prevCell = cell;
      }
    }
    return end;
  };

  // --- Chord refinement (see the section comment above) -------------------

  // One polygon vertex: a point paired with the angle of the ray it came
  // from, so repair inserts stay in angular order.
  type RayEnd = { angle: number; point: Position };

  // Whether the straight segment between two polygon points samples a
  // blocker's interior (deeper than the face-riding tolerance).
  const chordCutsBlocker = (lo: Position, hi: Position): boolean => {
    const steps = Math.max(
      2,
      Math.ceil(Math.hypot(hi.x - lo.x, hi.y - lo.y) / 2),
    );
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = lo.x + (hi.x - lo.x) * t;
      const y = lo.y + (hi.y - lo.y) * t;
      const cell = {
        x: Math.floor(x / cellSize),
        y: Math.floor(y / cellSize),
      };
      if (lightBlockFromMap(map, cell, light) !== 'opaque') {
        continue;
      }
      const fx = x - cell.x * cellSize;
      const fy = y - cell.y * cellSize;
      if (
        Math.min(fx, cellSize - fx, fy, cellSize - fy) > CHORD_LEAK_INSET_PX
      ) {
        return true;
      }
    }
    return false;
  };

  // The cell boundary line a polygon point sits on, or null when it lies
  // in a cell's interior (a radius stop, an actor's half-way stop).
  const boundaryLineOf = (
    point: Position,
  ): { axis: 'x' | 'y'; at: number } | null => {
    const onX = Math.abs(point.x / cellSize - Math.round(point.x / cellSize));
    const onY = Math.abs(point.y / cellSize - Math.round(point.y / cellSize));
    if (onX <= CHORD_LINE_EPS && onY > CHORD_LINE_EPS) {
      return { axis: 'x', at: point.x };
    }
    if (onY <= CHORD_LINE_EPS && onX > CHORD_LINE_EPS) {
      return { axis: 'y', at: point.y };
    }
    return null;
  };

  // Clockwise angular distance between two ray angles.
  const ccwDiff = (from: number, to: number): number => {
    const twoPi = 2 * Math.PI;
    return (((to - from) % twoPi) + twoPi) % twoPi;
  };

  // Repairs the chord lo -> hi by inserting vertices before hi's position
  // in `out`: the perpendicular-line corner exact fix first, the angular
  // bisection probe as the fallback.
  const refineChordInto = (
    lo: RayEnd,
    hi: RayEnd,
    depth: number,
    out: RayEnd[],
  ): void => {
    if (depth <= 0 || out.length >= MAX_REFINED_POINT_COUNT) {
      return;
    }
    if (!chordCutsBlocker(lo.point, hi.point)) {
      return;
    }
    const loLine = boundaryLineOf(lo.point);
    const hiLine = boundaryLineOf(hi.point);
    if (loLine && hiLine && loLine.axis !== hiLine.axis) {
      const corner =
        loLine.axis === 'x'
          ? { x: loLine.at, y: hiLine.at }
          : { x: hiLine.at, y: loLine.at };
      const angle = Math.atan2(corner.y - center.y, corner.x - center.x);
      const width = ccwDiff(lo.angle, hi.angle);
      if (ccwDiff(lo.angle, angle) <= width + CHORD_ANGLE_EPS) {
        const mid: RayEnd = { angle, point: corner };
        refineChordInto(lo, mid, depth - 1, out);
        out.push(mid);
        refineChordInto(mid, hi, depth - 1, out);
        return;
      }
    }
    // Fallback: bisect the sector's angle, march a fresh ray there and
    // insert its endpoint; the halves recurse on the same rule.
    const midAngle = lo.angle + ccwDiff(lo.angle, hi.angle) / 2;
    const point = marchRay(Math.cos(midAngle), Math.sin(midAngle));
    if (
      Math.hypot(point.x - lo.point.x, point.y - lo.point.y) < 0.05 &&
      Math.hypot(point.x - hi.point.x, point.y - hi.point.y) < 0.05
    ) {
      return;
    }
    const mid: RayEnd = { angle: midAngle, point };
    refineChordInto(lo, mid, depth - 1, out);
    out.push(mid);
    refineChordInto(mid, hi, depth - 1, out);
  };

  // The base circle of rays; the repair pass runs over the consecutive
  // pairs unless the caller needs the bare fixed-order endpoints (sweep
  // beams).
  const base: RayEnd[] = [];
  for (let i = 0; i < LIGHT_RAY_COUNT; i++) {
    const angle = (2 * Math.PI * i) / LIGHT_RAY_COUNT;
    base.push({ angle, point: marchRay(Math.cos(angle), Math.sin(angle)) });
  }
  if (!refine) {
    return base.map((ray) => ray.point);
  }
  const out: RayEnd[] = [];
  for (let i = 0; i < base.length; i++) {
    out.push(base[i]);
    refineChordInto(
      base[i],
      base[(i + 1) % base.length],
      CHORD_REFINE_DEPTH,
      out,
    );
  }
  return out.map((ray) => ray.point);
};

// Cache for light visibility polygons. A polygon depends only on the
// light's geometry and the occlusion state — actor positions, door states,
// fog of war, cell size — none of which change between animation frames,
// so animated lights reuse their polygon instead of re-marching rays every
// frame. Sway lights cache per quantized center step (their polygon moves
// with the swing); sweep lights never enter this cache — their beams
// assemble from the ray endpoint cache instead.
//
// The cache is keyed by a stable geometry string, not by object identity:
// consumers commonly recreate derived lights (carried items, effects,
// projectiles) as fresh objects on every frame, so an identity-keyed map
// would miss every frame and re-march all their rays. The bound keeps a
// long animation with changing lights from growing the cache without
// limit; the oldest entry is evicted first (Maps iterate in insertion
// order).
export const MAX_LIGHT_POLYGON_CACHE_ENTRIES = 64;

const lightPolygonCacheKey = (light: LightSource): string =>
  [
    light.id ?? '',
    light.position.x,
    light.position.y,
    light.alignment ?? '',
    light.radius ?? '',
    light.effect ?? '',
  ].join(',');

let lightPolygonCache: {
  env: LightingEnv;
  key: string;
  polygons: Map<string, { points: Position[]; center: Position }>;
} | null = null;

// The light's visibility polygon, from cache when the occlusion state has
// not changed since it was last computed. `occlusionKey` is the caller's
// token for everything that can change occlusion.
export const lightPolygonFor = (
  light: LightSource,
  env: LightingEnv,
  cellSize: number,
  occlusionKey: string,
  timeMs = 0,
): Position[] => {
  if (light.effect === LightEffect.SWEEP) {
    // The beam assembles from the per-occlusion ray endpoint cache; no
    // marching happens per frame.
    return computeLightPolygon(light, env, cellSize, occlusionKey, timeMs);
  }
  if (
    !lightPolygonCache ||
    lightPolygonCache.env !== env ||
    lightPolygonCache.key !== occlusionKey
  ) {
    lightPolygonCache = {
      env,
      key: occlusionKey,
      polygons: new Map(),
    };
  }
  const cacheKey = lightPolygonCacheKey(light);
  const center = lightCenter(light, cellSize, timeMs);
  const cached = lightPolygonCache.polygons.get(cacheKey);
  if (cached) {
    // A swaying light's polygon follows its swinging center: recompute
    // only once the center has moved a visible step (1/32 cell, the same
    // quantum the repaint signature uses). The swing arm is 0.6 cells,
    // so the steps are invisible while the marching drops from every
    // frame to a handful of times per second.
    if (
      light.effect !== LightEffect.SWAY ||
      Math.hypot(center.x - cached.center.x, center.y - cached.center.y) <=
        SWAY_STEP_CELLS * cellSize
    ) {
      return cached.points;
    }
  }
  const points = computeLightPolygon(
    light,
    env,
    cellSize,
    occlusionKey,
    timeMs,
  );
  if (lightPolygonCache.polygons.size >= MAX_LIGHT_POLYGON_CACHE_ENTRIES) {
    // Evict the oldest entry: Map keys iterate in insertion order.
    for (const oldest of lightPolygonCache.polygons.keys()) {
      lightPolygonCache.polygons.delete(oldest);
      break;
    }
  }
  lightPolygonCache.polygons.set(cacheKey, { points, center });
  return points;
};

// Cache of the ray endpoints of every sweep light, one marching pass per
// occlusion state: the rotating beam only re-selects rays, it never
// changes an endpoint.
let sweepEndpointCache: {
  env: LightingEnv;
  key: string;
  endpoints: Map<string, Position[]>;
} | null = null;

const sweepRayEndpointsFor = (
  light: LightSource,
  env: LightingEnv,
  cellSize: number,
  occlusionKey: string,
): Position[] => {
  if (
    !sweepEndpointCache ||
    sweepEndpointCache.env !== env ||
    sweepEndpointCache.key !== occlusionKey
  ) {
    sweepEndpointCache = { env, key: occlusionKey, endpoints: new Map() };
  }
  const geometry = lightPolygonCacheKey(light);
  let points = sweepEndpointCache.endpoints.get(geometry);
  if (!points) {
    // March every ray to its endpoint, ignoring the sweep: the stripped
    // light runs the plain polygon computation for all rays at once —
    // bare, in fixed ray order, so the beam assembly above can map
    // index -> angle. The march is time-independent without the sweep,
    // so timeMs is 0.
    points = computeLightPolygonPoints(
      { ...light, effect: undefined },
      env,
      cellSize,
      occlusionKey,
      0,
      false,
    );
    sweepEndpointCache.endpoints.set(geometry, points);
  }
  return points;
};
