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

Requires Node.js 22.12+ and pnpm 10.33.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Choose an asset, drag to rotate it, or press `/` to search.

```sh
pnpm typecheck
pnpm build
```

The repository also includes optional local Super Mario 64 preparation. It
requires a user-supplied ROM and does not distribute Nintendo game data.

## License

cssGraphics is [MIT licensed](LICENSE). Distributed assets retain the source and
license declared in [`site/public/catalog.json`](site/public/catalog.json).
