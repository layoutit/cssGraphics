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
bundles with exact source-face coverage; runtime retains one model root and
three axis roots and performs no geometry, recursion, merging, color,
rotation, camera, or DOM construction.

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

```sh
pnpm prepare:maze:artifact
pnpm build:maze
pnpm dev:maze
```

The prepared product archive is hash-bound and includes the three pinned
XScreenSaver textures under the upstream copyright and permission notice.
The source checkout, native helpers, captures, and traces remain local and
ignored.

## License

cssGraphics source code is [MIT licensed](LICENSE). Third-party models retain
their original licenses and attribution, listed in
[`site/public/catalog.json`](site/public/catalog.json).
