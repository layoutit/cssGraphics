# css.graphics/cityflow

Source-backed XScreenSaver Cityflow rendered as retained PolyCSS Morph boxes.
The desktop and mobile prepared banks use the source's own `count` control at
200 and 100 boxes respectively; the XScreenSaver default is 800. Every box
retains the source-emitted top, front, and right faces.

```bash
pnpm prepare:cityflow
pnpm dev:cityflow
pnpm test:cityflow
pnpm test:cityflow:assets
pnpm prepare:cityflow:check
pnpm test:cityflow:browser
pnpm oracle:cityflow:native
pnpm oracle:cityflow:visual
pnpm oracle:cityflow:visual:full
pnpm audit:cityflow:motion
pnpm audit:cityflow:smoothness -- --frames /absolute/path/to/presentation-frames
pnpm perf:cityflow:trace
pnpm build:cityflow
pnpm build:cityflow:deploy
pnpm test:cityflow:deploy
```

Preparation downloads only the 14 hash-bound files from the pinned XScreenSaver
revision into the ignored `.local/upstreams/` tree. Set
`CSSCITYFLOW_SOURCE_ROOT=/path/to/xscreensaver` to verify an existing checkout
instead; its Git revision and every consumed file must match the source lock.

Preparation owns the seeded source initialization, smooth color map, box
geometry, source-light factors, OpenGL far-plane cutoff, Morph packages, and
the exact 251-frame source-state tables. It also resamples those source states
into a periodic 301-frame presentation bank with a periodic uniform cubic
B-spline C2 reconstruction. The reconstruction is a convex four-sample blend,
closes position, velocity, and acceleration at the loop boundary, and cannot
overshoot its four source heights. A zero-phase five-tap binomial filter with
weights `[1, 4, 6, 4, 1] / 16` smooths the prepared presentation without phase
lag. Preparation absorbs every circular direction run of twelve frames or
less into its surrounding direction, applies a zero-phase three-tap pass,
repeats the fold, and finishes with another five-tap pass and fold. It
rebalances positive and negative travel to keep
periodic zero-sum closure, recenters each trajectory, and clamps its affine
range to the filtered input range. Preparation then refits each monotonic run
between the centers of its extrema with the normalized integral of
`sin(πt) × (1 - r × sin²(πt))`. Short runs keep cosine easing; `r` rises
linearly from zero at 27 frames to `0.55` at 57 frames. This reduces the long
runs' low-motion tails without the fractional endpoint shape of the former
`sin(πt)^0.85` curve, while preserving every extremum, range, and direction-run
order. The separate source bank remains exact.
Prepared face colors interpolate between adjacent source palette entries.
Preparation emits one affine template and one fixed-point height-delta stream per
box, plus packed presentation/source indices and deduplicated final three-face
color materials. The loader expands the prepared component streams once into
cached final `matrix3d(...)` strings before playback becomes ready. The animation
loop only indexes those cached strings. The pinned native depth/backface and older face-level visibility
schedules remain diagnostic evidence only. The desktop product keeps its
200-root/600-leaf topology and uses one viewport-independent prepared whole-box
visibility schedule. It is the union of three full-cycle solid-face-ID
projection censuses, dilated by twelve frames around every transition, plus
eight boxes proven to affect Chrome's CSS 3D sorting even when their own pixels
are hidden. The schedule leaves 128 boxes always visible and publishes 166--187
boxes, or 498--561 faces, per frame. Its 240 box transitions change at most six
boxes, or 18 direct leaf visibility properties, in one frame. Five boxes stay
hidden throughout. The independently prepared mobile product has 100 roots and
300 leaves and keeps all of them visible throughout its 301-state presentation;
it does not reuse desktop visibility indices. Every selected-bank root remains
in the CSS 3D sorting tree; leaves are hidden only as whole boxes.
All retained leaves remain the geometry and color
owners; there is no pseudo-element paint surface. The side
leaves use a subpixel-free `1px` layout height. Desktop prepared depth defaults
to `0.1`; a native/browser black-gap census extends only 19 measured desktop
faces up to `0.28`. Mobile uses a prepared uniform `0.28` depth after the
`0.1` candidate failed its complete native/browser frame comparison. These
matrices close exposed moving-tower sides without restoring the former
full-height side planes.
Playback writes each paint-participating box's cached complete transform directly and publishes the
prepared final background color directly to each retained face. No dynamic color
expression, transform variable, global per-frame selector bank, or stylesheet-rule
mutation participates in playback. Prepared box transitions set `visibility`
directly on all three leaves. Hidden boxes skip transform publication; re-entry
publishes the current transform. The runtime performs no viewport query and no
visibility, geometry, or projection calculation.
Face colors change only when their packed
prepared material index changes. One paint-aligned rAF clock advances exactly
one adjacent prepared state when due. If delivery is late, it resets the next
deadline instead of jumping across states or replaying a burst. The clock uses
the later of the animation-frame timestamp and actual callback delivery time.
If accumulated deadline phase drift would reject a callback delivered at least
three-quarters of a frame after the last publication, the clock publishes that
adjacent state and re-phases once. Earlier sub-vsync duplicates remain suppressed.
The animation loop creates no animation objects and performs no number formatting,
background position update, transform assembly, or runtime atlas work. Exact source-frame debug seeks force
the corresponding exact prepared source color and transform state. Runtime
does no geometry calculation, atlas rasterization, topology rebuilding, or DOM growth.
The loader selects one prepared bank before any model, playback, or CSS fetch:
mobile for widths below 600 px, coarse-pointer devices, or a mobile user agent;
desktop otherwise. It fetches and mounts only that bank and never switches it
on resize. The product starts playback automatically with the fixed source
camera. It does not install pointer-orbit or wheel-zoom controls.

The bank retains 251 exact source frames, the nearest whole-frame approximation
to the `2π / 0.025` wave period, plus a 301-state periodic presentation over
the same real-time span. The source bank remains exact for oracle seeks; the
filtered uniform cubic B-spline C2 reconstruction and interpolated colors are the documented browser presentation
adaptation. The source license and exact permission notice are preserved in
`NOTICE.md`.

The smoothness audit measures circular velocity, acceleration, jerk, held
transitions, and direction runs up to three, six, and twelve frames from every prepared box-height trajectory. Its 12-, 18-, and 24-frame rolling values only locate clustered irregularity; they are diagnostics, not an optimization target or an acceptance claim. With `--frames`, it also
measures frame-domain motion-energy variation directly from the raw numbered
PNG sequence through FFmpeg VMAF Motion. The values are matched-build regression
signals, not a standalone claim of perceptual smoothness.

The current release evidence includes a pixel-exact 301-transition sparse-versus-
full-publication audit at 1280x720 and 2560x1224. A full-loop LayerTree census at
1280x720 measures 508--571 total compositor layers, tracking the prepared visible
face count plus ten; a fully published frame would require 610. The normal-speed
trace passes the captured cadence and pipeline gates. A separate 4x CPU stress
trace exceeds the paint threshold and is diagnostic only. The broad independent-
page viewport comparator still shows small, non-repeatable raster-edge deltas on
some normal-ratio frames, so those results are not described as exact parity.
