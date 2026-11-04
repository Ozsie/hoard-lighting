import { hash01, lightRate } from './effects';
import type { LightSource } from './types';

// Twinkles inside the light's own cell.
const SPARKLES_PER_CELL = 5;
// Sparkles keep this far from the cell edge, as a fraction of the cell.
const SPARKLE_SPREAD = 0.08;
// Low-discrepancy (golden-ratio) step sequences: spread successive twinkles
// evenly across the cell, independent of hash quality.
const SPARKLE_STEP_X = 0.7548776667;
const SPARKLE_STEP_Y = 0.5698402909;
const SPARKLE_STEP_ARM = 0.4142135624;

const fract = (n: number): number => n - Math.floor(n);

// One visible sparkle twinkle at a given time.
export interface Sparkle {
  // Center in world pixel coordinates.
  x: number;
  y: number;
  // Half length of the glint's arms, in pixels.
  arm: number;
  // 0..1 brightness of this twinkle right now.
  alpha: number;
}

// All currently visible sparkles for a light: colored twinkles inside the
// light's own cell — nowhere else. Positions are fixed per light and spread
// across the whole cell; only the twinkle brightness changes over time.
export const computeSparkles = (
  light: LightSource,
  cellSize: number,
  timeMs: number,
): Sparkle[] => {
  const t = (timeMs / 1000) * lightRate(light);
  // Per-light offset so sparkle lights in different cells never line up.
  const offset = hash01(
    light.position.x * 73856093 + light.position.y * 19349663,
  );
  const sparkles: Sparkle[] = [];
  for (let index = 0; index < SPARKLES_PER_CELL; index++) {
    const fx = fract((index + 1 + offset) * SPARKLE_STEP_X);
    const fy = fract((index + 1 + offset * 0.618) * SPARKLE_STEP_Y);
    const phase = fract((index + 1 + offset) * 0.6180339887);
    const twinkle = Math.sin(2 * Math.PI * (t + phase));
    const alpha = Math.max(0, Math.min(1, (twinkle - 0.15) / 0.6));
    if (alpha <= 0.02) {
      continue;
    }
    const span = 1 - 2 * SPARKLE_SPREAD;
    const x = (light.position.x + SPARKLE_SPREAD + span * fx) * cellSize;
    const y = (light.position.y + SPARKLE_SPREAD + span * fy) * cellSize;
    const arm =
      cellSize * (0.05 + 0.05 * fract((index + 1 + offset) * SPARKLE_STEP_ARM));
    sparkles.push({ x, y, arm, alpha });
  }
  return sparkles;
};
