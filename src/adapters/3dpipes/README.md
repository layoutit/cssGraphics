# 3D Pipes

An original generative PolyCSS scene inspired by XScreenSaver `pipes.c` and
Windows 3D Pipes. Connected tubes are retained HTML/CSS geometry rendered by
[PolyCSS](https://github.com/LayoutitStudio/polycss), without Canvas, WebGL, or
WebGPU. This is not a behavioral or visual port of either work.

From the repository root:

```sh
pnpm install
pnpm build:3dpipes:full
pnpm dev:3dpipes
```

Open <http://127.0.0.1:5173/>.

Preparation authors 64 deterministic desktop and mobile clips. The browser
mounts two fixed seven-root banks and replays prepared transforms, visibility,
materials, and lighting through stable DOM. It does not generate paths,
geometry, lighting, or DOM at runtime.

Generated clips are content-addressed and loaded through a four-clip horizon.
They remain under ignored `build/generated/`; `pnpm prepare:3dpipes`
regenerates and verifies them.

Material provenance and redistribution boundaries are recorded in
[`notes/provenance-bible.md`](notes/provenance-bible.md). The adapter is covered
by the repository's [MIT license](../../../LICENSE); Microsoft and XScreenSaver
source, executables, and assets are not included.
