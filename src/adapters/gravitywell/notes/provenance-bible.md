# cssGravityWell provenance bible

## Authority

The scene is derived from XScreenSaver `gravitywell.c` at commit
`906693799e4fb7581436590cf84ecb2d3c9186ba`. Exact file identities live in
`notes/references/source-lock.json`. The primary file carries its own
permissive notice. Gravity Well has no external model or texture asset.

## Prepared first slice

Preparation owns 24 deterministic seed banks. Each bank owns the
source-compatible `yarandom` stream, 15 star records, inverse-square field with
the source inner-radius cap and outer-radius cutoff, 240 source-timed states,
32 by 32 field vertices, 1,922 source-ordered coarse grid segments,
depth-and-fog colors, every PolyCSS solid-quad leaf matrix, prepared blocks,
and separate sparse transform and color write schedules. Transform
storage follows the sibling cssPipes/cssFlower prepared-block pattern: each
bank has three content-addressed blocks containing one exact random-access
keyframe followed only by frame-ordered prepared transform deltas. The same
block owns its sparse prepared color values; block zero owns delta-varint leaf
indices. The static Morph model uses transparent HTTP Brotli transport and the
prepared CSS palette is a single gzip member in the shared catalog. All banks use
the seed-0 source trackball quaternion and 40 degree native camera so changing a
bank cannot move the view. One common static Morph package owns the retained
topology.

PolyCSS mounts all 1,922 prepared line leaves with visible back faces. The
adapter deliberately adds no duplicate `!important` backface rule: the mounted
computed value remains `visible`, while Chrome avoids resolving the redundant
high-priority declaration for every changed leaf. The deterministic four-frame
rendered oracle verifies that removing that override changes no accepted
browser pixels.

Native fog blends source colors toward the black clear color and renders the
lines with OpenGL line smoothing. The prepared CSS palette stores the fog factor
multiplied by a `0.6` line-coverage calibration as color alpha. That calibration
was selected with the deterministic four-frame rendered oracle: it approximates
the native antialiased two-pixel line coverage without adding retained leaves or
runtime work. Alpha keeps the css.graphics blue-black shell gradient continuous
at the horizon instead of introducing an opaque-black seam.

The endless presentation envelope is explicit and is not native behavior. It
adds an exact-flat lead-in, stops respawning after the 240 native-authority
states, and prepares a separate smoothstep completion duration for each well
that is still visible. Star motion continues without respawn during that drain.
The bank reaches an exact zero-depth state only after every prepared well
contribution is zero, then holds that state for four frames. The 24 banks are
290 through 324 frames long. Their opening, completion, and terminal flat
states share one verified prepared-state hash.

The selected grid-size is `16 / 7`, so XScreenSaver's integer `gridmod` is 16
and each prepared cell is one native display interval. This is a legitimate
native profile, not a claim about the default `grid-size = 1` raster.

## Runtime boundary

The browser loads the verified static Morph package and bank catalog, chooses
the initial bank with `crypto.getRandomValues`, adopts its 1,922 retained
solid-quad line leaves with `createPolyMorphPreparedDomTarget`, and loads only
that bank's descriptor and first self-contained block for first paint. Its
lookahead block starts halfway through block zero. The next shuffled bank starts
prefetching only after the active bank's 240-frame source-authority window. The active
bank retains only its current and one lookahead transform block. The shuffle
visits the other 23 banks without replacement.
Sequential frames visit only their independently prepared transform and color
write indices. Five conservative square viewport profiles prepare visible-leaf
membership for every bank frame, including one-frame temporal dilation and
sparse visibility assignments. Runtime chooses one profile on load or resize,
keeps exact prepared transform and color state for hidden leaves, publishes
styles only to selected leaves, and catches each newly selected leaf up before
showing it. It performs no per-frame projection or viewport leaf scan. At the
terminal flat frame, the player adopts the next bank at
its identical frame 0 without a style write or DOM mutation. The absolute timer
publishes one prepared frame per callback.

Runtime field evaluation, gravity, star motion, completion interpolation,
random geometry, topology, polygon construction, normals, affine matrix
evaluation, color generation, DOM growth, Canvas, SVG scene geometry, WebGL,
WebGPU, masks, and clip paths are forbidden. Randomness selects only prepared
bank indices.

At 1,512 by 982 CSS pixels and DPR 2, the prepared worst transition contains
1,922 transform and 1,299 color changes. The selected 1,536-pixel profile
publishes 1,322 transforms and 971 colors. The final Chrome trace measures a
`0.9 ms` worst-transition publication p95, `0.7 ms` steady-state publication
p95, and `9.2 ms` display-interval p95, with a `17.6 ms` maximum, no long tasks,
no empty scheduler callbacks, no transform-block load, and no DOM growth. The
same four deterministic browser frames remain pixel-exact against the deployed
pre-optimization product.

## Proof boundary

The numeric native state oracle compares 20 C/JS depth samples at ticks 0, 1,
60, 120, and 239 with a `0.002` float tolerance; its observed maximum is
`0.0007518813406939273`.

The rendered oracle compiles and includes the pinned `gravitywell.c` with the
original XScreenSaver RNG, color, HSV, trackball, and quaternion sources in a
no-window macOS CGL framebuffer. It captures native and browser ticks 0, 60,
120, and 239 at 960 by 600. Native A/A and browser A/A are pixel-exact. The
native/browser comparison is deliberately an exact-zero gate and currently
fails: mean absolute delta is `3.300204` through `4.875751`; the four-frame mean
is `4.228078`. Evidence lives in
the ignored `bench/results/cssgravitywell/native-browser-visual/` tree.

The remaining visual boundary is explicit: the product retains one quad per
native 16-unit grid interval, while `draw_row()` dynamically emits one-unit
sub-segments near wells and also draws star footprint loops with OpenGL line
smoothing. Describe the scene as source-backed with native state/camera
alignment, not native raster parity.

The native state and rendered oracles address only the 240 source-authority
states in deterministic bank 0 (`?bank=0&cycle=0`). They do not establish that
the flat lead-in, per-well drain, random bank selection, or endless cycling are
native XScreenSaver behaviors.
