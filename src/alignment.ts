import { lightSwayOffset } from './effects';
import { LightAlignment, type LightSource, type Position } from './types';

// Corner-aligned lights sit this fraction into their cell, so the glow stays
// inside the cell it was placed on instead of bleeding into the wall corner.
const CORNER_ALIGNMENT_INSET = 0.25;

// A ceiling light shines down from above its cell: actors are fully
// illuminated and do not block it or cast shadows in it. Cells reported
// as 'opaque' or 'fog' still block it like any other light.
export const isCeilingLight = (light: LightSource): boolean =>
  (light.alignment ?? LightAlignment.CENTER) === LightAlignment.CEILING;

// The glow center of a light, in world pixel coordinates: the cell center
// unless the alignment shifts it toward an edge or corner, plus the sway
// offset for swaying lights.
export const lightCenter = (
  light: LightSource,
  cellSize: number,
  timeMs = 0,
): Position => {
  const x = light.position.x * cellSize;
  const y = light.position.y * cellSize;
  const inset = cellSize * CORNER_ALIGNMENT_INSET;
  let center: Position;
  switch (light.alignment ?? LightAlignment.CENTER) {
    case LightAlignment.TOP_LEFT:
      center = { x: x + inset, y: y + inset };
      break;
    case LightAlignment.TOP_RIGHT:
      center = { x: x + cellSize - inset, y: y + inset };
      break;
    case LightAlignment.BOTTOM_LEFT:
      center = { x: x + inset, y: y + cellSize - inset };
      break;
    case LightAlignment.BOTTOM_RIGHT:
      center = { x: x + cellSize - inset, y: y + cellSize - inset };
      break;
    case LightAlignment.CENTER_LEFT:
      center = { x, y: y + cellSize / 2 };
      break;
    case LightAlignment.CENTER_RIGHT:
      center = { x: x + cellSize, y: y + cellSize / 2 };
      break;
    case LightAlignment.CENTER_TOP:
      center = { x: x + cellSize / 2, y };
      break;
    case LightAlignment.CENTER_BOTTOM:
      center = { x: x + cellSize / 2, y: y + cellSize };
      break;
    // A ceiling fixture lights the whole cell from above; its light pool
    // is centered on the cell, like CENTER.
    case LightAlignment.CEILING:
    case LightAlignment.CENTER:
    default:
      center = { x: x + cellSize / 2, y: y + cellSize / 2 };
      break;
  }
  const sway = lightSwayOffset(light, cellSize, timeMs);
  return { x: center.x + sway.x, y: center.y + sway.y };
};
