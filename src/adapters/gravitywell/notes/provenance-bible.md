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
bank has sixteen content-addressed blocks containing one exact random-access
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
solid-quad line leaves with `createPolyMorphPreparedDomTarget`, and fetches,
verifies, decompresses, decodes, and formats all sixteen blocks of the selected
bank beneath the loading cover before exposing the scene. The largest selected
bank transfers 1,733,655 encoded block bytes and expands to 42,212,693 bytes of
prepared CSS strings. Playback releases only blocks it has already passed.
The next complete shuffled bank starts preparing at the first block's midpoint,
well ahead of handoff. Its fixed-two-decimal `matrix3d` formatting runs in
bounded two-millisecond timer slices outside frame publication, with successive
slices separated by one source frame so they cannot bunch inside one task.
Unlike the previous idle-callback request, timer slices are not starved by
continuous style and compositor work. The shuffle visits the other 23 banks
without replacement.
Sequential frames visit only their independently prepared transform and color
write indices. Twenty-five conservative rectangular viewport profiles prepare
visible-leaf membership for every bank frame, including one-frame temporal
dilation and sparse visibility assignments. Fine-pointer devices choose the
smallest-area profile covering the CSS viewport on load or resize. Coarse-pointer
devices choose the smallest prepared square covering both viewport axes. The
square policy restores the larger projection guard required by real mobile CSS
3D compositors without disabling culling or changing prepared geometry. Runtime
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

In the locally generated rectangular-profile candidate, a 390 by 844 viewport
uses the 430 by 960 profile instead of the legacy 1,024-pixel square. Across
three controlled FrameSleuth runs, the worst-transition selected transform
writes fall from 1,113 to 753 and selected color writes from 811 to 519. Median
total player publication work over the 1.8-second trial falls from 329.548 ms to
220.656 ms; median maximum player callback work falls from 11.101 ms to 6.991
ms. Four deterministic browser captures remain byte-identical to the legacy
product. The 24-bank archive grows by 211,695 bytes. Browser compositor cadence
does not materially change, so this is a page-owned work and headroom
improvement rather than a claim that external compositor stalls are eliminated.

The rectangular mobile selection was subsequently found to expose disconnected
retained segments on a real mobile compositor even though Chrome emulation
painted the same frames continuously. The coarse-pointer correction reuses the
existing 1,024 by 1,024 prepared profile for a 390 by 844 viewport: 1,113 of
1,922 leaves remain selected instead of 753. A controlled five-second Chrome
DPR-3 comparison published the same 167 prepared frames with no long tasks;
the rectangular and conservative runs measured 9.3 ms and 9.1 ms display-
interval p95 respectively. The accepted tick-120 Chrome PNG is byte-identical
before and after the policy change. This evidence bounds Chrome cost and visual
output; the originating real device remains the required final compositor check.

An earlier 960 by 600, 5.5-second production/candidate streaming trace over the same
bank reduces current-plus-lookahead prepared CSS string residency from
25,746,023 to 4,816,407 bytes. The production trace records two 91–95 ms long
tasks, a 129.719 ms maximum GC slice, and a 91.8 ms maximum display interval;
the sixteen-block product records no long task, a 42.721 ms maximum GC slice,
and a 33.6 ms maximum display interval. Both runs transfer approximately 1.5 MB
of transform packets over the interval; the change bounds allocation size
rather than shifting work onto the wire. That two-block residency experiment
was superseded by the complete selected-bank preload after it still permitted
activation waits in a real production trace.

A later 6.8-second real production trace exposed a release-blocking flaw that
the earlier warmed 1.8-second trace did not cover: six repeated 283–776 ms
DrawFrame gaps aligned with transform-block activation while idle-callback
lookahead decoding was starved. A direct local boundary probe reproduced
214–306 ms waits only when a transform block loaded. The repair retains the
same blocks, matrices, colors, two-millisecond slice budget, and one-frame slice
spacing, but fully prepares the selected bank beneath the loader and schedules
future-bank slices with the source-frame timer instead of waiting for browser
idle time. The release gate now begins with the real endless route in an
untouched seven-second playback window before any pause, seek, or step. At 960
by 600 it crosses 11 block boundaries and 234 prepared frames with zero runtime
block loads, zero activation waits, zero long tasks, a 16.7 ms maximum rAF
sample, and a 41.031 ms maximum FrameSleuth DrawFrame interval after excluding
only the first 500 ms tracing-start seam. A separate 12.5-second run crosses an
endless bank handoff with both banks completely prepared, no bank wait, no
activation wait, stable DOM identity, and a 25 ms maximum sampled gap.

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
