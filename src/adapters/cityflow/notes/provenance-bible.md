# cssCityflow provenance

## Authority

- Project: XScreenSaver Cityflow
- Revision: `906693799e4fb7581436590cf84ecb2d3c9186ba`
- Primary source: `hacks/glx/cityflow.c`
- Primary SHA-256: `9113c9f3214ba6c1f350b3863c306e6015e47a856a17bbe24d597f909dfa027b`
- Configuration: `hacks/config/cityflow.xml`
- Configuration SHA-256: `0453c12e39e4b7d32e66a7780d69979aaaa42d0632a3b6757df9c1cee6c7c919`

The primary file grants permission to use, copy, modify, distribute, and sell
the software and documentation provided its copyright and permission notices
are preserved. Cityflow has no external model or texture data.

## Source contract

The default mode initializes 800 randomly positioned and skewed boxes, six
moving interference sources, a radius of 256, wave speed 25, skew 12, and a
20 ms delay. Although each box is a solid, the source deliberately emits only
its top, front, and right quads; the left and back faces are compiled out and
there is no bottom face. The default retained census is therefore 800 roots
and 2,400 leaves.

The desktop and mobile prepared banks use the source-supported `count` option
at 200 and 100 boxes respectively. The source default remains 800, and the
source's `1.8 / sqrt(count)` box scale is preserved independently for each
selected count. The mobile count is therefore a source-supported prepared
simulation input, not a runtime subset of the desktop boxes.

The deterministic prepared seed is product authoring input because the native
screen saver normally seeds `ya_random` from process and wall-clock state. The
source equations, random stream, smooth color-map construction, draw cadence,
lighting, and camera remain authoritative.

## Runtime boundary

Preparation writes independent desktop and mobile static Morph packages, each
with 251 exact source-cadence typed transform/color-index frames and a 301-frame
60 Hz presentation stream. Every box retains three solid quad leaves.
The 251-frame bank is the nearest whole-frame approximation to the source wave
period of `2π / 0.025 = 251.327...` frames. The native source advances
continuously, so the product labels this as a prepared periodic approximation
rather than an exact source loop.
Because CSS perspective has no OpenGL far plane, preparation derives the side
face cutoff from the exact source model-view sequence and clips the source
`bottom = 5` faces conservatively at eye-space `z = -50`. Each prepared box
matrix carries real initial geometry rather than adapter metadata. Preparation
uses the exact static source-light factors to deduplicate direct face-color
slots. It reconstructs the exact 50 Hz source heights into a periodic 301-state
uniform cubic B-spline C2 transform bank and applies the convex zero-phase
five-tap binomial filter `[1, 4, 6, 4, 1] / 16`. Preparation folds every
circular direction run of twelve frames or less into its surrounding direction,
applies the zero-phase three-tap filter `[1, 2, 1] / 4`, and repeats the
twelve-frame fold. A final five-tap pass smooths the fold boundaries and one
last twelve-frame fold removes the few short runs that pass reintroduced.
Preparation then refits each monotonic run between the centers of its prepared
extrema with the normalized integral of `sin(πt) × (1 - r × sin²(πt))`, where
`r = 0.55 × clamp((runFrames - 27) / 30, 0, 1)`. Each fold rebalances positive and negative travel to retain
periodic zero-sum closure, recenters the trajectory, and preserves the filtered
input range; the adaptive smooth-sine refit preserves every extremum, the complete
range, and the direction-run order. Short runs keep cosine easing while long runs
receive progressively flatter mid-run velocity without a fractional endpoint
shape. It prepares sRGB color interpolation from the resulting height
trajectory.
Real-time speed remains within the documented nearest-period replay. Preparation
writes one affine template and one exact fixed-point height-delta stream per box,
plus packed transform indices and deduplicated final three-face color dictionaries
and packed indices for presentation and source seeks. The loader expands the
prepared component streams once into cached final CSS strings before readiness;
the animation loop only performs table lookup.
A pinned native
depth/backface ID-buffer census across eight desktop, square, ultrawide, and
portrait viewports prepares a 301-frame visibility schedule. The source schedule
unions all sampled viewports and dilates visibility by one frame before and
after each transition. A prepared Chrome face-ID census at 1280×720 covers the
adaptive-smooth-sine trajectory; preparation unions it with the native schedule and
applies two conservative frames on each side. The full-cycle browser face audit also
keeps faces 342, 369, 452, 454, 504, and 552 conservatively visible and extends
the source schedule to twelve frames for faces 469, 470, 482, 543, 553, 565,
566, and 582. Product playback does not consume those frame-specific tables.
A separate Chrome solid-face-ID census covers all 301 presentation frames at
normal, wide, and ultrawide projection ratios. The product unions those censuses
at whole-box granularity and dilates transitions by twelve frames. Full-frame
raster attribution identified boxes 155, 156, 165, 171, 172, 179, 185, and 196
as CSS 3D sorting dependencies, so they remain visible throughout even when the
ID census finds no pixels from their own faces. The resulting viewport-independent
desktop schedule leaves 128 boxes always visible and publishes 166--187 boxes, or
498--561 faces, per frame. It contains 240 box transitions and changes at most
six boxes per frame. The retained topology remains 200 roots and 600 leaves;
every root stays in the CSS 3D sorting tree, while all three leaves of a hidden
box receive direct `visibility:hidden`. The mobile bank prepares all 100 boxes
as visible for every presentation state and has no visibility transitions; it
does not reuse desktop box indices. All retained leaves remain the
sole geometry and color owners. Preparation resolves interpolated sRGB into final face colors, so each
leaf has one paint surface and no pseudo-element overlay. The side leaves use a
subpixel-free `1px` layout height. Desktop prepared depth defaults to `0.1`,
with native-gap-derived overrides on 19 faces and a `0.28` maximum. Mobile uses
a prepared uniform `0.28` depth with no borrowed desktop face overrides after
the `0.1` candidate failed the complete native/browser frame sequence. There is no background-position color transport,
dynamic transform/color variable, or runtime atlas. Exact source-frame seeks force the
corresponding source color and transform state. One continuous paint-aligned callback publishes exactly
one adjacent prepared state when due and uses the later of the animation-frame
timestamp and callback delivery time. Hidden boxes skip transform writes, and a
box returning to visibility receives its current prepared transform. No viewport
query or projection calculation participates in playback. A late callback resets the next deadline;
it does not skip prepared states or replay a burst. The player creates zero
animation objects, and frame publication performs no transform or color formatting. There is
no timer-to-rAF handoff, runtime geometry, rasterization, topology rebuilding,
or DOM growth.

## Proof state

- Source-state oracle: product ticks 0, 73, 250, and the post-bank tick 251 match the pinned
  C implementation within explicit float tolerance.
- Browser retained-DOM smoke: desktop mounts the 200-root/600-leaf bank and
  mobile mounts the independent 100-root/300-leaf bank. Each profile requests
  only its selected model, playback, and CSS assets, keeps DOM identity stable,
  publishes prepared transforms, and constructs/redraws no atlases.
- Mobile bank visual sequence: the complete 251-frame 390×844 native/browser
  comparison has byte-identical native A/A and browser A/A captures. Its worst
  aligned frame is 159 at mean absolute delta `0.621742` and changed-pixel
  ratio `0.0141`, below the calibrated `1.125`, `0.05`, and channel-2 limits.
  The earlier `0.1` mobile side-depth candidate was rejected before adoption.
- Full-bank native visual capture: the headless macOS CGL harness executes the
  pinned `cityflow.c` source directly; both native and browser 251-frame A/A
  runs are byte-identical.
- Desktop browser visual parity: the current prepared whole-box visibility and
  retained three-leaf geometry path passes all 251 prepared source-cadence frames at the
  calibrated native / retained-DOM comparison at mean delta `<= 1.125`,
  changed-pixel ratio `<= 0.05`, and channel threshold `2`. Frame 155 is the
  worst observed frame at mean delta `1.115152` and changed-pixel ratio
  `0.045005`; the residual is confined to cross-renderer polygon edges.
- Rejected presentation experiment: a `0.005` source-unit height grid passed
  still-frame differential thresholds but caused visibly stepped motion. It was
  removed. A 12 Hz per-building color-publication throttle was removed with it;
  later experiments replaced it with prepared continuous interpolation and
  prepared sRGB interpolation between adjacent source palette entries.
- Rejected schedulers and transport: elapsed catch-up skipped prepared
  presentation states after a missed display deadline, amplifying visible
  stepping. A split path with 200 Web Animations then transported transforms on
  the compositor while an independent scheduler published color and opacity.
  Aligning that scheduler to animation `currentTime` removed the face-phase bug,
  but that earlier path still used the stepped linear presentation bank, and
  the user's headed trace had presented-frame p95 `33.361 ms`, maximum
  `50.041 ms`, and three smoothness-affecting pipeline records. The replacement
  was the schema-6 direct-state publisher. It fixed delivery cadence but did not
  fix the perceptual stepping in the prepared visual sequence.
- The next user-headed trace, `Trace-20260901T112231.json.gz`, still failed:
  presented-frame p95 was `33.361 ms`, maximum was `35.116 ms`, 15 DrawFrame
  gaps exceeded `33.3 ms`, and one pipeline record affected smoothness. It
  delivered 191 rAF callbacks but produced only 155 style/layout publications.
  The rejected callbacks took only `0.027–0.059 ms`; Cityflow was comparing its
  deadline only with a stale animation-frame timestamp even though callback
  delivery time had advanced. The scheduler now uses the later clock, as the
  published Galaxy player does, while still publishing exactly one next state
  and never catching up by skipping states.
- The rejected background-position atlas experiment was removed because it did
  not reduce the retained 3D draw topology and failed visual parity on side
  faces. A matched Chrome A/B instead showed that prepared opacity culling
  reduced Viz-compositor occupancy from `71.7%` to `24.2%`, p95 task duration
  from `14.051 ms` to `4.685 ms`, and tasks over `8.333 ms` from `290` to zero.
- Three pre-clock-fix local schema-6 traces had no holds above `33.3 ms`, but the
  later headed trace above failed. They are retained as evidence that local
  headless timing alone was insufficient, not as readiness proof.
- Two post-clock-fix local traces each paired 478 rAF callbacks with 478
  style/layout publications. Presented-frame p95 was `17.688 ms` and
  `17.683 ms`; maxima were `19.215 ms` and `23.931 ms`. Both had zero holds above
  `33.3 ms` and zero smoothness-affecting pipeline drops. In the `23.931 ms`
  worst interval, renderer-main work was `2.339 ms` and maximum Paint was
  `0.227 ms`; RasterTask was not captured and remains unknown.
- A post-clock-fix six-second Chrome recording sampled 361 rAF callbacks,
  produced 360 sequential publications after the initial sample, created zero
  runtime transform animations, and observed zero skipped prepared states. The
  matched face audit captured all 602 requested 120 Hz samples against an
  unculled white-face reference. Only `0.024150%` of pixels differed, the worst
  frame differed in 629 edge pixels, and all 44 full-contrast mismatches were
  isolated one-pixel raster ties; no connected missing-face region was found.
  The full 251-frame native/browser oracle still passes with stable
  200-root/600-face identity and no missing frames.
- The post-clock-fix user-headed trace, `Trace-20260901T114126.json.gz`, closes
  only the schema-6 delivery-cadence question. It does not close perceptual
  smoothness. After excluding one unbound trace-start presentation marker
  with `begin_frame_id { source_id: 0, sequence_number: 0 }`, all 243 measured
  presentation intervals were `16.680–16.681 ms`. rAF p95/max was
  `17.645/17.707 ms`, style/layout p95/max was `17.666/17.757 ms`, and DrawFrame
  p95/max was `17.713/18.171 ms`, with no DrawFrame gaps above `33.3 ms`.
  The trace contains one raw Chromium `STATE_DROPPED (BACKFILL)` record, but the
  adjacent DrawFrame gap was `17.228 ms` with `2.313 ms` renderer-main work and
  `0.287 ms` maximum Paint. Chromium defines `BACKFILL` as a synthesized report
  for a skipped BeginFrame sequence when there were no partial compositor
  updates; this record is therefore retained and qualified rather than reported
  as zero raw drops or as a visible Cityflow motion hold.
- The user's subsequent visual rejection exposed the missing evidence: the
  schema-6 white-face sequence contained pixel-identical consecutive prepared
  states and a `481131` maximum versus `978` minimum channel-absolute delta.
  Regular callback timing had hidden an uneven visual-state sequence.
- Rejected schema-7 experiment: a periodic C2 height bank, interpolated
  presentation colors, and 200 CSS transform animations were installed on the
  retained box nodes. A deterministic 603-frame seek capture changed at every
  interval, and a local headless performance trace showed presented-frame
  p95/max `17.506/18.595 ms`. Neither measurement tested the user's headed
  real-time motion adequately.
- The user's schema-7 headed trace, `Trace-20260901T122418.json.gz`, proved that
  design was a regression: of 215 measured presentation intervals, 20 were
  approximately `33.36 ms` holds and 10 were same-vsync bunches near
  `0.001 ms`; presented-frame p95/max was `33.360/33.361 ms`, DrawFrame max was
  `30.654 ms`, and rAF max was `43.010 ms`. Renderer-main/compositor occupancy
  rose to `1548.089/581.154 ms` over `3.856 s`, compared with
  `503.271/184.457 ms` over `4.107 s` in the matched schema-6 headed trace.
  Menger's single animated scene root did not justify 200 independent Cityflow
  animations plus separately scheduled face color and opacity. Schema 7 was
  removed.
- Rejected schema 8 prepared a periodic Catmull-Rom C1 transform bank that passes through
  the exact source samples. It creates no CSS animations. One elapsed-time-
  anchored rAF publisher applies a complete prepared transform, color, and
  opacity state. Late intermediate states collapse to the latest due state;
  they are not replayed in a burst.
- A fresh local schema-8 headless trace measured 477 presentation intervals at
  p50/p95/max `16.654/17.645/24.289 ms`, DrawFrame p95/max
  `17.618/18.119 ms`, no interval above `33.3 ms`, and no smoothness-affecting
  pipeline record. Renderer-main/compositor occupancy was
  `1161.437/409.012 ms` over eight seconds. RasterTask was not captured and
  remains unknown. This cross-mode trace is diagnostic evidence, not headed
  perceptual acceptance.
- A fresh schema-8 real-time headless trace with screenshot events measured 267
  presentation intervals at p50/p95/max `16.665/17.602/18.167 ms` and no
  pipeline drop. Its steady section yielded 257 decoded screenshots over
  `4.475 s`; none of the 256 consecutive pairs were pixel-identical. A separate
  deterministic 302-frame, 60 Hz complete-cycle audit also had no identical
  culled presentation interval and found no connected missing-face region.
  These artifacts did not substitute for the user's headed visual judgment,
  which rejected schema 8.
- The user's schema-8 headed trace, `Trace-20260901T130504.json.gz`, shows that
  the rejection is not explained by missed presentation cadence: all 211
  measured presented intervals were `16.680–16.681 ms`, rAF max was
  `17.698 ms`, and DrawFrame max was `18.161 ms`. One BACKFILL pipeline marker
  occurred beside a `17.448 ms` DrawFrame interval. RasterTask and screenshots
  were absent, so the trace cannot identify raster cost or show the visible
  defect.
- Direct prepared-bank analysis found the schema-8 sequence defect: Catmull-Rom
  produced 8,554 height samples outside their adjacent source-height bounds,
  including 8,482 invented movements inside flat source intervals, and 8,535
  per-box direction reversals over one cycle. Regular callback and presentation
  timestamps could not reveal this temporal trajectory error.
- Schema 9 replaces Catmull-Rom with periodic monotone cubic Hermite C1
  interpolation. Prepared-bank tests cover all 60,200 presentation box states
  and require zero adjacent-source overshoots and zero flat-interval movements.
  The face schedule receives a second deterministic temporal dilation because
  the one-frame source schedule failed the first schema-9 face audit with a
  two-pixel connected mismatch.
- The fresh schema-9 302-frame matched audit reports zero identical complete-
  presentation intervals. The culled-versus-unculled comparison differs in
  `0.022919%` of pixels; all 42 full-contrast mismatches are isolated one-pixel
  raster ties, with no connected missing-face region. Its six-second live run
  recorded 361 callbacks, zero CSS transform animations, and zero skipped
  prepared states.
- The fresh schema-9 local trace measured presented-frame p95/max
  `17.497/24.783 ms` and DrawFrame p95/max `17.495/18.808 ms`, with no interval
  above `33.3 ms` and no smoothness-affecting pipeline record. RasterTask is
  still uncaptured. This remains local headless diagnostic evidence; schema 9
  is not motion-ready until the user's headed visual judgment passes.
- Schema 11 prepares one complete root style per box and frame, keeps the top
  leaf as the direct paint owner, paints the front and right faces with root
  pseudo-elements, and removes the two retained side leaves from the render
  tree. The physically shortened `0.1px` side geometry preserves the sampled
  image while removing the long overlapping side-layer bounds. A Chrome 152
  sample at 1280×720 measured 237 compositor layers and 232 drawing layers;
  the rejected per-leaf pseudo experiment measured 468 and 234 respectively.
- Schema 11 also replaces elapsed latest-state collapse with the adjacent-state
  late-deadline-reset cadence used by the published prepared players. The fresh
  six-second Chrome recording observed 361 callbacks and zero skipped prepared
  states. Its synchronized 302-frame audit had zero identical consecutive
  color-presentation frames. Culled versus fully published geometry differed
  in `0.022766%` of pixels; all 26 full-contrast mismatches were isolated
  one-pixel raster ties, with no connected missing-face region.
- The fresh schema-11 local Chrome 152 trace measured 477 presentation
  intervals at p50/p95/max `16.660/17.630/20.750 ms`, with no interval above
  `33.3 ms` and no smoothness-affecting pipeline drop. The worst interval held
  `1.796 ms` of renderer-main work and `0.166 ms` maximum Paint. RasterTask was
  not captured and remains unknown. This is local headless diagnostic evidence,
  not a claim that the user's headed perceptual acceptance has passed.
- Schema 13 combines periodic uniform cubic B-spline C2 reconstruction with the
  zero-phase five-tap binomial filter. Its matched raw-frame audit measured 102
  one-to-three-frame direction runs, normalized geometric jerk `0.049118`, and
  normalized first-/second-difference VMAF Motion signals
  `0.069184/0.071925`. The user reported improved but still imperfect motion.
- A rejected nine-tap experiment reduced one-to-three-frame direction runs to
  51 and normalized geometric jerk to `0.033541`, but its raw-pixel normalized
  second-difference signal regressed to `0.075919`. It was not retained.
- Schema 16 retains the accepted five-tap filter and absorbs, during
  preparation, each remaining one-to-three-frame circular direction run. The
  matched complete-cycle audit reports zero such runs, normalized geometric
  jerk `0.049064`, and normalized first-/second-difference VMAF Motion signals
  `0.068997/0.071756`. These are matched-build regression signals, not proof of
  perceptual acceptance; the user's headed visual judgment remains the gate.
- The fresh schema-16 local Chrome 152 trace measured 478 presented intervals
  at p50/p95/max `16.658/17.527/18.843 ms`, with no interval above `33.3 ms`
  and no smoothness-affecting pipeline drop. The worst interval contained
  `2.834 ms` of renderer-main work and `0.246 ms` maximum Paint. RasterTask was
  not captured and remains unknown. This cadence result does not replace headed
  visual judgment of the adapted trajectory.
- The user's headed trace, `Trace-20260901T151117.json.gz`, contains one actual
  `33.361 ms` presented hold. The callback immediately before the missing
  presentation arrived `2.437 ms` before the shifted playback deadline and was
  rejected by the former one-eighth-frame (`2.083 ms`) early tolerance. The
  three BACKFILL records instead follow pairs of BeginFrames only
  `0.199–0.947 ms` apart and lead to normal `16.680–16.681 ms` presentations;
  they do not explain the visible hold. The scheduler now publishes the first
  callback after resume immediately and accepts up to one-quarter frame
  (`4.167 ms`) of display-phase drift while continuing to reject the observed
  `3.159 ms` sub-vsync duplicate callback. A dedicated trace-shaped scheduler
  regression test owns this boundary. This is a correction of the proven
  headed cadence failure, not a claim of headed perceptual acceptance.
- Schema 17 folds every remaining direction run of six frames or less into the
  surrounding direction, applies a zero-phase three-tap finish, and repeats the
  fold. Against schema 16, complete-bank direction runs fall from 2,640 to
  2,388, median movement length rises from 17 to 20 frames, stationary
  transitions fall from `0.129867` to `0.113754`, normalized acceleration falls
  from `0.139575` to `0.136101`, and normalized jerk falls from `0.049064` to
  `0.038965`. The 302-frame raw-browser sequence improves normalized first- and
  second-difference VMAF Motion from `0.068997/0.071756` to
  `0.067613/0.071262`; these remain regression signals, not perceptual proof.
- The schema-17 302-frame culled-versus-unculled audit differs in `0.021433%`
  of pixels. All 40 full-contrast mismatches are isolated one-pixel raster
  ties, and no presentation interval is pixel-identical. Its six-second live
  capture records 361 callbacks, zero transform animations, and zero skipped
  prepared states. The full 251-frame native/browser source oracle remains
  aligned at its calibrated thresholds.
- The fresh schema-17 local Chrome 152 trace measures 477 presented intervals
  at p50/p95/max `16.663/17.583/24.807 ms`, DrawFrame p95/max
  `17.543/17.832 ms`, no interval above `33.3 ms`, and no smoothness-affecting
  pipeline drop. RasterTask remains uncaptured and unknown. Headed perceptual
  acceptance remains the final gate.
- Schema 18 extends the direction-run fold from six to twelve frames. It
  reduces complete-bank direction runs from 2,388 to 1,426, raises the median
  run from 20 to 30 frames, and leaves zero runs of twelve frames or less.
  Its normalized geometric acceleration/jerk is `0.134791/0.040342`. At the
  user's 2206×1224 stage size, the raw 302-frame full-color sequence measures
  normalized first-/second-difference VMAF Motion `0.068248/0.073011`. The
  second-difference regression against schema 17 prevented accepting that
  trajectory as the endpoint.
- The user's later `Trace-20260901T154813.json.gz` contains 207 measured
  presentation intervals, all `16.680–16.681 ms`. Its initial `50.287 ms`
  DrawFrame gap is occupied by Chrome's `CpuProfiler::StartProfiling`
  (`52.741 ms`), and the later BACKFILL marker follows duplicate BeginFrames
  only `0.974 ms` apart while presentations remain regular. That trace therefore
  does not explain the remaining bounce as a Cityflow publication hold.
- Schema 19 adds a zero-phase five-tap pass after the schema-18 fold boundaries
  and folds the four short runs introduced by that pass. It retains zero runs
  of twelve frames or less, reduces the run count to 1,418, raises the median
  run to 31 frames, and reduces normalized geometric acceleration/jerk to
  `0.131032/0.031010`. On matched 2206×1224 numbered browser frames, edge-only
  normalized first-/second-difference VMAF Motion improves from
  `0.037059/0.035730` to `0.035478/0.034311`. The full-color second-difference
  signal regresses to `0.077611`, so both results remain disclosed and headed
  perceptual judgment remains the final motion gate.
- The schema-19 302-frame white-face culled-versus-unculled audit has zero
  strong mismatch pixels and zero connected missing-face failures. The full
  251-frame native/browser source oracle at the user's 2206×1224 stage size is
  aligned; frame 155 is worst at mean delta `1.038737` and changed-pixel ratio
  `0.037811`. Native and browser A/A runs are exact, DOM identity remains 200
  roots and 600 leaves, and no Canvas, WebGL, SVG scene, or transform animation
  is present.
- The source's `reshape_cube` switches to a cropped square projection when the
  render area is wider than 2:1. The adapter now reproduces that projection and
  carries exact prepared wide presentation/source visibility tables. A
  standalone 2560×1224 stage still fails calibrated native parity because a
  partly visible native face remains a whole CSS plane and can overlap another
  shape. This is a separate unresolved >2:1 stage case; the css.graphics page's
  2206×1224 Cityflow stage does not enter that branch.
- The final schema-19 local Chrome 152 trace passes every strict captured gate:
  477 presented intervals have p50/p95/max `16.654/17.599/18.150 ms`, no gap
  exceeds `33.3 ms`, DrawFrame p95/max is `17.592/17.693 ms`, and no pipeline
  record affects smoothness. Worst-frame renderer-main work is `1.942 ms` and
  maximum Paint is `0.196 ms`. RasterTask is absent from the trace and remains
  unknown; this headless result does not replace headed perceptual acceptance.
- The user's schema-19 `Trace-20260901T170042.json.gz` contains one `33.361 ms`
  presentation interval at trace startup. Its two smoothness-affecting pipeline
  drops and `53.811 ms` DrawFrame gap coincide with Chrome's
  `CpuProfiler::StartProfiling`, which occupies `60.479 ms`. The remaining 670
  measured presentation intervals are all `16.680–16.681 ms`. This trace rules
  out sustained frame-delivery failure; it does not accept the visible motion.
- Schema 20 preserves the schema-19 extrema, range, and 1,418 direction runs,
  then applies a periodic cosine ease between consecutive extrema. Prepared
  stationary transitions fall from `9.5498%` to `0.1096%`; normalized geometric
  acceleration/jerk fall from `0.131032/0.031010` to `0.101081/0.021199`; and
  motion-energy coefficient of variation falls from `0.275339` to `0.145322`.
  On matched 2206×1224 numbered browser frames, motion-energy range tightens
  from `0.33–3.32` to `0.90–2.30` and normalized first difference improves from
  `0.068483` to `0.060057`; normalized second difference regresses from
  `0.077611` to `0.090165`. These are disclosed regression signals, not headed
  perceptual acceptance.
- The schema-20 face-ID-prepared visibility schedule exposes 265–324 of the 600
  retained faces and 123–147 contributing roots per frame. Its matched 302-frame
  culled-versus-unculled audit has 182 strong mismatch pixels, all isolated
  one-pixel raster ties, with no connected missing-face region and no identical
  presentation interval. Its six-second live capture records 361 callbacks,
  zero transform animations, and zero skipped prepared states.
- The schema-20 local Chrome 152 trace passes its captured gates: 476 presented
  intervals have p50/p95/max `16.662/17.614/26.187 ms`, no gap exceeds
  `33.3 ms`, DrawFrame p95/max is `17.540/17.673 ms`, and no pipeline record
  affects smoothness. The worst presented interval contains `3.276 ms` of
  renderer-main work and `0.321 ms` maximum Paint. RasterTask is absent and
  remains unknown; the user's headed visual judgment remains the motion gate.
- The user's schema-20 `Trace-20260901T173433.json.gz` contains 730 measured
  presentation intervals, all `16.680–16.681 ms`. rAF p95/max is
  `17.602/17.692 ms`; style/layout p95/max is `17.639/23.884 ms`. The two
  smoothness-affecting startup drops and `60.168 ms` DrawFrame gap coincide
  with `CpuProfiler::StartProfiling`, which occupies `54.393 ms`. This trace
  supports changing the prepared trajectory rather than the scheduler.
- Schema 21 preserves schema 20's extrema, range, direction-run order, and
  1,418 direction runs, but replaces cosine easing with the normalized integral
  of `sin(πt)^0.85`. Motion-energy coefficient of variation falls from
  `0.145322` to `0.138328`. On matched 2206×1224 numbered browser frames,
  coefficient of variation falls from `0.2375` to `0.231456` and normalized
  first difference improves from `0.060057` to `0.059548`; normalized second
  difference regresses from `0.090165` to `0.092518`. The geometric normalized
  jerk also regresses from `0.021199` to `0.025788`, so the change remains a
  disclosed perceptual candidate rather than a claimed universal improvement.
- The schema-21 face-ID-prepared visibility schedule exposes 268–323 of the 600
  retained faces and 125–149 contributing roots per frame. Its matched
  302-frame culled-versus-unculled audit has 184 strong mismatch pixels, all
  isolated one-pixel raster ties, with no connected missing-face region and no
  identical presentation interval. Its six-second live capture records 361
  callbacks, zero transform animations, and zero skipped prepared states.
- The schema-21 local Chrome 152 trace passes every captured gate. Its 477
  presented intervals have p50/p95/max `16.675/18.246/22.710 ms`, no gap
  exceeds `33.3 ms`, DrawFrame p95/max is `18.088/18.688 ms`, and no pipeline
  record affects smoothness. The worst presented interval contains `2.538 ms`
  of renderer-main work and `0.218 ms` maximum Paint. RasterTask is absent and
  remains unknown; this headless result does not replace headed visual judgment.
- Schema 22 replaces schema 21's fractional sine-power curve with the prepared
  adaptive smooth-sine integral. Runs through 24 frames keep cosine easing;
  the center-velocity reduction rises linearly to `0.6` at 54 frames. Against
  schema 21, the prepared motion-energy coefficient of variation falls from
  `0.138328` to `0.136518`, and the relative-to-box-mean below-tenth movement
  share falls from `8.46%` to `8.42%`. Geometric normalized jerk improves from
  `0.025788` to `0.021691`; normalized acceleration regresses from `0.101652`
  to `0.104776` and remains disclosed rather than hidden.
- On matched 2206×1224 numbered browser frames, schema 22 improves schema 21's
  VMAF Motion coefficient of variation from `0.231456` to `0.228972`, normalized
  first difference from `0.059548` to `0.057002`, and normalized second
  difference from `0.092518` to `0.085388`. The latter also improves on schema
  20's `0.090165`. These are trajectory regression signals, not a substitute
  for the user's headed perceptual judgment.
- The schema-22 face-ID-prepared visibility schedule exposes 265–323 of the 600
  retained faces and 122–147 contributing roots per frame with 2,666 sparse
  toggles. Its matched 302-frame culled-versus-unculled audit has 150 strong
  mismatch pixels, all isolated one-pixel raster ties; the largest connected
  strong component is one pixel, so no missing-face region was found. The
  synchronized presentation sequence has zero identical intervals. Its
  six-second live capture records 361 callbacks, zero transform animations,
  and zero skipped prepared states.
- The schema-22 local Chrome 152 trace passes every captured gate. Its 477
  presented intervals have p50/p95/max `16.672/17.547/18.187 ms`, no gap
  exceeds `33.3 ms`, DrawFrame p95/max is `17.498/17.822 ms`, and no pipeline
  record affects smoothness. The worst presented interval contains `2.479 ms`
  of renderer-main work and `0.278 ms` maximum Paint. RasterTask is absent and
  remains unknown; this headless result does not replace headed visual judgment.
- Schema 23 adjusts the adaptive smooth-sine ramp to begin at 27 frames, reach a
  maximum center reduction of `0.55` at 57 frames, and preserves all 1,418
  direction runs with no nonstationary run of twelve frames or less. Its
  prepared motion-energy coefficient of variation is `0.138567`; normalized
  acceleration/jerk are `0.103795/0.021305`; and the relative-to-box-mean
  below-tenth movement share is `8.646%`. These full-cycle values describe the
  prepared trajectory but do not establish live cadence.
- Schema 24 replaces direct per-frame face-color replacement with a prepared base
  color plus same-leaf `::after` next-color overlay opacity. Against schema 23 on
  matched 2206×1224 numbered browser frames, VMAF Motion coefficient of variation
  improves from `0.231438` to `0.231135`, normalized first/second differences from
  `0.057636/0.086993` to `0.056956/0.085310`, and 18-frame rolling maximum from
  `0.131940` to `0.122732`. Rolling values only locate clustered irregularity;
  they are not a smoothness target or a substitute for live cadence and headed
  perceptual judgment.
- Schema 25 splits the prepared matrix, opacity, and deduplicated face-color
  channels, reducing the playback packet to 15.3 MB. Its 30-second Chrome trace
  still records four smoothness-affecting pipeline drops and a `36.616 ms`
  DrawFrame maximum. That trace rejects schema 25 as performance-ready despite
  unchanged prepared motion.
- Schema 26 installs one prepared matrix template per box and publishes only the
  prepared z-scale scalar each frame. The playback packet is 2.9 MB and the full
  deterministic product is 3,345,317 bytes. All 302 captured 2206×1224 PNGs are
  byte-identical to schema 24. Its 30-second Chrome trace measures 1,677 presented
  intervals at p50/p95/max `16.662/18.023/23.774 ms`, DrawFrame p95/max
  `17.795/23.533 ms`, no gap above `33.3 ms`, and zero smoothness-affecting
  pipeline drops. The trace passes the captured cadence gates; headed perceptual
  acceptance remains separate.
- Rejected schema 27 used the CSS individual `scale` property to avoid custom-
  property substitution. It changed all 302 captured frames and was removed
  before performance qualification.
- Schema 45 published each contributing complete state through one of 42,507
  global geometry/material selectors. Browser heap isolation showed that the
  class replacement itself made Chrome's embedder heap rise from roughly
  `911 MB` to `1.24 GB` before periodic cleanup; replacing the mutation with a
  no-op kept it between roughly `12–19 MB`. This identified global selector
  invalidation and cleanup as the intermittent long-frame source.
- Rejected schema 46 preserved pixels and bounded heap by mutating prepared
  per-face `CSSStyleRule` declarations, but its 18-second trace presented only
  about every `50.8 ms`. `UpdateLayoutTree` reached `53.864 ms`; direct rule
  mutation invalidated the global style tree and was removed.
- Schema 47 keeps the three retained `<b>` leaves and same-leaf `::after`
  overlay. It publishes preformatted base color, next color, and opacity through
  face-local attributes consumed by static typed `attr()` declarations, while
  a non-inherited `--z` property owns the prepared matrix scalar. No frame class,
  stylesheet mutation, animation, runtime number formatting, or inherited
  color/opacity variable remains in the live presentation path.
- Against schema 45 at 2206×1224, 301 of 302 numbered frames are byte-identical.
  Frame 83 differs in 28 of 2,700,144 pixels (`0.000010`), with a maximum channel
  delta of one, from Chrome's typed-opacity rounding. The repeated schema-47
  frame is stable. This is qualified one-level raster tolerance, not an exact
  302-frame claim.
- The fresh schema-47 18-second Chrome 152 trace passes every captured cadence
  gate: 958 presented intervals at p50/p95/max `16.660/17.840/24.102 ms`, zero
  holds above `33.3 ms`, DrawFrame p95/max `17.741/19.215 ms`, zero
  smoothness-affecting pipeline drops, and a `0.293 ms` maximum captured frame
  callback. RasterTask is absent and remains unknown.
- The fresh 302-frame culled-versus-fully-published white-face audit records
  three strong mismatch pixels across 278,323,200 compared pixels; every strong
  component is one isolated pixel. All 301 presentation intervals have nonzero
  temporal delta. Its six-second live recording captures 361 callbacks, zero
  transform animations, and zero skipped prepared states.
- A separate 30.164-second Chrome heap sample covers 1,812 animation-frame
  callbacks. Embedder heap cycles between `6.229–15.376 MB` and ends at
  `8.985 MB`; JavaScript used heap settles near `8.959 MB`. The deterministic
  prepared product is 2,584,975 bytes with SHA-256
  `b422b526e6834e1b18ad937769bcfb06889babc5e8a95e13b1934652d1b02547`;
  playback plus motion CSS Brotli transfer is 836,675 bytes at quality 8.
- Schema 49 restores every retained face to product playback and publishes each
  box's complete prepared `matrix3d(...)` value directly. The fixed-viewport
  visibility banks remain diagnostic-only. A frozen 241-frame 2206×1224 X-orbit
  sweep at normal zoom keeps all 600 faces visible, reports no oversized sample,
  and bounds the largest absolute face rectangle coordinate at `3535.712 px`.
  The static `0 0 -30px` scene pivot prevents the former CSS perspective-plane
  crossing that produced billion-pixel rectangles and right-edge flashes.
- Two schema-49 all-face traces with the same-leaf color overlay reject that
  paint path: DrawFrame p95/max was `26.007/43.025 ms` in the alternating repeat,
  with two gaps above `40 ms`, ten above `33.3 ms`, and smoothness-affecting
  pipeline drops. The playback callback itself was not the dominant cost.
- Schema 50 removes the second face paint surface. Preparation resolves every
  interpolated sRGB color into one of 2,424 deduplicated final three-face tuples;
  runtime writes those preformatted colors directly and performs no color
  calculation, typed `attr()` evaluation, custom-property substitution, or
  pseudo-element painting. The playback packet is 10,270,226 bytes raw and
  761,396 bytes at Brotli quality 8.
- Against the isolated one-surface `color-mix()` diagnostic at presentation
  frame 220, the schema-50 prepared direct-color frame changes 7,907 of
  8,100,432 channel samples, all by exactly one level or less. Against schema
  49's double-raster overlay across all 302 frames, the worst mean absolute
  delta is `0.055619`; changed-pixel ratio is `0.008566` at that frame and the
  maximum edge delta is 38. This is a deliberate one-surface raster change,
  not an exact-pixel claim.
- Two independent schema-50 302-frame captures at 2206×1224 are byte-identical.
  The prepared trajectories retain 1,418 direction runs, no nonstationary run
  of twelve frames or less, and a stationary-transition ratio of `0.001080`.
  Captured VMAF Motion coefficient of variation is `0.225036`; normalized first
  and second differences are `0.056301/0.084040`. These remain motion signals,
  not perceptual proof.
- Two schema-50 product traces in Chrome 152 pass every captured cadence gate.
  DrawFrame p95/max is `17.566/17.904 ms` and `17.503/17.911 ms`; both runs have
  zero gaps above `33.3 ms` and zero smoothness-affecting pipeline drops. Worst
  steady renderer-main work is `2.858 ms` and `3.286 ms`. RasterTask remains
  absent and unknown; headed visual judgment remains separate.
- The uniform-`0.1` pre-repair 251-frame native and browser source sequences
  were independently deterministic, but their calibrated comparison was not
  aligned: worst mean absolute delta was `1.288004` at source frame 209 against
  the `1.125` threshold.
- The former uniform `0.1` side-depth crop visibly exposed black openings when
  tall towers rose. At source frame 125, the left opening contained 10,830
  connected pixels where native was non-black and the browser was black. A
  full-side face-ID pass attributed it primarily to box 32 front and box 18
  right, with smaller box 1 right and box 18 front contributions. Preparation
  now consumes `prepared-side-depth.json`: 19 measured side faces receive
  static depth scales between `0.15` and `0.28`, while all others remain `0.1`.
  The refreshed 251-frame source capture reduces the frame-125 left component
  to zero. Excluding the outer 30-pixel horizontal and two-pixel vertical
  viewport borders, the entire sequence contains 6,252 native-nonblack/browser-
  black pixels; its largest remaining component is 688 pixels at the top
  viewport edge. The new full 251-frame oracle is independently deterministic
  and aligned under the existing calibration: worst frame 155 has mean absolute
  delta `1.111180` and changed-pixel ratio `0.044644`, against thresholds
  `1.125` and `0.05`. This is calibrated tolerance, not exact pixel identity.
- Two independent repaired 302-frame presentation captures at 2206×1224 are
  byte-identical. The full normal-zoom X sweep samples 181 positions from
  -180° through 180°, keeps all 600 faces, reports no oversized face, and has a
  `3535.051 px` maximum absolute face bound. The deterministic prepared product
  is 10,524,351 bytes with SHA-256
  `fea44989171c0205b894516bda365f6def16dee623b28815a8f06da9552cbc92`.
- The fresh post-repair Chrome 152 product trace passes every captured cadence
  gate. DrawFrame p95/max is `17.524/18.001 ms`; presented p95/max is
  `17.965/24.302 ms`; there are no gaps above `33.3 ms` or `40 ms` and no
  smoothness-affecting pipeline drops. RasterTask remains absent and unknown.
- The supplied headed trace `Trace-20260902T131833.json.gz` rejects the
  all-published-face product as smooth. After the trace-start marker, two
  smoothness-affecting `STATE_DROPPED (BACKFILL)` records overlap one
  `33.160 ms` DrawFrame gap at `+3835.970/+3852.650 ms`. That interval contains
  only `2.848 ms` of renderer-main work and `0.861 ms` total Paint, while the
  global GPU role is busy for `13.607 ms`. It therefore does not support a
  JavaScript scheduling explanation. RasterTask and screenshots are absent, so
  raster attribution remains unknown.
- The schema-52 product applied the earlier prepared opacity schedule.
  Against fully published captures, all 301 normal 1280×720 frames and all 301
  wide 2473×1236 frames are byte-identical: zero changed frames and zero changed
  pixels. This comparison includes CSS 3D sorting effects; it is not only a
  face-ID census. Exact source seeks restore all 200 roots and 600 faces, and a
  browser round-trip smoke proves that presentation seek restores 10 statically
  hidden roots, 30 statically hidden faces, and the frame-zero opacity row.
- In matched 7.96-second steady headless traces, the earlier all-face product
  recorded 113,644 Paint events and `357.642 ms` total Paint. Schema 52 records
  96,247 events and `302.098 ms`, reductions of `15.31%` and `15.53%`.
  Global GPU-role busy time changes from `4031.446 ms` to `3908.387 ms`
  (`3.05%` lower). The schema-52 trace has DrawFrame p95/max
  `17.479/17.711 ms`, presented p95/max `17.686/24.739 ms`, zero gaps above
  `33.3 ms`, and zero smoothness-affecting pipeline drops. RasterTask remains
  absent and unknown; a new headed trace is still required to confirm the
  intermittent user-environment drop is gone.
- The schema-53 display-carrier candidate preserves the exact schema-52 prepared visibility rows
  but changes their runtime carrier from `opacity: 0` to `display: none`.
  Transparent 3D faces continued to own compositor layers; hidden display faces
  do not. Across all 301 normal 1280×720 frames and all 301 wide 2473×1236
  frames, before/after PNG bytes are identical. A full-loop Chrome LayerTree
  census now follows the prepared 490–538 visible-face range: total compositor
  layers vary from 500 to 548 instead of remaining at 580, removing 32–80
  invisible layers per state. A duration-matched normal-speed trace records zero
  pipeline drops, presented p95/max `17.514/24.798 ms`, DrawFrame p95/max
  `17.448/19.408 ms`, and lower mean GPU-role (`-3.08%`), Paint (`-4.48%`),
  Commit (`-7.83%`), and animation-callback (`-17.25%`) work than schema 52.
  It also introduces `0.095 ms` mean Layout work per frame. A separate 4x CPU
  stress run is not an acceptance run: it records one pipeline-drop marker and
  one `20.825 ms` DrawFrame interval with `3.712 ms` main-thread GC occupancy.
  The six-file prepared closure is deterministic at 10,869,748 bytes with
  SHA-256 `33d286dbcd3df8038c4037c6a57418380b3a27d9b90b0cba112d3aebc9176aae`.
  RasterTask remains absent and unknown; perceptual smoothness still requires a
  fresh headed user trace.
- The schema-54 product keeps the same rows and layer reduction but replaces the
  schema-53 `display` carrier with direct `visibility` assignments. Across the
  complete 301-frame normal and 301-frame wide sequences, schema 54 is byte-for-byte
  identical to schema 53. Its full-loop LayerTree range is 500–548 total layers
  with a 522.309 mean, versus the schema-52 fixed 580. Unlike schema 53, both
  matched normal-speed schema-54 traces contain no Layout slices. Both traces
  pass all strict gates with zero pipeline drops: DrawFrame p95/max is
  `17.397/17.667 ms` and `17.427/18.626 ms`; presented p95/max is
  `17.486/24.617 ms` and `17.524/23.517 ms`. Against schema 52, the first matched
  run lowers mean renderer-main work by `4.04%`, Layerize by `3.79%`, Commit by
  `6.29%`, and animation-callback work by `18.09%`. The separate 4x CPU stress
  run still rejects, with four pipeline-drop markers and a `29.573 ms` maximum
  DrawFrame interval; it is not normal-speed acceptance evidence. The six-file
  prepared closure is deterministic at 10,869,766 bytes with SHA-256
  `8c8e85804940e249eb64b37262c338294a9334d146637cdaf6d586c456535ac5`.
  RasterTask remains absent and unknown, so a fresh headed user trace remains the
  perceptual acceptance gate.
- The refreshed full 251-frame native/browser oracle is deterministic on both
  sides and remains aligned. The worst calibrated frame is 155 at mean absolute
  delta `1.111180` and changed-pixel ratio `0.044644`, inside the existing
  `1.125/0.05` thresholds. The deterministic prepared closure contains six files,
  is 10,541,755 bytes, and has SHA-256
  `a9dc7385bd378cfec7f98af1130c365e988bbbb70b777c8013934400f397d996`.
- The shipped route starts prepared playback automatically with the fixed source
  camera. Pointer-drag orbit, wheel zoom, the diagnostic orbit state, and the
  orbit-only scene pivot are not part of the product interaction surface.
- The user's schema-54 trace, `Trace-20260902T171524.json.gz`, contains two
  steady `33.361 ms` presentation holds. One is adapter-side: a normal display
  callback arrived `15.436 ms` after the previous publication but was rejected
  because the accumulated deadline had drifted more than the one-quarter-frame
  early tolerance. The scheduler now rescues an otherwise-early callback when
  it is at least three-quarters of a frame after the last publication, publishes
  exactly one adjacent state, and re-phases the deadline. It still rejects the
  observed `3.159 ms` sub-vsync duplicate and retains accumulated deadlines for
  high-refresh callback streams. The other hold received no animation-frame
  callback, so JavaScript cadence cannot repair it. The trace's 25 steady
  `RasterTask` events are global/nonexclusive, total `1.568 ms`, peak at
  `0.159 ms`, and do not overlap the worst hold; they do not explain that
  browser-side missed delivery. This is a trace-shaped scheduler correction,
  not a claim that a fresh headed run has no remaining hold.
- The schema-56 product replaces the earlier face-level carrier with the prepared
  viewport-independent whole-box schedule. Root suppression was rejected because
  removing a root changes Chrome's CSS 3D sorting: the largest attributed failure
  was a 4,477-pixel right-edge component at presentation frame 245. Direct leaf
  visibility had the same sorting problem until full-frame attribution found the
  eight always-visible dependency boxes listed in the runtime boundary. The final
  1280x720 full-loop LayerTree census ranges from 508 to 571 total layers and from
  503 to 566 drawing layers. Those counts equal the 498--561 visible faces plus
  ten and five layers respectively, proving that 39--102 of the fully published
  610 compositor layers are absent rather than merely transparent.
- The schema-56 sparse-publication audit is pixel-exact for all 301 transitions at
  1280x720 and 2560x1224: it changes zero pixel bytes against full color and
  transform publication while avoiding 52,351 root-transform writes and 61,358
  leaf-color writes in each run. Full-frame checks repair every attributed large
  sorting failure; the complete 2.1007-ratio loop has no material mismatch. The
  broad independent-page comparator still reports small raster-edge components
  on some normal-ratio frames, but a same-state recapture reduced one reported
  18-pixel component to five pixels and no single hidden box removed it. Those
  tiny cross-page deltas are treated as nondeterministic raster noise, not as an
  exact-parity pass.
- The final normal-speed Chrome 152 trace passes all captured gates: presented
  p95/max is `18.561/25.173 ms`, DrawFrame p95/max is `18.476/18.822 ms`, and
  there are zero presentation gaps above `33.3 ms` and zero pipeline drops. The
  first 14-profile cadence sweep passed 12 profiles; phone 430x932 DPR 2 and
  square 1024x1024 DPR 1 each recorded one isolated presentation hold while
  renderer-main occupancy stayed below 10 ms and pipeline drops remained zero.
  Immediate repeats of both profiles passed with maxima of `23.431 ms` and
  `22.993 ms`. A subsequent complete 14-profile sweep passes every profile with
  zero doubled holds and zero pipeline drops. Its exact-stage-wide and ultrawide
  captures each contain two compensated presentation timestamp bunches; their
  DrawFrame maxima remain `19.147 ms` and `19.660 ms`, respectively. A 4x CPU
  stress trace is diagnostic, not acceptance evidence: it has no presentation
  hold or pipeline drop but rejects the `2 ms` paint ceiling with a `2.825 ms`
  maximum. RasterTask remains absent and unknown.
- The deterministic six-file schema-56 prepared closure is 10,869,518 bytes with
  SHA-256 `b23b08446471afc8c90e25636865bfa974fe5d5acf1f17caf075ba7cf0b6a58c`.
- Schema 57 replaces the 76,051 complete wire `matrix3d(...)` strings with the
  published CSSGraphics prepared-transform component-stream pattern and the
  published Gravity Well signed-varint component transport. Cityflow needs one
  affine template and one fixed-point height-delta stream per box because an
  exhaustive preparation check proves that only affine component 8 changes
  within each box. Preparation expands all 76,051 packed transforms and rejects
  the packet unless every reconstructed string is byte-exact. The generated
  playback payload contains no `matrix3d(` text; it is 1,417,370 raw bytes,
  677,941 gzip-9 bytes, and 660,798 Brotli-quality-8 bytes. The packed transform
  streams themselves contain 269,301 bytes. The deterministic six-file closure
  is 1,677,507 bytes with SHA-256
  `55b268c582cdcb69a0b0ec834c92baf0fe8c036ad5d99af342c79bb479b8351b`.
  A fresh eight-keyframe 1280x720 comparison against the accepted schema-56
  sequence is pixel-exact at zero tolerance. A fresh 302-state normal and wide
  raster audit changes zero pixel bytes, with zero skipped prepared states. A
  fresh ten-second Chrome 152 trace passes every captured performance gate:
  presented p95/max is `17.493/18.503 ms`, DrawFrame p95/max is
  `17.395/17.692 ms`, and there are zero gaps above `33.3 ms` and zero
  smoothness-affecting pipeline drops. RasterTask remains absent and unknown.
- Schema 58 adds an independent 100-root/300-leaf mobile prepared bank while
  preserving the 200-root/600-leaf desktop bank. Selection follows the
  published CSSGraphics profile pattern and happens once before bank fetch and
  mount; the browser requests only the selected model, playback, and CSS. Both
  payloads retain the schema-57 packed transform transport and contain no
  `matrix3d(` text. Desktop playback is 1,417,410 raw / 660,745 Brotli-quality-8
  bytes; mobile is 770,522 raw / 342,005 Brotli-quality-8 bytes. The ten-file
  prepared closure is deterministic at 2,580,217 bytes with SHA-256
  `7d8142a3767801a73e2d3692019d371eb11e5108ec0d5364b19317e26b5f49b2`.
  Eight desktop keyframes remain pixel-exact against the accepted schema-57
  sequence. The full 251-frame mobile native/browser sequence passes with frame
  159 worst at mean delta `0.621742` and changed-pixel ratio `0.0141`. In the
  steady portion of a ten-second 390×844 Chrome 152 trace, presented-frame
  p95/max is `17.464/23.638 ms`, DrawFrame p95/max is `17.491/17.673 ms`, and
  there are zero gaps above `33.3 ms` and zero pipeline-drop markers. RasterTask
  is absent from the steady selection and remains unknown there.
