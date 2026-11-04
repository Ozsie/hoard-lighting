// A grid position, in cell coordinates.
export type Position = {
  x: number;
  y: number;
};

// Light animation effects: 'static' (no animation, the default), 'pulse'
// (breathing glow), 'flicker' (torch-like jitter), 'sweep' (rotating beam),
// 'sway' (pendulum swing, e.g. a chandelier), 'blink' (on/off), 'sparkle'
// (colored twinkles inside the light's own cell), 'aura' (a glowing ring
// around a soft center glow, filling only its own cell) and 'gas' (an
// even, gently undulating cloud confined to its room region).
// Intentionally open-ended: unknown effect strings fall back to 'static'
// behavior at render time.
export const LightEffect = {
  STATIC: 'static',
  PULSE: 'pulse',
  FLICKER: 'flicker',
  SWEEP: 'sweep',
  SWAY: 'sway',
  BLINK: 'blink',
  SPARKLE: 'sparkle',
  AURA: 'aura',
  GAS: 'gas',
} as const;

export type LightEffect =
  (typeof LightEffect)[keyof typeof LightEffect] | (string & {});

// Where a light sits in its cell: the corner and edge alignments shift the
// glow center so it hugs the cell feature the light is mounted on ('top-left'
// for a wall torch, 'center-left' for a sconce, ...); 'ceiling' marks a
// fixture shining down from above. Consumers with their own alignment enum
// stay structurally compatible when the member values match — declare the
// input as `light.alignment` on this const object's union.
export const LightAlignment = {
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  CENTER: 'center',
  CENTER_LEFT: 'center-left',
  CENTER_RIGHT: 'center-right',
  CENTER_TOP: 'center-top',
  CENTER_BOTTOM: 'center-bottom',
  CEILING: 'ceiling',
} as const;

export type LightAlignment =
  (typeof LightAlignment)[keyof typeof LightAlignment];

// A light source on a tile grid. The package consumes this minimal shape;
// producers with a richer light type stay compatible as long as the fields
// they set match (structural typing, no shared import).
export type LightSource = {
  id?: string;
  position: Position;
  alignment?: LightAlignment;
  // CSS color of the light glow.
  color?: string;
  // Reach of the light in grid cells (from its position).
  radius?: number;
  // 0..1 brightness at the light source, fading to 0 at the radius.
  intensity?: number;
  // 0..1 softness of the light's shadow edges: 0 = hard edges, 1 = up to
  // half a cell of blur.
  softness?: number;
  // Animation effect, see `LightEffect` (default: 'static').
  effect?: LightEffect;
  // How many times per second the effect loops (default 1).
  rate?: number;
  enabled?: boolean;
};

// The visible part of the world, in grid cells: the rectangle starting
// at (x, y) spanning width x height cells. Optional everywhere it is
// used; without it every light is considered visible.
export type LightViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// How light interacts with a cell, applying the per-light rules to the
// raw cell occlusion:
// - 'opaque': the cell blocks light but is itself illuminated — walls,
//   pillars and actors stay visible, with the shadow starting behind them.
// - 'fog': the cell blocks light at its near edge, so it stays unlit.
// - 'none': light passes through.
export type LightCellBlock = 'opaque' | 'fog' | 'none';

// The raw occlusion facts a consumer reports for a cell:
// - 'opaque': blocks light but is itself lit (walls, pillars).
// - 'fog': blocks light at its near edge (undefined cells, fog of war).
// - 'actor': a blocking actor on an otherwise open cell — the per-light
//   rules decide whether actors actually block (ceiling lights shine over
//   them, the light's own cell never blocks).
// - 'open': light passes through.
export const LightOcclusion = {
  OPAQUE: 'opaque',
  FOG: 'fog',
  ACTOR: 'actor',
  OPEN: 'open',
} as const;

export type LightOcclusion =
  (typeof LightOcclusion)[keyof typeof LightOcclusion];

// The consumer-defined environment the package computes against — the
// package never imports game state or a grid package. Every piece of game
// knowledge is injected as a callback (in the spirit of the consumer-
// defined contracts rule):
// - `cellOcclusion`: the raw blocking facts of a cell, consulted once per
//   occlusion state when the occlusion map is built.
// - `isStepBlocked`: whether the step between two cells the ray walk
//   enters is blocked (a closed door or a wall edge; diagonal transitions
//   follow the pinch-point rule) — light stops at the shared edge.
// - `roomOf`: the region a cell belongs to (e.g. the room character on a
//   letter grid); a gas light's cloud stays inside its region.
export type LightingEnv = {
  gridWidth: number;
  gridHeight: number;
  cellOcclusion: (x: number, y: number) => LightOcclusion;
  isStepBlocked: (from: Position, to: Position) => boolean;
  roomOf: (x: number, y: number) => string;
};
