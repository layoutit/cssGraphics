# cssGraphics repository contract

## Product boundaries

- `site/` is the canonical css.graphics public product and the asset
  distribution layer for PolyCSS. `/` opens the asset browser. Its only
  deep-link selector is one normalized `?asset=<id>` value, and
  `site/public/catalog.json` is the public distribution contract.
- `app/` is a separate local consumer for ignored prepared model packages. It
  is not the public css.graphics route. Its package selector is one normalized
  `?model=<id>` value under the local `/cssgraphics/` package base.
- The npm library and CLI load, validate, install, and mount prepared packages;
  they do not redefine the public distribution catalog.
- Rendering is exclusively PolyCSS/DOM/CSS. Do not add canvas, WebGL, WebGPU,
  WASM, emulation, raster fallback, or a hidden oracle renderer to either
  product.
- Keep shape, net, joint, vertex, face, material, animation-channel, grabber,
  cursor, and texture identity stable across ticks. A deliberate package
  change may perform one bounded teardown and mount; no old leaf, listener,
  pointer capture, or ticking client may survive it.
- Every Mario model leaf uses `backface-visibility: visible`; source cull and
  winding state remain diagnostic metadata only.

## Source and data boundary

- Never download, copy, track, publish, or deploy a Nintendo ROM or
  Nintendo-derived model, geometry, collision, texture, animation, audio,
  dialogue, font, screenshot, capture, or prepared bundle.
- Cleared public distribution assets belong under `site/public/` and must be
  declared with source and license metadata in the distribution catalog.
- User inputs, upstream checkouts, reference builds, traces, captures, and
  generated output belong only under ignored `.local/`, `build/`, or
  `bench/results/` roots.
- Synthetic fixtures are test-only and must live under
  `test/fixtures/synthetic/` with explicit provenance.
- Treat `n64decomp/sm64` as the regular-head runtime authority. `sm64js` is a
  bounded ignored dynlist/parser/neutral-render reference only; never expose it
  as a cssGraphics route or bundle it into either product.
- Castle Grounds, normal Mario gameplay, file select, the opening logo, and the
  dizzy/game-over head remain outside the local adapter scope.

## Workflow

- Package manager: pnpm 10.33.0. Module format: ESM. Product source: strict
  TypeScript with framework-free Vite.
- `../polycss` is the renderer API authority; `@layoutit/polycss` from the
  lockfile is the clean-clone dependency.
- `../cssQuake` is read-only architectural precedent; do not copy its GPL
  source or game data.
- `pnpm build` builds the distribution site and npm package. `pnpm build:app`
  is an explicit local-consumer build and must not prepare source data.
- Do not run expensive preparation or generation without explicit approval.
- Stage or commit only when explicitly requested. Pushing, remotes, hosting,
  publication, and deployment require separate immediate authorization.
- Use a Burnlist only when the user asks for one.
