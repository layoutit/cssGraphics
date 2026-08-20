# Flocks PolyCSS adapter

Source-backed Really Slick Screensavers Flocks rendered as stable retained DOM with PolyCSS.

## Source contract

- Upstream revision: `a419fc4ecf4b9b19526448bf9f5dfc435e24ca4c`
- Source path: `src/flocks/flocks.cpp`
- Source SHA-256: `0db819da1d123ad4ae2cf5f53bec278e64b2f65ecabe617a843197446c1813d6`
- Adapter license: GPL-2.0-or-later
- Source default: 4 leaders + 1000 followers
- Geometry-one topology: GLU sphere radius 2.5, 3 slices, 2 stacks; prepared as six solid triangles

The Node preparer simulates all 1004 source-ordered bugs at a fixed 60 Hz. Browser profiles select an exact prefix only after full-source simulation:

| Profile | Leaders | Followers | Roots | Leaves |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 4 | 320 | 324 | 1944 |
| Mobile | 4 | 160 | 164 | 984 |

## Reproduce

```sh
pnpm audit:adapters -- --slug flocks
pnpm verify:source-only --strict
pnpm prepare:flocks
pnpm prepare:flocks:check
pnpm test:flocks
pnpm build:flocks
pnpm test:flocks:browser
pnpm test:flocks:startup
pnpm perf:flocks:trace -- --profile desktop --runs 3
pnpm capture:flocks:reference:frames
pnpm capture:flocks:browser:frames
pnpm compare:flocks:frames
pnpm build:flocks:deploy
pnpm test:flocks:deploy
```

`pnpm dev:flocks` serves the adapter locally. The generated model, manifest, scene, catalogs, and playback blocks live under ignored `build/generated/public/cssflocks/`. The local deploy build writes only `dist/site/flocks/` and `dist/site/cssflocks/`; it does not publish or add Flocks to the curated landing page.

The singular `capture:flocks:reference`, `capture:flocks:browser`, and `compare:flocks:visual` compatibility commands execute the same complete numbered sequence. There is no selected-still parity harness.

## Runtime contract

- one stable direct scene root per bug
- six stable `<u>` solid-triangle leaves per root
- no retained model wrapper after mount
- no Canvas, SVG scene renderer, WebGL, texture atlas, runtime geometry, class swapping, or DOM growth
- one-second gzip checkpoint/delta blocks; the active block plus eleven successors are downloaded, verified, and decompressed behind the loading indicator
- the active block plus two successors are materialized before readiness; later successors are expanded sequentially in a worker and adopted as bounded 960-state main-thread idle slices
- every source transform state is published at 60 Hz; root colors use five staggered phases, or 12 Hz per retained root
- at most three materialized blocks and twelve verified/decompressed blocks are resident

Dynamic OpenGL lighting is intentionally replaced by fixed per-face flat-light factors using `currentColor`. Dots, connections, Chromatek, and alternate geometry are not part of the route.

## Measured budgets

The deterministic bank contains 216 seconds of exact source motion plus an 8-second prepare-only cubic-Hermite terminal bridge. The bridge is an explicit behavior deviation used after a one-hour natural-seam search found no qualified source-only loop.

| Measure | Desktop | Mobile profile |
| --- | ---: | ---: |
| Encoded 224-second bank | 11,528,143 B | 5,678,413 B |
| Cold-ready median, installed desktop Chrome | 1,033.77 ms | 599.80 ms |
| Maximum initial encoded transfer | 601,215 B | 305,342 B |
| Maximum resident prepared CSS strings | 15,664,056 B | 7,863,196 B |

The mobile row is a desktop-Chrome profile/startup measurement, not physical-device cadence evidence.

Three final installed-Chrome desktop traces at 324 roots / 1,944 leaves recorded a presented-frame p95 of 16.667-16.720 ms and worst DrawFrame gaps of 19.016-27.115 ms, with zero app-attributed long tasks, block waits, steady-state scheduler resets, browser errors, or retained-DOM drift. The startup harness observed zero materialization or playback long tasks after the loading boundary. These numbers establish the declared desktop trace gate on the reference machine; they are not a universal smoothness claim.

The 45-frame source/native/browser sequence covers startup, an ordinary block handoff, a visible hue wrap, maximum visible stretch/orientation, and the terminal loop. All 14,580 transforms and staggered colors match decoded prepared state within the 0.001 CSSOM tolerance. Maximum transport errors are 0.015625 source-position units, 0.003906 velocity units, 0.000015241 hue, and 0.049692 projected pixels. Terminal p95 center motion is 6.6933 px within the qualified 7.16 px bound.

## Evidence and limits

Reproducible ignored evidence is written to:

- `bench/results/cssflocks/startup/report.json`
- `bench/results/cssflocks/cadence/desktop/report.json`
- `bench/results/cssflocks/reference-frames/`
- `bench/results/cssflocks/browser-frames/`
- `bench/results/cssflocks/frame-comparison/report.json`
- `bench/results/cssflocks/frame-comparison/native-browser-contact-sheet.png`
- `bench/results/cssflocks/deploy/report.json`

The compiled oracles include the pinned source and qualify state evolution, GL transforms, GLU topology, winding, camera projection, and the native reference sequence. Native/browser RGB differences remain diagnostic because source OpenGL lighting and the accepted fixed flat lighting intentionally differ. Real USB-phone cadence was explicitly skipped during this work and remains unproven; desktop emulation is not a substitute.
