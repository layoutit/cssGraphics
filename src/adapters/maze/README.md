# cssMaze

A source-backed retained-DOM PolyCSS port of the pinned XScreenSaver
`maze3d` implementation. Preparation ranks 4096 deterministic candidate seeds by
turning-frame ratio and then absolute quarter-turn count, and emits the 24
lowest-rotation eligible mazes. Refresh selects one prepared entry. There is no
product scene-change control.

The css.graphics shell is mounted at `/maze/`. The product contains one stable
world root, wall root, surface root, and 171 retained polygon leaves. Startup
loads only the chosen gzip scene and snapshot. The public scene omits geometry;
full mesh data remains in ignored prepare-only output. Runtime publishes
prepared camera, wall-height, and signed visibility-delta rows. It does not
generate or solve mazes, score rotation, construct geometry, rasterize textures,
calculate camera or visibility state, scan every wall during normal playback,
grow the DOM, or schedule animation-frame playback.

## Run the prepared product

From the repository root:

```sh
pnpm install
pnpm prepare:maze:artifact
pnpm build:maze
pnpm dev:maze
```

Open <http://127.0.0.1:5173/>. Use `?scene=default-maze` to pin the
top-ranked entry for deterministic capture. `window.__cssMazeDebug` exposes
prepared state, pause/resume/seek/step controls, retained-DOM assertions, and
runtime-work counters.

## Reproduce from source

From the repository root, place the pinned XScreenSaver checkout at
`.local/xscreensaver` or set `CSSMAZE_SOURCE_ROOT`, then run:

```sh
CSSMAZE_SOURCE_ROOT=/absolute/path/to/xscreensaver pnpm prepare:maze:source
pnpm test:maze
pnpm test:maze:assets
pnpm verify:maze:bank
pnpm build:maze
pnpm test:maze:browser
```

`pnpm build:maze:deploy && pnpm test:maze:deploy` verifies the `/maze/`
production layout locally. Repository-wide `build:deploy` fetches and verifies
the prepared bank before building the route.

## Scope and evidence

- Pinned authority: `Zygo/xscreensaver@906693799e4fb7581436590cf84ecb2d3c9186ba`.
- First slice: 24 prepared 12×12 logical mazes with source Prim topology,
  start/finish placement, walls, merged floor and ceiling, and one complete
  prepared camera traversal per entry.
- The source floor and ceiling remain one retained quad each. Raster atlas leaf
  sizing preserves their full prepared dimensions instead of applying PolyCSS's
  canonical 64px cap.
- Prepared near-plane admission rejects walls wholly behind the source camera;
  crossing walls remain for Chromium perspective clipping. The uniform camera
  scale, eye offset, and 20 ms transform transition are prepared browser
  accommodations, not pixel-parity evidence.
- The local native helper and same-seed captures are comparison evidence, not a
  qualified full XScreenSaver binary visual oracle.
- Rats, inverters, overlays, acid modes, floating images, and user textures are
  outside this slice.

This is not an exact Windows 95 port and does not claim native pixel parity.
The separately published prepared bank contains the three byte-verified
XScreenSaver textures under the upstream copyright and permission notice.
The source checkout, native binaries, generated bank, captures, traces, and
reports remain ignored. See
[`notes/provenance-bible.md`](notes/provenance-bible.md).

## XScreenSaver notice

Copyright 1991-2025 Jamie Zawinski <jwz@jwz.org>

Permission to use, copy, modify, distribute, and sell this software and its
documentation for any purpose is hereby granted without fee, provided that the
above copyright notice appear in all copies and that both that copyright notice
and this permission notice appear in supporting documentation. No
representations are made about the suitability of this software for any
purpose. It is provided "as is" without express or implied warranty.
