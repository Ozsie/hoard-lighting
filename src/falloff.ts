import { DEFAULT_LIGHT_RADIUS } from './lights';
import type { LightSource } from './types';

// Named falloff profiles: how a light's brightness scalar decays from its
// center (normalized distance t = 0) to the edge of its radius (t = 1).
// - 'legacy': (1 - t)^2 — the historically rendered falloff (the top-down
//   consumer's quadratic gradient stops); the compatibility default, so
//   consumers keep their current output unless they explicitly opt in.
// - 'linear': (1 - t) — the isometric consumer's current linear gradient.
// - 'smooth': 1 - smoothstep(t) — flat at both the center and the edge; a
//   shared curve both projections can adopt for parity.
// Open-ended like LightEffect: unknown profile strings evaluate as
// 'legacy'.
export const LightFalloffProfile = {
  LEGACY: 'legacy',
  LINEAR: 'linear',
  SMOOTH: 'smooth',
} as const;

export type LightFalloffProfile =
  | (typeof LightFalloffProfile)[keyof typeof LightFalloffProfile]
  | (string & {});

// The profile used when a caller does not name one: the compatibility
// profile — a new profile is never implicit.
export const DEFAULT_FALLOFF_PROFILE: LightFalloffProfile =
  LightFalloffProfile.LEGACY;

// The profile's curve at a normalized distance already clamped to [0, 1].
const falloffCurve = (profile: LightFalloffProfile, t: number): number => {
  switch (profile) {
    case LightFalloffProfile.LINEAR:
      return 1 - t;
    case LightFalloffProfile.SMOOTH:
      return 1 - t * t * (3 - 2 * t);
    case LightFalloffProfile.LEGACY:
    default:
      return (1 - t) * (1 - t);
  }
};

// The falloff scalar in [0, 1] at a normalized distance t from the light
// center: 0 at the center, 1 at the radius edge. Out-of-range t clamps to
// the boundary values (t <= 0 -> 1, t >= 1 -> 0); a NaN t reads as no
// light. An undefined profile evaluates as the compatibility default.
export const falloffScalar = (
  profile: LightFalloffProfile | undefined,
  t: number,
): number => {
  if (Number.isNaN(t)) return 0;
  const clamped = Math.min(1, Math.max(0, t));
  return falloffCurve(profile ?? DEFAULT_FALLOFF_PROFILE, clamped);
};

// The falloff scalar at a world-pixel distance from a light's center, the
// light's radius in cells converted through cellSize. Edge behavior: the
// center (distance 0) is fully lit; the range boundary (distance == radius)
// and anything beyond it are dark; a zero, negative or NaN radius (or cell
// size) means no reach beyond the center point itself; a NaN distance is
// dark. The scalar is the pure falloff — consumers multiply it by the
// light's intensity and animation scale as they already do.
export const lightFalloffAt = (
  light: LightSource,
  cellSize: number,
  distancePx: number,
  profile: LightFalloffProfile | undefined = DEFAULT_FALLOFF_PROFILE,
): number => {
  if (Number.isNaN(distancePx)) return 0;
  const distance = Math.max(0, distancePx);
  const radiusPx = (light.radius ?? DEFAULT_LIGHT_RADIUS) * cellSize;
  const t =
    radiusPx > 0
      ? distance / radiusPx
      : distance <= 0
        ? 0
        : Number.POSITIVE_INFINITY;
  return falloffScalar(profile, t);
};

// A sampled scalar profile: `sampleCount` falloff values evenly spaced
// from the center (t = 0) to the radius edge (t = 1) — a lookup table
// consumers map onto their gradient stops (sampleCount 9 reproduces the
// nine stops of the legacy consumer gradient). A sampleCount below 2, or
// not finite, yields the two boundary samples.
export const sampleFalloffProfile = (
  profile: LightFalloffProfile | undefined,
  sampleCount: number,
): number[] => {
  const count = Number.isFinite(sampleCount)
    ? Math.max(2, Math.floor(sampleCount))
    : 2;
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    samples.push(falloffScalar(profile, i / (count - 1)));
  }
  return samples;
};
