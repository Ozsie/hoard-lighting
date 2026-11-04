import { isCeilingLight } from './alignment';
import type {
  LightCellBlock,
  LightOcclusion,
  LightingEnv,
  LightSource,
  Position,
} from './types';

// The per-light rules applied to a raw cell occlusion fact. Mirrors the
// historical semantics:
// - 'opaque' always blocks but is itself lit;
// - 'fog' always blocks at its near edge;
// - an actor blocks unless it stands on the light's own cell (otherwise an
//   actor standing on the light would black it out) or the light is a
//   ceiling fixture (its light comes from above);
// - an open cell never blocks.
export const lightBlockFromOcclusion = (
  light: LightSource,
  occlusion: LightOcclusion,
  cell: Position,
): LightCellBlock => {
  if (occlusion === 'opaque') {
    return 'opaque';
  }
  if (occlusion === 'fog') {
    return 'fog';
  }
  if (occlusion === 'actor') {
    if (cell.x === light.position.x && cell.y === light.position.y) {
      return 'none';
    }
    if (isCeilingLight(light)) {
      return 'none';
    }
    return 'opaque';
  }
  return 'none';
};

// How light interacts with a cell, from the environment's raw occlusion
// facts. Outside the occlusion map a ray reads fog; this direct lookup
// asks the environment, so consumers answer for any cell.
export const lightBlockInCell = (
  light: LightSource,
  env: LightingEnv,
  cell: Position,
): LightCellBlock =>
  lightBlockFromOcclusion(light, env.cellOcclusion(cell.x, cell.y), cell);
