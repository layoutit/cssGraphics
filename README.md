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

### Gears

[`src/adapters/gears`](src/adapters/gears) is a source-backed PolyCSS port of
XScreenSaver Gears. Twenty-four prepared three-gear assemblies enter from
distinct non-crossing viewport edges, lock, rotate for 15 seconds, and leave
before a shuffled, non-repeating prepared assembly takes over. The browser
retains three gear roots and does not build geometry, lighting, ratios, phase,
camera state, or DOM at runtime. A prepared portrait profile is selected below
600px.

```sh
pnpm prepare:gears:artifact
pnpm build:gears
pnpm dev:gears
```

The pinned XScreenSaver checkout, native binaries, captures, and generated
browser assets are not committed.

## License

cssGraphics source code is [MIT licensed](LICENSE). Third-party models retain
their original licenses and attribution, listed in
[`site/public/catalog.json`](site/public/catalog.json).
