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

The product uses the source-supported `count` option at 200 boxes in one
prepared bank. The source default remains 800, and the source's
`1.8 / sqrt(count)` box scale is preserved for the selected count.

The deterministic prepared seed is product authoring input because the native
screen saver normally seeds `ya_random` from process and wall-clock state. The
source equations, random stream, smooth color-map construction, draw cadence,
lighting, and camera remain authoritative.

## Runtime boundary

Preparation writes one static Morph package plus source-cadence typed transform
and color-index tables. Every box retains three solid quad leaves.
Because CSS perspective has no OpenGL far plane, preparation derives the side
face cutoff from the exact source model-view sequence and clips the source
`bottom = 5` faces conservatively at eye-space `z = -50`. Each prepared box
matrix carries real initial geometry rather than adapter metadata. Runtime
derives the exact static source-light factors from that matrix, then applies
only changed prepared transform indices and palette classes. Scheduling follows
the merged DOMFORMAT `polycss-playback@0` precedent: a timer waits for the next
deadline, one paint-aligned callback publishes the due state, and `elapsed`
catch-up collapses missed source ticks. There is no runtime geometry,
rasterization, topology rebuilding, or DOM growth.

## Proof state

- Source-state oracle: product ticks 0, 73, and 251 match the pinned
  C implementation within explicit float tolerance.
- Browser retained-DOM smoke: desktop and mobile viewports mount the same
  expected leaf census, keep DOM identity stable, publish prepared transforms,
  and construct/redraw no atlases.
- Native visual capture: the headless macOS CGL harness executes the pinned
  `cityflow.c` source directly; two 48-frame runs are byte-identical.
- Browser visual parity: 48 source-cadence frames pass the calibrated native /
  retained-DOM comparison at mean delta `<= 1`, changed-pixel ratio `<= 0.05`,
  and channel threshold `2`. The worst observed mean delta is `0.541659`; the
  residual is confined to polygon-edge rasterization.
- FrameSleuth performance on the untouched 1280 x 720 product route records a
  `19.728 ms` DrawFrame p50 and `34.213 ms` p95 against the source's `20 ms`
  cadence. The only scheduled work is the DOMFORMAT-precedented timer /
  paint-aligned callback; publications use prepared data and the retained graph
  remains 200 roots / 600 leaves.
