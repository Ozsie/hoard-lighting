import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIGHT_RATE,
  animatedLightSignature,
  hash01,
  isAnimatedLight,
  lightBlurPx,
  lightIntensityScale,
  lightRate,
  lightSwayOffset,
  lightSweepAngle,
} from './effects';
import { LightEffect, type LightSource } from './types';

const light = (overrides: Partial<LightSource> = {}): LightSource => ({
  position: { x: 1, y: 2 },
  ...overrides,
});

describe('isAnimatedLight', () => {
  it('only animates lights with an effect other than static', () => {
    expect(isAnimatedLight(light())).toBe(false);
    expect(isAnimatedLight(light({ effect: LightEffect.STATIC }))).toBe(false);
    expect(isAnimatedLight(light({ effect: LightEffect.PULSE }))).toBe(true);
    // Unknown effect strings keep the animation loop running.
    expect(isAnimatedLight(light({ effect: 'rotate' }))).toBe(true);
  });
});

describe('lightRate', () => {
  it('defaults to 1 and clamps near zero', () => {
    expect(lightRate(light())).toBe(DEFAULT_LIGHT_RATE);
    expect(lightRate(light({ rate: 3 }))).toBe(3);
    expect(lightRate(light({ rate: 0 }))).toBe(0.01);
  });
});

describe('hash01', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash01(42)).toBe(hash01(42));
    expect(hash01(42)).not.toBe(hash01(43));
    for (let n = -50; n < 50; n++) {
      expect(hash01(n)).toBeGreaterThanOrEqual(0);
      expect(hash01(n)).toBeLessThan(1);
    }
  });
});

describe('lightIntensityScale', () => {
  it('stays at 1 for static and unknown effects', () => {
    expect(lightIntensityScale(light(), 1234)).toBe(1);
    expect(lightIntensityScale(light({ effect: 'rotate' }), 1234)).toBe(1);
  });

  it('breathes a pulse between 0.65 and 1', () => {
    const pulse = light({ effect: LightEffect.PULSE, rate: 0.25 });
    const peak = lightIntensityScale(pulse, 2000);
    const valley = lightIntensityScale(pulse, 4000);
    expect(peak).toBeCloseTo(1, 5);
    expect(valley).toBeCloseTo(0.65, 5);
  });

  it('blinks hard between on and off', () => {
    const blink = light({ effect: LightEffect.BLINK, rate: 1 });
    expect(lightIntensityScale(blink, 100)).toBe(1);
    expect(lightIntensityScale(blink, 600)).toBe(0.05);
  });

  it('is deterministic for flicker', () => {
    const flicker = light({ effect: LightEffect.FLICKER, rate: 2 });
    expect(lightIntensityScale(flicker, 1500)).toBe(
      lightIntensityScale(flicker, 1500),
    );
    for (let t = 0; t < 2000; t += 50) {
      const scale = lightIntensityScale(flicker, t);
      expect(scale).toBeGreaterThanOrEqual(0.7);
      expect(scale).toBeLessThanOrEqual(1);
    }
  });
});

describe('lightSweepAngle', () => {
  it('is undefined without the sweep effect', () => {
    expect(lightSweepAngle(light({ effect: LightEffect.PULSE }), 0)).toBe(
      undefined,
    );
  });

  it('rotates a full turn per loop', () => {
    const sweep = light({ effect: LightEffect.SWEEP, rate: 0.25 });
    expect(lightSweepAngle(sweep, 0)).toBeCloseTo(0, 5);
    expect(lightSweepAngle(sweep, 1000)).toBeCloseTo(Math.PI / 2, 5);
    expect(lightSweepAngle(sweep, 4000)).toBeCloseTo(0, 5);
  });
});

describe('lightSwayOffset', () => {
  it('does not move lights that do not sway', () => {
    expect(
      lightSwayOffset(light({ effect: LightEffect.FLICKER }), 48, 999),
    ).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('swings within its cell', () => {
    const sway = light({ effect: LightEffect.SWAY, rate: 0.25 });
    let sawMovement = false;
    for (let t = 25; t < 4000; t += 25) {
      const offset = lightSwayOffset(sway, 48, t);
      // The swing arm stays under 0.6 cells and the center only rises.
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(48 * 0.6);
      expect(offset.y).toBeLessThanOrEqual(0);
      if (offset.x !== 0 || offset.y !== 0) {
        sawMovement = true;
      }
    }
    expect(sawMovement).toBe(true);
    // At the quarter period the pendulum is at its extreme.
    const peak = lightSwayOffset(sway, 48, 1000);
    expect(Math.abs(peak.x)).toBeGreaterThan(0);
    expect(peak.y).toBeLessThan(0);
  });
});

describe('lightBlurPx', () => {
  it('maps softness 0..1 to half a cell of blur', () => {
    expect(lightBlurPx(light({ softness: 0 }), 48)).toBe(0);
    expect(lightBlurPx(light({ softness: 0.5 }), 48)).toBeCloseTo(12, 5);
    expect(lightBlurPx(light({ softness: 1 }), 48)).toBeCloseTo(24, 5);
    expect(lightBlurPx(light({ softness: 7 }), 48)).toBeCloseTo(24, 5);
  });
});

describe('animatedLightSignature', () => {
  it('is equal for the same light and time', () => {
    const pulse = light({ effect: LightEffect.PULSE, rate: 1 });
    expect(animatedLightSignature(pulse, 1000)).toBe(
      animatedLightSignature(pulse, 1000),
    );
  });

  it('quantizes the intensity into visible steps', () => {
    const pulse = light({ effect: LightEffect.PULSE, rate: 8 });
    // One pulse loop every 125 ms; 0–3 ms are within the same 1/16 step.
    expect(animatedLightSignature(pulse, 0)).toBe(
      animatedLightSignature(pulse, 3),
    );
    expect(animatedLightSignature(pulse, 0)).not.toBe(
      animatedLightSignature(pulse, 60),
    );
  });

  it('separates sweep rotation steps for a sweep light', () => {
    const sweep = light({ effect: LightEffect.SWEEP, rate: 2 });
    expect(animatedLightSignature(sweep, 0)).not.toBe(
      animatedLightSignature(sweep, 10),
    );
  });

  it('tracks the sway center in cell units', () => {
    const sway = light({ effect: LightEffect.SWAY, rate: 0.25 });
    // Same sweep phase, noticeably different swing position.
    expect(animatedLightSignature(sway, 100)).toBe(
      animatedLightSignature(sway, 100),
    );
    expect(animatedLightSignature(sway, 100)).not.toBe(
      animatedLightSignature(sway, 900),
    );
  });

  it('steps the sparkle twinkle phase', () => {
    const sparkle = light({ effect: LightEffect.SPARKLE, rate: 1 });
    expect(animatedLightSignature(sparkle, 0)).not.toBe(
      animatedLightSignature(sparkle, 100),
    );
  });
});
