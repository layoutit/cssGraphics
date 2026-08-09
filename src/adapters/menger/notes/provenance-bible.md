# cssMenger provenance bible

Status: deterministic depth-3 retained-DOM first slice and native oracle
implemented; native/browser pixel parity remains unqualified

Last verified: 2026-08-08

Target: XScreenSaver `menger` 6.15 at
`906693799e4fb7581436590cf84ecb2d3c9186ba`

Renderer: retained-DOM PolyCSS only

## Provenance decision

cssMenger targets the pinned XScreenSaver implementation, not a generic Menger
sponge. The byte-locked authority includes recursive geometry and visible-face
ordering, depth progression, color/HSV generation, XScreenSaver random state,
rotator motion, trackball/quaternion behavior, adapter declarations, config,
and manual.

`notes/references/source-lock.json` records 18 file sizes, SHA-256 hashes, and
Git blob identities. `tools/verify-provenance.mjs` verifies them against the
exact commit and tree. Menger is procedural and requires no external art,
model, texture, or proprietary data.

## Authority order

1. The verified byte-identified source closure.
2. A deterministic native/source harness built from that closure.
3. Exact occupied-cell, visible-face, depth, color, transform, and frame traces.
4. Independently authored PolyCSS preparation checked against those traces.
5. Generated manifests, retained snapshots, browser contracts, and visual diffs.
6. Screenshots and videos as previews only.

## Closure boundary

The completed port-authority closure contains every pinned source/support file
that can define portable Menger output. Generated `config.h`, generic process
and window plumbing, and system X11/OpenGL headers and libraries are native
build inputs, not Menger behavior authority. The no-window native-oracle
harness binds its exact compiler, SDK, input bytes, executable, seed, 960x600
viewport, renderer, and numbered 0-45 draw schedule before making a native
claim.

Upstream source, native binaries, captures, and traces stay local. Public code
must be independently authored PolyCSS preparation/runtime code; the pinned XML
is reference-only and is not vendored.

## Implemented first slice

The canonical product prepares one deterministic depth-3 sponge with the exact
`menger_recurs_1` face-mask traversal. Its 18,048 source quads are preserved in
the coverage ledger and emitted as 84 directional-plane alpha-atlas bundles across
three semantic `b`/`i`/`s` leaf bands directly under the retained scene root. The coverage hash is
`5bb98301f900af4b1b15ae73ffbd7338836b67bb0bd48b26da6017b1874b60ea`.

Seed `26080801` drives the prepared `yarandom.c`, `rotator.c`, `colors.c`, and
`hsv.c` semantics. Preparation exports 128 palette colors and 1,440 transform
and axis-color rows at the source 30 ms frame delay. The finite segment clamps
at its last state; it does not claim a false loop. Wander, trackball input, and
depth transitions remain outside this first slice.

## Preparation/runtime boundary

Preparation owns recursive occupancy, visible-face elimination, source order,
colors, depth states, rotation/wander rows, camera, ids, metrics, manifests, and
the retained snapshot. It may merge leaves only with exact coverage, winding,
color, and visibility proof.

Runtime may adopt stable retained leaves, select prepared depth/animation rows,
apply prepared root transforms, and expose pause/seek/step/debug state. Runtime
must not recurse, generate cubes or faces, merge geometry, generate colors,
calculate camera state, grow the DOM, or ingest native replay.

The product route is retained-DOM PolyCSS only: no Canvas, SVG geometry,
WebGL/WebGPU, Three.js, Babylon, WASM/emulation, or alternate renderer.

## Claims ledger

Proven now:

- exact repository commit and tree identity;
- exact 18-file portable Menger authority closure;
- exact per-file byte size, SHA-256, and Git blob identity;
- no external data dependency;
- reproducible fail-closed provenance verification;
- exact 18,048-face depth-3 source census and exact coverage through 84
  prepared coplanar bundles;
- deterministic 128-color palette and 1,440-state prepared playback hashes;
- a source-built, no-window macOS CGL oracle using the real pinned `menger.c`,
  `rotator.c`, `yarandom.c`, `colors.c`, and `hsv.c` behavior;
- byte-exact native state A/A and pixel-exact native frame A/A across ticks
  0-45;
- byte-exact browser state A/A and pixel-exact browser frame A/A across the
  same prepared ticks;
- exact native/browser agreement for depth, 18,048-face census, rotation,
  palette indices, and 16-bit source colors across all 46 compared states;
- exact-first native/browser pixel evidence with native, browser, and absolute
  difference images; the pixel result is honestly recorded as diverged rather
  than qualified;
- a retained PolyCSS snapshot with only the camera and scene projection roots
  plus 84 stable leaves; model and axis wrapper counts are zero;
- headless browser evidence with zero runtime DOM mutations and zero runtime
  geometry, recursion, merge, color-generation, rotation-calculation, or
  camera-calculation work.

Pending:

- preparation of the native moving fixed-function two-light contribution;
- depth transitions, wander/trackball behavior, and native/browser pixel
  parity.

Describe cssMenger as a working source-backed first slice, not a visually
qualified full XScreenSaver reproduction, until those later gates close.
