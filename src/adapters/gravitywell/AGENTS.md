# Gravity Well adapter contract

- Read `notes/provenance-bible.md` before changing source simulation,
  topology, matrices, colors, camera, timing, or parity claims.
- Preparation owns source simulation, all geometry, every Morph matrix, and
  every color row. Runtime may only select and publish prepared state.
- Preserve all 24 deterministic banks, seed-0 fixed view, the shared exact-flat
  state hash, crypto-random initial selection, and shuffle-without-replacement.
- A bank may switch only after `allWellsCompleteFrameIndex` and the terminal
  exact-flat hold. The handoff to frame 0 of the next bank must write no styles
  and must preserve DOM identity.
- Keep the 240 source-authority frames separate from the user-directed flat
  lead-in and per-well no-respawn drain; do not extend native parity claims to
  the presentation envelope.
- Keep one stable retained PolyCSS graph. No Canvas, WebGL, WebGPU, SVG scene
  geometry, masks, clip paths, runtime polygon construction, or DOM growth.
- Preserve all 1,922 source-ordered coarse native grid segments as retained
  solid quads, followed by 62 prepared presentation segments that close the
  source's omitted final row and column. Native adaptive sub-segment fidelity
  is a visual-oracle issue, not permission to replace the retained DOM renderer.
- Preserve PolyCSS's mounted visible-backface value without restoring a
  duplicate adapter `!important` rule; any renderer-style change must retain
  the four-frame browser oracle.
- Keep source checkouts, captures, traces, and generated product banks ignored.
