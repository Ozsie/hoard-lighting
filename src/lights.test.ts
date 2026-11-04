import { describe, expect, it } from 'vitest';
import { isCeilingLight, lightCenter } from './alignment';
import { lightSwayOffset } from './effects';
import {
  DEFAULT_LIGHT_COLOR,
  DEFAULT_LIGHT_INTENSITY,
  DEFAULT_LIGHT_RADIUS,
  DEFAULT_LIGHT_SOFTNESS,
  createLight,
} from './lights';
import { LightAlignment, LightEffect } from './types';

describe('createLight', () => {
  it('fills in the default values', () => {
    expect(createLight(2, 3)).toEqual({
      id: 'light_2_3',
      position: { x: 2, y: 3 },
      alignment: LightAlignment.CENTER,
      color: DEFAULT_LIGHT_COLOR,
      radius: DEFAULT_LIGHT_RADIUS,
      intensity: DEFAULT_LIGHT_INTENSITY,
      softness: DEFAULT_LIGHT_SOFTNESS,
      effect: LightEffect.STATIC,
      rate: 1,
      enabled: true,
    });
  });

  it('keeps the options and the alignment override', () => {
    const light = createLight(1, 1, LightAlignment.TOP_LEFT, {
      id: 'torch',
      color: '#e8963c',
      radius: 2,
      effect: LightEffect.FLICKER,
      rate: 2,
      enabled: false,
    });
    expect(light.alignment).toBe('top-left');
    expect(light.id).toBe('torch');
    expect(light.color).toBe('#e8963c');
    expect(light.radius).toBe(2);
    expect(light.effect).toBe('flicker');
    expect(light.rate).toBe(2);
    expect(light.enabled).toBe(false);
  });
});

describe('lightCenter', () => {
  const CELL = 32;
  const at = (alignment: LightAlignment) =>
    lightCenter({ position: { x: 2, y: 3 }, alignment }, CELL);

  it('centers an unaligned light on its cell', () => {
    expect(at(LightAlignment.CENTER)).toEqual({ x: 80, y: 112 });
  });

  it('insets corner alignments into their cell', () => {
    expect(at(LightAlignment.TOP_LEFT)).toEqual({
      x: 72,
      y: 104,
    });
    expect(at(LightAlignment.BOTTOM_RIGHT)).toEqual({
      x: 88,
      y: 120,
    });
  });

  it('aligns edge lights onto their edge midpoint', () => {
    expect(at(LightAlignment.CENTER_TOP)).toEqual({ x: 80, y: 96 });
    expect(at(LightAlignment.CENTER_BOTTOM)).toEqual({ x: 80, y: 128 });
    expect(at(LightAlignment.CENTER_LEFT)).toEqual({ x: 64, y: 112 });
  });

  it('treats a ceiling light like a centered one', () => {
    expect(at(LightAlignment.CEILING)).toEqual({ x: 80, y: 112 });
    expect(
      isCeilingLight({ position: { x: 0, y: 0 }, alignment: 'ceiling' }),
    ).toBe(true);
    expect(isCeilingLight({ position: { x: 0, y: 0 } })).toBe(false);
  });

  it('follows the sway offset at the given time', () => {
    const light = {
      position: { x: 2, y: 3 },
      effect: LightEffect.SWAY,
      rate: 0.25,
    };
    // One full swing every 4 s: t = 1 is the quarter period, the pendulum
    // at its extreme.
    const center = lightCenter(light, CELL, 1000);
    const offset = lightSwayOffset(light, CELL, 1000);
    expect(center).toEqual({
      x: 80 + offset.x,
      y: 112 + offset.y,
    });
    expect(Math.hypot(offset.x, offset.y)).toBeGreaterThan(0);
  });
});
