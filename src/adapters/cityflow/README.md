# css.graphics/cityflow

Source-backed XScreenSaver Cityflow rendered as retained PolyCSS Morph boxes.
The single product bank uses the source's own `count` control at 200 boxes;
the XScreenSaver default is 800. Every box retains the source-emitted top,
front, and right faces.

```bash
export CSSCITYFLOW_SOURCE_ROOT=/path/to/xscreensaver
pnpm prepare:cityflow
pnpm dev:cityflow
pnpm test:cityflow
pnpm prepare:cityflow:check
pnpm test:cityflow:browser
pnpm oracle:cityflow:native
pnpm oracle:cityflow:visual
pnpm build:cityflow
```

Preparation owns the seeded source initialization, smooth color map, box
geometry, source-light factors, OpenGL far-plane cutoff, Morph packages, and
source-cadence transform/color tables. Duplicate transforms are removed during
preparation. Runtime mounts one retained graph, derives its static face-light
factors from the prepared transforms, and sparsely publishes changed prepared
indices with the merged DOMFORMAT timer/rAF `elapsed` scheduler. Runtime does
no geometry calculation, atlas rasterization, topology rebuilding, or DOM
growth.
