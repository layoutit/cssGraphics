# cssGraphics

cssGraphics packages animated and interactive 3D models as real HTML and CSS,
without a WebGL or canvas renderer. Powered by the
[PolyCSS](https://github.com/LayoutitStudio/polycss) engine.

<p align="center">
  <img width="256" height="256" alt="Mario's nose being grabbed and released in the local interactive runtime" src="site/readme/mario-grab.gif" />
  <img width="256" height="256" alt="A red cube at 30 degrees yaw and 20 degrees downward pitch morphing into a sphere, twisting, and returning to a cube" src="site/readme/cube-to-sphere.gif" />
  <img width="256" height="256" alt="An animated prepared sphere completing its full morph and spin loop" src="site/readme/animated-morph-sphere.gif" />
</p>

## Run locally

```sh
pnpm install
pnpm dev
```

To prepare Mario, place your own US `.z64` ROM under `.local/`:

```sh
pnpm prepare:super-mario-64 -- --rom .local/baserom.us.z64
```

Nintendo game data is not included.

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

## License

cssGraphics source code is [MIT licensed](LICENSE). Third-party models retain
their original licenses and attribution, listed in
[`site/public/catalog.json`](site/public/catalog.json).
