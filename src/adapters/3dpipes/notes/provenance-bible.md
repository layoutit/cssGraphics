# 3D Pipes provenance bible

Status: original generative PolyCSS artwork
Last verified: 2026-08-06

## Classification

3D Pipes is an authored browser artwork inspired by XScreenSaver `pipes.c` and
the visual memory of Windows 3D Pipes. It is not an exact source port, native
reconstruction, or parity project. The product authority is this repository's
deterministic preparation pipeline and prepared clip library.

No XScreenSaver or Microsoft source, assets, or binaries are bundled. The MIT
license in this repository covers the authored implementation only.

## Historical sources

- XScreenSaver `hacks/glx/pipes.c`, release 6.15, is the named procedural and
  visual inspiration. Its exact identity is recorded in
  `xscreensaver-pipes-source-lock.json`.
- The Microsoft Win95 SDK OpenGL 3D Pipes sample `material.c` is direct
  authority only for its sixteen `goodMaterials` tuples and their ordering.
  Its exact identity and values are recorded in
  `windows-pipes-material-source-lock.json`.
- The product uses four colors derived from that historical bank and three
  authored colors. It does not reproduce either source renderer.

Safe public description: "An original generative PolyCSS artwork inspired by
XScreenSaver Pipes and the classic Windows 3D Pipes screensaver."

## PolyCSS architecture

The implementation uses established cssGraphics techniques:

- one prepared PolyCSS retained-DOM snapshot;
- fixed-tick prepared transform playback through PolyCSS Morph;
- a prepared space-texel lighting atlas with diffuse and specular response;
- the public PolyCSS cylinder and projective-quad preparation paths;
- `<b>` solid quads for four-sided caps and `<i>` solid polygons for caps with
  five through seven sides;
- `seamBleed: 0` and an explicit zero projective guard for every wall face;
- one retained camera wrapper and no Canvas, SVG scene renderer, WebGL, or
  runtime DOM growth.

## Prepared scene contract

- 64 deterministic clips: 32 desktop and 32 mobile.
- Seven pipes per clip with fixed facet families `[4, 4, 5, 5, 6, 6, 7]`.
- Fixed palette: emerald `#4ece4e`, ruby `#ce3939`, cyan `#00bdbd`, amber
  `#dca400`, cool slate `#59636c`, pearl `#ffebeb`, and purple `#b14ece`.
- 60 logical path steps per pipe and 420 per clip.
- Every pipe is compiled as one connected ordered ring strip. Turns are not
  separate elbows: adjacent bands share the same ring vertices.
- Every complete final pipe is prepared first, recorded while retracting, and
  replayed in reverse so it appears to grow.
- Timing is derived from cumulative centerline distance, including turn arcs,
  so straight and curved portions move at one authored speed.
- Route candidates are accepted only after prepared camera-fit, screen
  occupancy, weld, recording, and continuity checks.
- The bounded-snake timeline prepares simultaneous head growth and tail crop.
  Neighboring clips share their prepared handoff rings; playback does not stop
  or construct a new tube at the seam.

## Retained output

The snapshot contains two fixed playback banks:

- 14 pipe roots total;
- 3,290 retained surface leaves total;
- 28 cap leaves total;
- seven roots visible for the active clip;
- a four-clip prepared loading horizon;
- no section, run, elbow, turn, or per-frame roots.

Preparation packs the seven fixed facet families by worst required band count.
The retained root capacities are 47, 45, 47, 41, 45, 35, and 49 bands. Four-
sided caps are single quad leaves; higher-sided caps are single polygon leaves.

## Lighting and materials

Preparation emits one 8-by-8 RGBA space-texel field per product material and
facet orientation. The atlas preserves the authored circular diffuse falloff
and adds a prepared Blinn-Phong-style specular lobe derived from the selected
historical material tuple. Static CSS binds each clip and source-pipe identity
to its prepared wall fields and matching cap color.

The browser performs no lighting calculation, material choice, random color
selection, or per-leaf color writes.

## Prepare/runtime boundary

Preparation owns seeded route generation, self-avoidance, viewport profiles,
screen occupancy, camera fitting, connected meshes, facet assignment, packing,
all wall and cap matrices, lighting texels, material bindings, head/tail crop
rows, clip chaining, playlists, stable ids, scene JSON, snapshot, and manifest.

Runtime owns only manifest/snapshot loading, desktop-or-mobile profile choice,
an already-prepared random playlist start, four-clip lookahead loading, fixed-
rate publication of prepared transforms and visibility, bank swapping, pause,
resume, and clean restart after the prepared playlist is exhausted.

Runtime geometry, route generation, turn detection, camera fitting, matrix
derivation, lighting, topology changes, CSS interpolation, and DOM growth are
forbidden.

## Release evidence

Release verification is intentionally narrow:

1. regenerate the prepared assets;
2. require the canonical scene, snapshot, and atlas hashes to remain unchanged
   for a code-only cleanup;
3. build the production adapter;
4. run repository type and source-only checks.

Visual acceptance belongs to the prepared scene itself. Historical native
screenshots may explain inspiration but are not parity evidence.
