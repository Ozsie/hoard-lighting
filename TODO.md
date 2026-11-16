# TODO: Make lighting cache invalidation harder to misuse

Not committed to — visibility and occlusion caches avoid repeating
ray work, but the consumer supplies `occlusionKey` to represent every
change visible through its `LightingEnv` callbacks. Reusing an old key
after doors, actors, fog or room data changes can therefore reuse stale
occlusion data. The current explicit token keeps game state out of this
package, but puts correctness responsibility on every caller.

## Plan (preserve the consumer-owned environment)

1. Document the complete invalidation contract and provide a focused
   example showing a stable environment with a changing revision token.
2. Gather consumer evidence before choosing between an explicit
   `invalidateLightingCache(env)` seam, a caller-owned revision object,
   or the current string token with stronger diagnostics.
3. Add tests that mutate callback-backed occlusion with and without a
   changed token, so stale-cache behavior and the required invalidation
   are unambiguous.
4. Measure cache retention and repeated environment usage; consider a
   bounded per-environment cache only if a real workload needs it.

## Open questions

- Should cache invalidation be explicit, or is documenting the revision
  token sufficient for consumers?
- Is the one-entry occlusion-map cache adequate when a consumer alternates
  among multiple environments in one frame?
- Can the package help callers create a reliable token without coupling
  it to their world model?

## Leverage for existing consumers

Keep `LightingEnv` callback-based and avoid importing `@hoard-engine/grid`
or game state. Any cache changes must preserve current polygon output,
ray/corner rules and bounded polygon-cache behavior; visual changes need
consumer sign-off and rendering regression coverage.
