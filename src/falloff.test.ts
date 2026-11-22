import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FALLOFF_PROFILE,
  LightFalloffProfile,
  falloffScalar,
  lightFalloffAt,
  sampleFalloffProfile,
} from './falloff';
import { DEFAULT_LIGHT_RADIUS } from './lights';
import type { LightSource } from './types';

const CELL = 32;

const light = (overrides: Partial<LightSource> = {}): LightSource => ({
  position: { x: 1, y: 1 },
  ...overrides,
});

describe('falloffScalar', () => {
  it('evaluates each named profile at the center, middle and edge', () => {
    expect(falloffScalar(LightFalloffProfile.LEGACY, 0)).toBe(1);
    expect(falloffScalar(LightFalloffProfile.LEGACY, 0.5)).toBeCloseTo(
      0.25,
      10,
    );
    expect(falloffScalar(LightFalloffProfile.LEGACY, 1)).toBe(0);
    expect(falloffScalar(LightFalloffProfile.LINEAR, 0.5)).toBeCloseTo(0.5, 10);
    expect(falloffScalar(LightFalloffProfile.SMOOTH, 0.5)).toBeCloseTo(0.5, 10);
    // Smooth is flat at both ends: its slope vanishes at t = 0 and t = 1.
    expect(falloffScalar(LightFalloffProfile.SMOOTH, 0.1)).toBeCloseTo(
      1 - 0.1 * 0.1 * (3 - 0.2),
      10,
    );
  });

  it('clamps out-of-range t to the boundary values', () => {
    expect(falloffScalar(LightFalloffProfile.LEGACY, -0.5)).toBe(1);
    expect(falloffScalar(LightFalloffProfile.LEGACY, 1.5)).toBe(0);
    expect(falloffScalar(LightFalloffProfile.LINEAR, 2)).toBe(0);
  });

  it('reads a NaN t as no light', () => {
    expect(falloffScalar(LightFalloffProfile.LEGACY, Number.NaN)).toBe(0);
  });

  it('falls back to the legacy profile for undefined and unknown profiles', () => {
    expect(falloffScalar(undefined, 0.5)).toBe(
      falloffScalar(LightFalloffProfile.LEGACY, 0.5),
    );
    expect(falloffScalar('exponential', 0.5)).toBe(
      falloffScalar(LightFalloffProfile.LEGACY, 0.5),
    );
    expect(DEFAULT_FALLOFF_PROFILE).toBe(LightFalloffProfile.LEGACY);
  });
});

describe('lightFalloffAt', () => {
  it('is fully lit at the center and dark at and beyond the range boundary', () => {
    const l = light({ radius: 4 });
    const radiusPx = 4 * CELL;
    expect(lightFalloffAt(l, CELL, 0)).toBe(1);
    expect(lightFalloffAt(l, CELL, radiusPx * 0.999)).toBeGreaterThan(0);
    expect(lightFalloffAt(l, CELL, radiusPx)).toBe(0);
    expect(lightFalloffAt(l, CELL, radiusPx * 2)).toBe(0);
  });

  it('matches the legacy curve at the same normalized distances', () => {
    const l = light({ radius: 4 });
    const half = lightFalloffAt(l, CELL, 2 * CELL);
    expect(half).toBeCloseTo(0.25, 10);
    expect(
      lightFalloffAt(l, CELL, 2 * CELL, LightFalloffProfile.LINEAR),
    ).toBeCloseTo(0.5, 10);
  });

  it('uses the default radius when the light does not set one', () => {
    const l = light();
    expect(lightFalloffAt(l, CELL, DEFAULT_LIGHT_RADIUS * CELL)).toBe(0);
    expect(
      lightFalloffAt(l, CELL, DEFAULT_LIGHT_RADIUS * CELL - 1),
    ).toBeGreaterThan(0);
  });

  it('treats a zero or invalid radius (or cell size) as no reach beyond the center', () => {
    for (const radius of [0, -3, Number.NaN]) {
      const l = light({ radius });
      expect(lightFalloffAt(l, CELL, 0)).toBe(1);
      expect(lightFalloffAt(l, CELL, 1)).toBe(0);
      expect(lightFalloffAt(l, CELL, 1000)).toBe(0);
    }
    const l = light({ radius: 4 });
    expect(lightFalloffAt(l, 0, 0)).toBe(1);
    expect(lightFalloffAt(l, 0, 1)).toBe(0);
    expect(lightFalloffAt(l, Number.NaN, 1)).toBe(0);
  });

  it('clamps a negative distance to the center and reads NaN distance as dark', () => {
    const l = light({ radius: 4 });
    expect(lightFalloffAt(l, CELL, -10)).toBe(1);
    expect(lightFalloffAt(l, CELL, Number.NaN)).toBe(0);
  });

  it('defaults to the compatibility profile when none is named', () => {
    const l = light({ radius: 4 });
    for (const d of [0, CELL, 2.5 * CELL, 4 * CELL, 9 * CELL]) {
      expect(lightFalloffAt(l, CELL, d)).toBe(
        lightFalloffAt(l, CELL, d, LightFalloffProfile.LEGACY),
      );
      expect(lightFalloffAt(l, CELL, d)).toBe(
        lightFalloffAt(l, CELL, d, DEFAULT_FALLOFF_PROFILE),
      );
    }
  });

  it('is monotonically non-increasing from the center outwards', () => {
    const l = light({ radius: 8 });
    for (const profile of [
      LightFalloffProfile.LEGACY,
      LightFalloffProfile.LINEAR,
      LightFalloffProfile.SMOOTH,
      'unknown',
    ]) {
      let previous = Number.POSITIVE_INFINITY;
      for (let d = 0; d <= 8 * CELL; d += CELL / 8) {
        const value = lightFalloffAt(l, CELL, d, profile);
        expect(value).toBeLessThanOrEqual(previous);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    }
  });
});

describe('sampleFalloffProfile', () => {
  it('samples the legacy profile at the legacy consumer gradient stops', () => {
    // Nine samples at t = 0, 1/8, ..., 1 reproduce the nine stops of the
    // legacy top-down gradient, where alpha = peak * (1 - t)^2.
    const samples = sampleFalloffProfile(LightFalloffProfile.LEGACY, 9);
    expect(samples).toHaveLength(9);
    samples.forEach((value, i) => {
      const t = i / 8;
      expect(value).toBeCloseTo((1 - t) * (1 - t), 10);
    });
    expect(samples[0]).toBe(1);
    expect(samples[8]).toBe(0);
  });

  it('returns the two boundary samples for a degenerate sample count', () => {
    expect(sampleFalloffProfile(LightFalloffProfile.LINEAR, 1)).toEqual([1, 0]);
    expect(sampleFalloffProfile(LightFalloffProfile.LINEAR, 0)).toEqual([1, 0]);
    expect(
      sampleFalloffProfile(LightFalloffProfile.LINEAR, Number.NaN),
    ).toEqual([1, 0]);
    expect(sampleFalloffProfile(LightFalloffProfile.LINEAR, 2.7)).toHaveLength(
      2,
    );
  });

  it('is monotonically non-increasing and bounded for every profile', () => {
    for (const profile of [
      LightFalloffProfile.LEGACY,
      LightFalloffProfile.LINEAR,
      LightFalloffProfile.SMOOTH,
      undefined,
      'unknown',
    ]) {
      const samples = sampleFalloffProfile(profile, 33);
      expect(samples).toHaveLength(33);
      expect(samples[0]).toBe(1);
      expect(samples[32]).toBe(0);
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
        expect(samples[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
