# cssMaze provenance bible

Status: public first-slice product prepared; used source/state/texture closure
qualified; full native closure, calibrated visual oracle, and parity are pending

Last verified: 2026-08-09

Target: XScreenSaver `maze3d` at commit
`906693799e4fb7581436590cf84ecb2d3c9186ba`

Intended renderer: retained-DOM PolyCSS only

## Executive decision

cssMaze will target the behavior and presentation of the pinned XScreenSaver
`maze3d` implementation. It may evoke Microsoft's Windows 95 3D Maze, but it
must not be described as an exact Microsoft port unless an original binary or
source closure is separately identified, lawfully held, and qualified.

The first product prepares a 24-scene seed bank from a byte-verified checkout.
A headless C extraction of the pinned generation and camera routines emits exact
state, preparation ranks 512 deterministic candidate seeds by lowest turning-
frame ratio and then angular rate, and the browser adopts one stable snapshot at
a time. Candidates shorter than 600 states are excluded. This does not qualify
the full native build or pixel parity.
The generated product transport is a selected-first gzip manifest. Each public
scene omits geometry and references one gzip retained snapshot; the full
geometry-bearing scene remains in ignored prepare-only output. The verified
product bank contains exactly the manifest, 24 scene files, 24 snapshot files,
and three texture files. The pinned repository-wide notice permits distribution
of that used closure when its copyright and permission notice accompanies it.
The browser snapshot retains the source floor and ceiling as one quad each and
selects prepared wall visibility sets to approximate OpenGL near-plane
rejection. Walls with any vertex in front remain admitted so Chromium can clip
crossing source quads; walls wholly behind are hidden. This is a CSS rendering
accommodation, not pixel parity evidence.
The prepared camera transform places the source eye at PolyCSS's CSS perspective
distance and leaves the source rotation rows unchanged. PolyCSS's emitted
two-dimensional scene scale is
prepared as a uniform `scale3d(4.8, 4.8, 4.8)` so depth is scaled with lateral
and vertical coordinates.
Each prepared snapshot declares a linear compositor transition whose 20 ms
duration comes from the source frame delay. The browser still selects only exact
prepared source rows; it performs no camera interpolation math in JavaScript.
This smoother presentation is a browser accommodation and not native pixel-
parity evidence. Deterministic browser oracle capture disables the transition
before seeking exact prepared rows.

## Authority order

1. The byte-identified XScreenSaver source closure at the pinned commit.
2. A reproducible headless native build from that exact closure.
3. Deterministic native state and frame captures from that build.
4. Independently authored cssMaze preparation after exact differential tests.
5. The generated PolyCSS manifest, snapshot, and browser contract tests.
6. Screenshots, videos, clones, and recollections as preview references only.

No clone or preview may silently override a result from the pinned source.

## Exact source identity

The source-entry lock is `notes/references/source-lock.json`. It records SHA-256
identities for:

- `hacks/glx/maze3d.c`;
- `hacks/config/maze3d.xml`;
- `hacks/glx/maze3d.man`;
- `debian/copyright`;
- `hacks/images/brick1.png`;
- `hacks/images/brick2.png`;
- `hacks/images/wood2.png`.

The primary file identifies itself as a recreation and contains its own
permission notice. The pinned `debian/copyright` applies a permissive notice to
`Files: *`; its SHA-256 identity is recorded with the three used image bytes.
The full XScreenSaver utility and optional maze3d asset closure is not complete,
and this qualification does not apply to Microsoft binaries, captures, logos,
or separately sourced Microsoft assets.

## Rights and local-data boundary

- Do not automatically fetch, commit, package, or redistribute Microsoft
  binaries, textures, or captures.
- Keep upstream checkouts, native builds, generated image headers, captures,
  traces, and reports in ignored local storage. The three admitted PNG inputs
  are carried only by the separately hash-bound prepared product archive.
- Record the hash, origin URL, retrieval date, and applicable notice for every
  file admitted to the source or oracle closure.
- Carry the XScreenSaver copyright and permission notice in the prepared product
  descriptor and repository documentation.

## Implemented first slice

The first slice is a deterministic bank of 24 prepared 12 by 12 mazes, each with
one prepared route, brick walls, floor, ceiling, and the source camera cadence.
Generation, start and finish placement, wall rise/descent, and camera rows come
from headless C source-state dumps. The candidate interval begins at seed
`26080701`; preparation selects the lowest-rotation 24 eligible traces rather
than generating or scoring on page load. Rats, inverters, overlay, acid modes,
floating images, and user-supplied textures remain outside the first slice until
their source and asset dependencies are qualified.

## Preparation and runtime boundary

Preparation must own maze generation, topology, wall batching, texture/atlas
work, route solving, camera poses, turn timing, visibility sets, lighting,
ids, metrics, manifest writing, and the retained snapshot. Adjacent coplanar
same-material walls should have an explicit prepare-time merge seam with source
counts retained for audit.

Runtime may load the canonical manifest, randomly select or change to a prepared
bank entry, adopt stable retained leaves, select prepared camera/visibility rows,
and expose pause, seek, step, and debug state.
Runtime must not generate a maze, solve a route, construct geometry, rasterize
textures, calculate lighting, grow the DOM, or ingest native replay.

The css.graphics route is `/maze/`, with prepared assets under `/cssmaze/`.
Deployment downloads and verifies the hash-bound prepared bank before unpacking
its static files; the browser never downloads the release archive.

Preparation also owns the initial wall-visibility operations and one signed
changed-leaf operation row for every source state, including the loop reset.
Normal playback uses one self-correcting timer callback per 20 ms source row,
compares only prepared transform indexes, and applies those changed-leaf
operations directly. It performs no 169-wall visibility comparison scan, no
camera animation-frame callback, and no product mutation observation. Arbitrary
debug seek retains an absolute visibility scan so it can jump from an unknown
row; browser smoke observes the product scene externally when proving stable DOM.

The product route must not use Canvas, WebGL, WebGPU, SVG geometry, Three.js,
Babylon, WASM/emulation, or a second renderer. Product CSS must avoid clip
paths, masks, filters, shadows, gradients, and blend modes.

## Reference and proof plan

1. The local first-slice source/state/image bytes are enumerated and hashed.
2. The used image redistribution posture is bound to the pinned repository-wide
   copyright and permission notice.
3. The headless state oracle is bound to the pinned generation and camera logic.
4. Candidate interval, ranking, selected seeds, mazes, routes, 960×540 viewport,
   and 20 ms frame schedule are frozen by preparation.
5. Exact generation, topology, pose, and timing tests precede pixels.
6. The local source-backed OpenGL helper can capture same-seed comparison
   frames; a full pinned XScreenSaver binary oracle and native A/A/browser A/A
   calibration remain pending.
7. Native/browser/absolute-diff artifacts must retain that qualification until
   the remaining identity and calibration gates close.

## Claims ledger

Proven now:

- the seven public first-slice inputs resolve at the pinned mirror commit and their
  SHA-256 identities are recorded;
- every selected seed emits one 25×25 source grid, 169 drawn wall segments, and
  171 total source quads; its complete source-cadence state trace is prepared;
- the generated browser artifact exposes 24 ranked prepared entries, adopts one
  stable retained-DOM snapshot at a time, and publishes only prepared world-
  camera, wall-height, and signed changed-leaf visibility rows;
- normal product playback uses one timer callback per prepared source row with
  zero runtime wall-visibility comparisons and zero product mutation observers;
- the three used XScreenSaver textures are distributable with the pinned
  copyright and permission notice included in supporting documentation.

Not proven:

- complete native source or full image closure;
- a full pinned XScreenSaver binary visual oracle or calibrated visual parity;
- rights qualification for optional maze3d modes or any Microsoft original.

Describe cssMaze as a source-backed PolyCSS port of the pinned XScreenSaver
first slice, not an exact Windows reproduction and not a pixel-parity result.
