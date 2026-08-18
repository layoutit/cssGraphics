# css.graphics/platonic-folding

Source-backed XScreenSaver Platonic Folding rendered as 50 retained PolyCSS
Morph face roots. Preparation bakes both responsive banks, every hinge pose,
source-style face colors, and quantized lighting into one raster atlas.

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

Runtime owns only the prepared playback clock, sparse Morph publication, and
responsive perspective. It performs no geometry construction, atlas
rasterization, topology rebuilding, or DOM growth.

The oracle compiles the pinned XScreenSaver source into a headless CGL capture,
captures the same deterministic frame schedule from the browser, proves exact
native and browser A/A stability, and compares all five solids. The qualified
result is a bounded source-faithful approximation, not visual parity or pixel
identity; the remaining delta is confined to prepared atlas filtering and
64-state per-face color quantization.
