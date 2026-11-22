# Lighting package roadmap

This document covers package-owned computation and contracts for the coordinated game-side [lighting realism roadmap](../drakriddarna/TODO-lighting.md). It does not assign projection, canvas rendering, color parsing, presets, asset measurements or game rules to this package. All additions below are proposals and remain subject to consumer adoption and compatibility review.

Milestones use the same labels as the game roadmap and hand off in order: **package capability → scene renderer adoption → game integration**. The package owns pure, dependency-free compute; renderer adoption and end-to-end outcomes remain consumer responsibilities.

## Ordered compute milestones

### M1 — Projection parity and correctness

The package currently supplies visibility geometry and effect scalars; consumers choose their own rendered attenuation. `src/types.ts` and `src/effects.ts` are the relevant contract/math areas; the scene renderers remain outside this package.

- [x] Add pure falloff evaluation and sampled scalar profiles that consumers can apply consistently in either projection.
- [x] Provide a compatibility profile that lets consumers retain their existing rendered falloff and preserves current intensity/visibility outputs; do not make a new profile implicit.
- [x] Export new public helpers through `src/index.ts` and cover edge cases (zero/invalid radius, center, range boundary and out-of-range distance) with dependency-free math tests.

**Handoff and acceptance:** Scene consumers own gradient construction, CSS-color parsing/alpha and compositing. Verify equivalent sampled values at the same normalized distances and compatibility with the legacy consumer profile before changing renderer defaults. Do not soften or otherwise change the hard visibility polygon as a side effect of illumination falloff work.

### M2 — Animation and movement synchronization

Animation math is in `src/effects.ts`; consumer repaint scheduling determines whether continuous values appear continuous. Sweep geometry and visibility are in `src/polygons.ts`.

- [ ] Add deterministic interpolated flicker while retaining a compatible path for existing effect output and animation signatures.
- [ ] Coordinate signature precision/semantics with consumers so signatures do not suppress repaints needed to show the intended interpolation; correct the documented `animatedLightSignature` signature in `README.md` when that API work is implemented.
- [ ] Keep sweep-edge continuity and beam behavior at corners as separately validated follow-ups; do not silently change occlusion or ray/corner rules as part of flicker work.
- [ ] Add synthetic-time tests for determinism, interpolation continuity, range and compatibility.

**Handoff and acceptance:** Consumers must update repaint signatures and test repeated timestamps as well as intermediate times. Confirm identical inputs and times produce identical values, transitions have no step discontinuity, and the legacy mode remains usable until consumers adopt the new behavior.

### M3 — Height-aware surface lighting

The package's visibility geometry is 2D and projection-independent. `Position` currently serves more than one coordinate meaning; establish units and defaults before publishing optional height/receiver contracts.

- [ ] Define optional emitter and receiver geometry plus pure distance and diffuse-facing calculations, with explicit coordinate units, defaults and compatibility behavior.
- [ ] Keep projection, floor/wall classification, canvas drawing, presets and asset measurements in consumers; do not choose game-specific heights or receiver shapes here.
- [ ] Export contracts and helpers through `src/index.ts`; test geometry with synthetic values and no game/scene dependencies.

**Handoff and acceptance:** Scene consumers project the returned calculation into their surfaces, while the game supplies authored measurements. Verify distance and facing math, degenerate/zero-distance cases, coordinate-unit conversions and behavior when optional geometry is absent. Height calculations must not change visibility or opaque-cell penetration semantics.

### M4 — Surface illumination, actor response and emission

Surface compositing, source emission, glow and actor artwork are renderer concerns. The package should expose only pure values or optional visual-occluder inputs needed for consumers to apply a consistent lighting model.

- [ ] Identify and document the minimal receiver-sampling or optional visual-proxy contract required for actor-level illumination; avoid duplicating projection or asset knowledge.
- [ ] Keep illumination sampling separate from rendering, emission/glow and game-owned actor or ceiling-light policy.
- [ ] Add synthetic contract/math tests and verify the public surface and dependency-free boundary remain intact.

**Handoff and acceptance:** Scene consumers own artwork modulation and compositing; the game owns actor visual positions and compatibility decisions. Do not redefine full-cell actor blocking or ceiling-light behavior through an additive data contract.

### M5 — Height-aware shadows and later refinements

Build optional shadow computation on the M3 geometry contract and profile it before adding work per light. Relevant current geometry and cache behavior are in `src/polygons.ts` and `src/occlusion.ts`.

- [ ] Add optional visual occluder proxies, hit-distance metadata and deterministic finite-emitter visibility samples in stages, only after geometry contracts and profiling.
- [ ] Keep visual proxies distinct from game collision/visibility rules; do not silently change ceiling-light, diagonal-gap, actor-blocking or opaque-cell penetration behavior.
- [ ] Add synthetic-environment tests for proxy geometry, hit distances, deterministic samples and unchanged legacy visibility behavior.
- [ ] Connect moving emitters and dynamic proxies to the cache-safety work below; explicitly test `cellSize`, alternating environments and bounded retention without preselecting an invalidation or retention architecture.

**Handoff and acceptance:** Consumers project and render shadows; the game supplies proxy policy. Measure representative costs before increasing sample counts, and validate contact/shadow appearance in a real renderer rather than treating package geometry tests as visual evidence.

## Public contracts and consumer adoption

- [ ] Keep the package dependency-free and callback/environment-driven; add no game, scene, canvas, Svelte or i18n imports.
- [ ] Export each intended API only through `src/index.ts`; update `README.md` contracts and examples with the implementation, including the actual `animatedLightSignature(light, timeMs)` signature when that API is changed.
- [ ] Add synthetic-environment and boundary/public-surface coverage for each new contract; package tests establish math and geometry, not renderer appearance or raster performance.
- [ ] Coordinate package release/version and consumer adoption before relying on new fields or changing visual defaults. Game acceptance and implementation ownership are in the [matching game milestones](../drakriddarna/TODO-lighting.md).

## Cache safety — existing proposal

Not committed to — visibility and occlusion caches avoid repeating
ray work, but the consumer supplies `occlusionKey` to represent every
change visible through its `LightingEnv` callbacks. Reusing an old key
after doors, actors, fog or room data changes can therefore reuse stale
occlusion data. The current explicit token keeps game state out of this
package, but puts correctness responsibility on every caller.

### Plan (preserve the consumer-owned environment)

1. [x] Document the complete invalidation contract and provide a focused
       example showing a stable environment with a changing revision token
       (README "Cache invalidation contract").
2. Gather consumer evidence before choosing between an explicit
   `invalidateLightingCache(env)` seam, a caller-owned revision object,
   or the current string token with stronger diagnostics.
3. [x] Add tests that mutate callback-backed occlusion with and without a
       changed token, so stale-cache behavior and the required invalidation
       are unambiguous (plus `cellSize`, alternating environments and bounded
       retention, in `src/polygons.test.ts`).
4. Measure cache retention and repeated environment usage; consider a
   bounded per-environment cache only if a real workload needs it.

### Open questions

- Should cache invalidation be explicit, or is documenting the revision
  token sufficient for consumers?
- Is the one-entry occlusion-map cache adequate when a consumer alternates
  among multiple environments in one frame?
- Can the package help callers create a reliable token without coupling
  it to their world model?

### Leverage for existing consumers

Keep `LightingEnv` callback-based and avoid importing `@hoard-engine/grid`
or game state. Any cache changes must preserve current polygon output,
ray/corner rules and bounded polygon-cache behavior; visual changes need
consumer sign-off and rendering regression coverage.
