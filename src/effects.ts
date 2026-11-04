import { DEFAULT_LIGHT_SOFTNESS } from './lights';
import { LightEffect, type LightSource, type Position } from './types';

// How many times per second a light's effect loops, when the light does not
// specify a rate itself.
export const DEFAULT_LIGHT_RATE = 1;

export const lightRate = (light: LightSource): number =>
  Math.max(0.01, light.rate ?? DEFAULT_LIGHT_RATE);

// Deterministic pseudo-random value in [0, 1) from a number. Flicker and
// sparkles use this instead of Math.random so the same instant always
// renders the same.
export const hash01 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Whether a light animates and so needs per-frame evaluation: any effect
// other than 'static' (or absent). Unknown effect strings count as
// animated — they render statically but keep the animation loop running.
export const isAnimatedLight = (light: LightSource): boolean =>
  light.effect !== undefined && light.effect !== LightEffect.STATIC;

// Blur radius (in pixels) for a light's shadow edges, from its `softness`
// (0..1): 0 = hard edges, 1 = half a cell of blur.
export const lightBlurPx = (light: LightSource, cellSize: number): number => {
  const softness = Math.min(
    1,
    Math.max(0, light.softness ?? DEFAULT_LIGHT_SOFTNESS),
  );
  return (softness * cellSize) / 2;
};
// Brightness multiplier (0..1) for a light at a given time, from its
// animation effect. 'static' and unknown effects stay at 1.
export const lightIntensityScale = (
  light: LightSource,
  timeMs: number,
): number => {
  const t = (timeMs / 1000) * lightRate(light);
  switch (light.effect) {
    case LightEffect.PULSE:
      return 0.65 + 0.35 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
    case LightEffect.FLICKER: {
      // 8 jitter steps per loop, mixed from two octaves for torch-like
      // irregularity.
      const n = Math.floor(t * 8);
      const jitter = hash01(n) * 0.7 + hash01(n * 3.7 + 17) * 0.3;
      return Math.min(1, 0.7 + 0.35 * jitter);
    }
    case LightEffect.BLINK:
      return t % 1 < 0.5 ? 1 : 0.05;
    case LightEffect.AURA:
      // A gentle breathing, subtler than pulse.
      return 0.8 + 0.2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
    case LightEffect.GAS:
      // Even, but gently fluctuating: two slow sines keep the cloud
      // undulating without strong bright/dark swings.
      return Math.min(
        1,
        0.85 +
          0.1 * Math.sin(2 * Math.PI * t) +
          0.05 * Math.sin(2 * Math.PI * t * 2.7 + 1.3),
      );
    default:
      return 1;
  }
};

// A swaying light (e.g. a chandelier) swings on a pendulum: its glow
// center arcs left and right over its cell, rising slightly toward the
// ends of the swing. The horizontal reach stays well under half a cell,
// so the swinging center never leaves the light's own cell.
const SWAY_ARM_CELLS = 0.6;
const SWAY_MAX_ANGLE = Math.PI / 6;

// The visible movement step of a swaying light, in cells (1/32 of a
// cell — about a device pixel): both the repaint signature and the sway
// polygon cache treat smaller center movements as invisible.
export const SWAY_STEP_CELLS = 1 / 32;

// The pendulum offset of a swaying light's center, in world pixels: zero
// for lights that do not sway.
export const lightSwayOffset = (
  light: LightSource,
  cellSize: number,
  timeMs: number,
): Position => {
  if (light.effect !== LightEffect.SWAY) {
    return { x: 0, y: 0 };
  }
  const t = (timeMs / 1000) * lightRate(light);
  const angle = SWAY_MAX_ANGLE * Math.sin(2 * Math.PI * t);
  return {
    x: cellSize * SWAY_ARM_CELLS * Math.sin(angle),
    y: cellSize * SWAY_ARM_CELLS * (Math.cos(angle) - 1),
  };
};

// Rotation angle (radians, 0 = pointing right) of a sweep light's beam at a
// given time, or undefined for lights that do not sweep.
export const lightSweepAngle = (
  light: LightSource,
  timeMs: number,
): number | undefined => {
  if (light.effect !== LightEffect.SWEEP) return undefined;
  return 2 * Math.PI * (((timeMs / 1000) * lightRate(light)) % 1);
};

// Quantization steps for the time-varying parts of an animated light.
// Flicker and blink are already stepped by their own effect math; the
// continuous effects are quantized so a consumer only repaints when the
// visible output actually changes: intensity in 1/16 alpha steps, sweep
// rotation in 4-degree steps, sway position in 1/32-cell steps, sparkle
// twinkle phase in 1/16-loop steps. The sway step also drives the sway
// polygon cache (see lightPolygonFor).
const INTENSITY_QUANTUM = 1 / 16;
const SWEEP_STEP_RADIANS = Math.PI / 45;
const SPARKLE_STEP = 1 / 16;

// The quantized animation state of one animated light, as a comparable
// string. Two evaluations with the same signature produce identical
// light output, so a consumer can skip the repaint entirely. Sway is
// measured in cell units (cellSize 1), so the signature is cell-size
// agnostic.
export const animatedLightSignature = (
  light: LightSource,
  timeMs: number,
): string => {
  const t = (timeMs / 1000) * lightRate(light);
  const scale = lightIntensityScale(light, timeMs);
  const sweep = lightSweepAngle(light, timeMs);
  const sweepStep =
    sweep === undefined ? '' : `${Math.floor(sweep / SWEEP_STEP_RADIANS)}`;
  let sway = '';
  if (light.effect === LightEffect.SWAY) {
    const offset = lightSwayOffset(light, 1, timeMs);
    sway = `${Math.round(offset.x / SWAY_STEP_CELLS)},${Math.round(
      offset.y / SWAY_STEP_CELLS,
    )}`;
  }
  const sparkle =
    light.effect === LightEffect.SPARKLE
      ? `${Math.floor(t / SPARKLE_STEP)}`
      : '';
  return [Math.floor(scale / INTENSITY_QUANTUM), sweepStep, sway, sparkle].join(
    '.',
  );
};
