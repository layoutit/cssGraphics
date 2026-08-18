# css.graphics/platonic-folding

Source-backed XScreenSaver Platonic Folding rendered as 50 retained PolyCSS
Morph face roots. Preparation bakes one shared `static-prepared` Morph package,
both responsive sparse playback banks, every hinge pose, source-style face
colors, and quantized lighting into one raster atlas.

```sh
export CSSPLATONICFOLDING_SOURCE_ROOT=/path/to/xscreensaver
pnpm prepare:platonic-folding
pnpm dev:platonic-folding
pnpm test:platonic-folding
pnpm prepare:platonic-folding:check
pnpm test:platonic-folding:browser
pnpm build:platonic-folding
pnpm oracle:platonic-folding
```

Local preparation verifies the exact checkout when
`CSSPLATONICFOLDING_SOURCE_ROOT` is set. Release builds fetch the same two files
from the pinned GitHub revision and verify their locked SHA-256 identities
before producing anything.

Runtime owns only the prepared playback clock, source-ordered sparse DOM
publication through `createPolyMorphPreparedDomTarget`, and responsive
perspective. Normal playback consumes preformatted transform and atlas-row
selections directly. It performs no prepared-state materialization, full-state
diff, matrix formatting, id lookup, geometry construction, atlas rasterization,
topology rebuilding, DOM growth, or full retained-graph scan.

The oracle compiles the pinned XScreenSaver source into a headless CGL capture,
captures the same deterministic frame schedule from the browser, proves exact
native and browser A/A stability, and compares all five solids. The qualified
result is a bounded source-faithful approximation, not visual parity or pixel
identity; the remaining delta is confined to prepared atlas filtering and
64-state per-face color quantization.
