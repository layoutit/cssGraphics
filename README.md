# cssGraphics

cssGraphics packages animated and interactive 3D models as real HTML and CSS,
without a WebGL or canvas renderer. Powered by the
[PolyCSS](https://github.com/LayoutitStudio/polycss) engine.

<p align="center">
  <img width="256" height="256" alt="Colorful prepared PolyCSS pipes growing across the viewport" src="site/readme/pipes.gif" />
  <img width="256" height="256" alt="A red cube at 30 degrees yaw and 20 degrees downward pitch morphing into a sphere, twisting, and returning to a cube" src="site/readme/cube-to-sphere.gif" />
  <img width="256" height="256" alt="An animated prepared sphere completing its full morph and spin loop" src="site/readme/animated-morph-sphere.gif" />
</p>

## Run locally

```sh
pnpm install
pnpm dev
```

## Adapters

### 3D Pipes

[`src/adapters/3dpipes`](src/adapters/3dpipes) is an original generative
PolyCSS scene inspired by XScreenSaver `pipes.c` and Windows 3D Pipes. It uses
prepared connected tube meshes, lighting, and playback with stable retained
DOM.

```sh
pnpm install
pnpm build:3dpipes:full
pnpm dev:3dpipes
```

### Flower Box

[`src/adapters/flowerbox`](src/adapters/flowerbox) is an independent PolyCSS
reconstruction of the classic Flower Box. Its rounded prepared cycle uses
1,200 stable retained triangle leaves, prepared Morph transforms, and a
hash-bound q60 space-texel lighting atlas.

```sh
pnpm prepare:flowerbox:artifact
pnpm build:flowerbox
pnpm dev:flowerbox
```

Microsoft source, binaries, captures, and oracle packets are not included.

### Gears

[`src/adapters/gears`](src/adapters/gears) is a source-backed PolyCSS port of
XScreenSaver Gears. Twenty-four prepared three-gear assemblies enter from
distinct non-crossing viewport edges, lock, rotate for 15 seconds, and leave
before a shuffled, non-repeating prepared assembly takes over. The browser
retains three gear roots and does not build geometry, lighting, ratios, phase,
camera state, or DOM at runtime. A prepared portrait profile is selected below
600px. Gzip-prepared scene and snapshot files load selected-first, then fill a
four-request cached background queue for seamless later transitions.

```sh
pnpm prepare:gears:artifact
pnpm build:gears
pnpm dev:gears
```

The pinned XScreenSaver checkout, native binaries, captures, and generated
browser assets are not committed.

### Menger

[`src/adapters/menger`](src/adapters/menger) is a source-backed PolyCSS port of
XScreenSaver Menger. Its fixed depth-3 slice preserves the seeded recursive
cell and face census, palette rows, rotator states, 30 ms cadence, and prepared
camera. Prepare time merges 18,048 source faces into 84 retained coplanar plane
bundles with exact source-face coverage, then byte-deduplicates prepared moving
lighting into one Q83 AVIF and a forward exact delta address schedule. Runtime
retains only camera/scene roots plus 84 direct `<b>` leaves and follows a 1,536
state, 46.08 second prepare-time C2 forward cycle. Prepared rotation publishes
every 30 ms and default held lighting every 60 ms, with no runtime geometry,
recursion, merging, lighting math, address comparison, rotation calculation,
camera calculation, or DOM construction.

```sh
pnpm prepare:menger:artifact
pnpm build:menger
pnpm dev:menger
```

### Maze

[`src/adapters/maze`](src/adapters/maze) is a source-backed PolyCSS port of
XScreenSaver Maze3D. Preparation selects 24 low-rotation seeded
mazes and emits gzip-bound retained snapshots. The browser loads one prepared
maze at a time and publishes prepared camera, wall-height, and visibility-delta
rows over 171 stable polygon leaves; it performs no maze generation, route
solving, geometry construction, camera math, visibility calculation, or DOM
growth.
The common surface and wall atlas pages are distributed once across all 24
snapshots.

```sh
pnpm prepare:maze:artifact
pnpm build:maze
pnpm dev:maze
```

The prepared product archive is hash-bound and includes the three pinned
XScreenSaver textures under the upstream copyright and permission notice.
The source checkout, native helpers, captures, and traces remain local and
ignored.

## FrameSleuth

FrameSleuth turns a Chrome DevTools `.json` or `.json.gz` performance trace
into an evidence-backed frame report. It selects the active renderer, finds the
slowest compositor DrawFrame intervals, attributes their renderer/compositor/raster/
GPU work, correlates timer-to-rAF delay and pipeline drops, and distinguishes
nested event totals from non-overlapping trace-slice occupancy. Missing trace
categories are reported as unavailable rather than zero. Renderer-main garbage
collection, V8 CPU-profile samples, and captured screenshots are included when
present. CPU samples expose JavaScript self time hidden inside broad task and
microtask envelopes.

FrameSleuth Tracer creates comparable evidence without the old warm benchmark
seam. By default it launches the installed Chrome headlessly without opening a
window, begins tracing on `about:blank`, performs a cold navigation, and leaves
the page untouched for eight seconds. It writes the raw gzip trace, full-run and
post-startup FrameSleuth reports, and matching frame-time SVG line charts. No network-idle/readiness wait, seek, step, pause, or
application-specific debug API participates in the capture.

```sh
pnpm framesleuth:trace -- http://127.0.0.1:5173/gravitywell/
pnpm framesleuth:trace -- https://css.graphics/gravitywell/ --duration-ms 10000
pnpm framesleuth:trace -- http://127.0.0.1:5173/gravitywell/ --screenshots
pnpm framesleuth -- ~/Downloads/Trace.json.gz
pnpm framesleuth -- before.json.gz --compare after.json.gz
pnpm framesleuth -- Trace.json.gz --question "what work did we do on the worst frame?"
pnpm framesleuth -- Trace.json.gz --format json --output analysis.json
pnpm framesleuth -- Trace.json.gz --rank 2 --screenshots /tmp/frame-evidence
```

Use `--headed` only when visible Chrome and possible focus changes are explicitly
wanted. It is closer to a manually recorded interactive trace, but still uses a
fresh browser process rather than the user's existing tabs/profile. Screenshot
events are opt-in because they add recording overhead. Headless captures are
useful reproducible diagnostics, but they are not proof of physical-display
presentation and can miss behavior that depends on the interactive compositor.

Use `--frame <index>`, `--rank <slowest-rank>`, or `--around-ms <time>` to
select one DrawFrame interval; use `--url <substring>` when a trace contains
multiple active renderer pages. The JSON form uses the versioned
`cssgraphics-frame-sleuth@1` schema so an agent can answer follow-up questions
without reparsing the trace.

Question routing covers worst-frame work, scheduler smoothness, lighting and
rendering cost, dropped-frame/artifact markers, JavaScript functions, garbage
collection, global GPU correlation, long tasks, missing evidence, screenshots,
and before/after regressions.

`DrawFrame` spacing is compositor evidence, not proof of physical display
presentation. GPU/browser process activity is global to the trace and is never
claimed as page-exclusive work. FrameSleuth lists missing evidence channels and
keeps inclusive nested duration separate from interval-unioned occupancy.



## License

The cssGraphics core and package are [MIT licensed](LICENSE). Scoped adapters
and third-party models retain their own terms and attribution. In particular,
the ElectroPaint adapter is not MIT licensed; see its local license and notice.
Catalog model attribution is listed in
[`site/public/catalog.json`](site/public/catalog.json).
