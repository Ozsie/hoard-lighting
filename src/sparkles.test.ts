import { describe, expect, it } from 'vitest';
import { computeSparkles } from './sparkles';
import { LightEffect, type LightSource } from './types';

const CELL = 32;

const light = (overrides: Partial<LightSource> = {}): LightSource => ({
  position: { x: 1, y: 2 },
  effect: LightEffect.SPARKLE,
  rate: 1,
  ...overrides,
});

describe('computeSparkles', () => {
  it('is deterministic for the same light and time', () => {
    expect(computeSparkles(light(), CELL, 100)).toEqual(
      computeSparkles(light(), CELL, 100),
    );
  });

  it('keeps every twinkle inside the light own cell', () => {
    for (let t = 0; t < 3000; t += 80) {
      const sparkles = computeSparkles(light(), CELL, t);
      sparkles.forEach((sparkle) => {
        expect(sparkle.x).toBeGreaterThan((1 + 0.08) * CELL - 0.000001);
        expect(sparkle.x).toBeLessThan((2 - 0.08) * CELL + 0.000001);
        expect(sparkle.y).toBeGreaterThan((2 + 0.08) * CELL - 0.000001);
        expect(sparkle.y).toBeLessThan((3 - 0.08) * CELL + 0.000001);
      });
    }
  });

  it('bounds the twinkle brightness to 0..1', () => {
    for (let t = 0; t < 3000; t += 80) {
      computeSparkles(light(), CELL, t).forEach((sparkle) => {
        expect(sparkle.alpha).toBeGreaterThan(0);
        expect(sparkle.alpha).toBeLessThanOrEqual(1);
      });
    }
  });

  it('offsets the pattern per light position', () => {
    // Two lights in different cells never line up their twinkles.
    const a = computeSparkles(light({ position: { x: 1, y: 2 } }), CELL, 500);
    const b = computeSparkles(light({ position: { x: 3, y: 2 } }), CELL, 500);
    expect(a.map((sparkle) => sparkle.x)).not.toEqual(
      b.map((sparkle) => sparkle.x - 2 * CELL),
    );
  });
});
