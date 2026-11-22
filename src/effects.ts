import { DEFAULT_LIGHT_SOFTNESS } from './lights';
import { LightEffect, type LightSource, type Position } from './types';

// How many times per second a light's effect loops, when the light does not
// specify a rate itself.
export const DEFAULT_LIGHT_RATE = 1;

// Options for the animation evaluation. `interpolate: true` reads the
// animation clock continuously: the flicker effect blends between its
// jitter steps with a smoothstep ease instead of jumping at each step.
// The default (false) is the historical stepped output — the
// compatibility path, kept byte-identical for existing consumers.
export type LightAnimationOptions = {
  interpolate?: boolean;
};

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
// Jitter steps per loop of the flicker effect.
const FLICKER_STEPS_PER_LOOP = 8;

// The flicker effect's two-octave jitter at jitter step n, torch-like
// irregularity mixed from two hash octaves.
const flickerJitter = (n: number): number =>
  hash01(n) * 0.7 + hash01(n * 3.7 + 17) * 0.3;

// The stepped flicker brightness at jitter step n.
const flickerStepScale = (n: number): number =>
  Math.min(1, 0.7 + 0.35 * flickerJitter(n));

// Brightness multiplier (0..1) for a light at a given time, from its
// animation effect. 'static' and unknown effects stay at 1. With
// `options.interpolate` the flicker blends continuously between its
// jitter steps; every other effect is already continuous (or hard on/off
// by design, like blink), so the option only changes flicker.
export const lightIntensityScale = (
  light: LightSource,
  timeMs: number,
  options?: LightAnimationOptions,
): number => {
  const t = (timeMs / 1000) * lightRate(light);
  switch (light.effect) {
    case LightEffect.PULSE:
      return 0.65 + 0.35 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
    case LightEffect.FLICKER: {
      const position = t * FLICKER_STEPS_PER_LOOP;
      const n = Math.floor(position);
      const stepped = flickerStepScale(n);
      if (options?.interpolate !== true) return stepped;
      // Blend to the next jitter step with a smoothstep ease: at the step
      // boundary (frac -> 1) the eased value reaches the next step's own
      // value, so the transition has no discontinuity, across loops too.
      const frac = position - n;
      const eased = frac * frac * (3 - 2 * frac);
      const next = flickerStepScale(n + 1);
      return stepped + (next - stepped) * eased;
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
// With `interpolate` the effect output changes continuously, so the
// intensity quantum tightens to 1/256 — below one step of 8-bit rendered
// alpha — and the signature therefore changes exactly when the rendered
// output can change, never suppressing a repaint the interpolation needs.
const INTERPOLATED_INTENSITY_QUANTUM = 1 / 256;
const SWEEP_STEP_RADIANS = Math.PI / 45;
const SPARKLE_STEP = 1 / 16;

// The quantized animation state of one animated light, as a comparable
// string. Two evaluations with the same signature (and the same options)
// produce identical light output, so a consumer can skip the repaint
// entirely. Sway is measured in cell units (cellSize 1), so the signature
// is cell-size agnostic. With `options.interpolate` the intensity quantum
// tightens (see INTERPOLATED_INTENSITY_QUANTUM); the sweep, sway and
// sparkle steps are unchanged.
export const animatedLightSignature = (
  light: LightSource,
  timeMs: number,
  options?: LightAnimationOptions,
): string => {
  const t = (timeMs / 1000) * lightRate(light);
  const scale = lightIntensityScale(light, timeMs, options);
  const quantum =
    options?.interpolate === true
      ? INTERPOLATED_INTENSITY_QUANTUM
      : INTENSITY_QUANTUM;
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
  return [Math.floor(scale / quantum), sweepStep, sway, sparkle].join('.');
};
