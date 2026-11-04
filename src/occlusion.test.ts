import { describe, expect, it } from 'vitest';
import { lightBlockInCell } from './occlusion';
import {
  LightAlignment,
  LightOcclusion,
  type LightingEnv,
  type LightSource,
} from './types';

const envWith = (
  occlusion: (x: number, y: number) => LightOcclusion,
): LightingEnv => ({
  gridWidth: 4,
  gridHeight: 4,
  cellOcclusion: occlusion,
  isStepBlocked: () => false,
  roomOf: () => '',
});

const light = (overrides: Partial<LightSource> = {}): LightSource => ({
  position: { x: 1, y: 1 },
  ...overrides,
});

describe('lightBlockInCell', () => {
  it('reads opaque and fog facts through untouched', () => {
    const env = envWith((x) =>
      x === 2 ? LightOcclusion.OPAQUE : LightOcclusion.FOG,
    );
    expect(lightBlockInCell(light(), env, { x: 2, y: 1 })).toBe('opaque');
    expect(lightBlockInCell(light(), env, { x: 0, y: 1 })).toBe('fog');
  });

  it('treats an open cell as transparent', () => {
    const env = envWith(() => LightOcclusion.OPEN);
    expect(lightBlockInCell(light(), env, { x: 2, y: 1 })).toBe('none');
  });

  it('lets actors block unless they stand on the light or it is a ceiling fixture', () => {
    const env = envWith(() => LightOcclusion.ACTOR);
    expect(lightBlockInCell(light(), env, { x: 2, y: 2 })).toBe('opaque');
    // The light's own cell never blocks.
    expect(lightBlockInCell(light(), env, { x: 1, y: 1 })).toBe('none');
    // A ceiling light shines over actors.
    const ceiling = light({ alignment: LightAlignment.CEILING });
    expect(lightBlockInCell(ceiling, env, { x: 2, y: 2 })).toBe('none');
  });
});
