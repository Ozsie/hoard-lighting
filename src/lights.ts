import { LightAlignment, LightEffect, type LightSource } from './types';

// Default light source values, shared by `createLight` and the effect
// computations.
export const DEFAULT_LIGHT_COLOR = '#FFB85C';
export const DEFAULT_LIGHT_RADIUS = 4;
export const DEFAULT_LIGHT_INTENSITY = 0.35;
export const DEFAULT_LIGHT_SOFTNESS = 0.25;

// Creates a light source at a cell, filling in the default values.
export const createLight = (
  x: number,
  y: number,
  alignment: LightAlignment = LightAlignment.CENTER,
  options?: {
    color?: string;
    radius?: number;
    intensity?: number;
    softness?: number;
    effect?: LightEffect;
    rate?: number;
    enabled?: boolean;
    id?: string;
  },
): LightSource => ({
  id: options?.id ?? `light_${x}_${y}`,
  position: { x, y },
  alignment,
  color: options?.color ?? DEFAULT_LIGHT_COLOR,
  radius: options?.radius ?? DEFAULT_LIGHT_RADIUS,
  intensity: options?.intensity ?? DEFAULT_LIGHT_INTENSITY,
  softness: options?.softness ?? DEFAULT_LIGHT_SOFTNESS,
  effect: options?.effect ?? LightEffect.STATIC,
  rate: options?.rate ?? 1,
  enabled: options?.enabled ?? true,
});
