# AGENTS.md — @hoard-engine/lighting

This is a HOARD engine package

## What this package is

- Light computation extracted from the game: light source values and
  the factory filling them, alignment/sway/ceiling center geometry,
  animation effects (intensity, sweep angle, blur radius), sparkles,
  per-cell block classification, ray-cast visibility polygons and
  viewport culling. It is a dependency-free leaf: engine-agnostic,
  game-agnostic, canvas-free (pure math — the consumer renders the
  returned data).
- The game consumes it as a `@hoard-engine/lighting` dependency and keeps the
  canvas compositing — gradients, sprites, the darkness veil — on its
  side (`src/dungeon/LightRendering.ts`), per the compute/render split.

## Hard boundaries

- Only relative imports inside `src/`. No imports from game code,
  Svelte, i18n, node builtins or any package — enforced by an eslint
  `no-restricted-syntax` override and `src/boundary.test.ts`. Tests may
  import `vitest` and `node:` builtins.
- The public surface is exactly `src/index.ts`; every export must be
  re-exported there (`src/publicSurface.test.ts` fails otherwise).
- The API is deliberately game-agnostic and callback-driven. The game
  owns cell semantics (what is a wall, what is discovered, what is
  foggy), edge knowledge (which doors and wall edges block), region
  knowledge (which room a cell belongs to) and every rule decision; it
  injects them through the `LightingEnv` callbacks. Changing blocking
  or propagation semantics in the package is a game rules change —
  RULES.md wins; ask before "fixing" either side.
- Game content (light presets like torches and braziers, event lights,
  hero torches, door glows) stays in the game; this package contains no
  content by construction.
- Caches (occlusion maps, polygons, sweep endpoints) are scoped by the
  caller's opaque `occlusionKey` token plus the environment object
  identity — the package cannot re-derive when occlusion changed. The
  key must cover everything the env callbacks can read out of state.

## Commands

Standalone (from this folder):

```bash
npm test          # vitest (boundary, public-surface and unit tests)
npm run check     # tsc --noEmit (strict)
npm run lint      # eslint over src and vitest.config.ts
npm run prettier  # prettier --check (fix via prettier:format)
npm run build     # tsc declarations + esbuild ESM bundle to dist/
```

Run `npm run check`, `npm test`, and `npm run lint` before considering
work done. The game runs its own `check`/`test`/`lint` over its facades
on top.

## Conventions

- Prettier: single quotes, 2-space indent, trailing commas. Strict
  TypeScript: no `any`, no `console`.
- Tests are colocated as `*.test.ts` next to the code they cover and
  run in plain Node (no DOM, no canvas); behavior tests that need
  campaign layouts stay in the game (campaign content is game content;
  this package tests against synthetic environments only).
- `dist/` is build output: never edit it, never commit it.
