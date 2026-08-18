# cssCyclone

This first slice translates Really Slick Cyclone into one retained PolyCSS Morph
graph. It mounts the source-default 400 particle roots with six solid triangle
leaves each and plays 24 source-continuous logical chunks of 450 prepared 20 ms
transform states. The stream is transported as 216 one-second prepared blocks
so decompression stays outside long animation frames. Source fixed-function
smooth-vertex lighting is prepared at the first published frame into a verified
lossless WebP atlas. The 2,400 initial leaf addresses are bound once. Later
address writes are limited to the six leaves of a particle when the source
restarts it with a new color.
There is no Canvas, SVG, WebGL, runtime random walk, geometry construction,
lighting calculation, matrix formatting, atlas rasterization, or DOM growth.
The prepared presentation applies a square-root bias to the source's random
saturation samples. Hue, lightness, RNG cadence, and geometry stay unchanged,
while low-saturation grey runs occur less often. This is an intentional product
color bias rather than an exact native-color claim. Viewports below 600px use a
90-degree presentation field of view instead of the source-default 80 degrees
so the cyclone fits narrow screens without changing prepared motion or geometry.

The stream discards the source's dark startup by preparing 24 seconds before its
first published frame. Its 10,800 states cover 216 seconds before repeating.
Startup uses `crypto.getRandomValues` once to select a logical chunk and an
early frame from the first half of the stream, excluding the previous session
start chunk. Playback then follows the original source order. Each hash-bound
gzip block prefetches its exact successor; only the active and lookahead blocks
remain resident. The single terminal stream wrap is the only
non-source-continuous boundary.

Source identity is pinned in `notes/references/source-lock.json`. Preparation
uses a fixed MT19937 authoring seed because current `rslibs` seeds its generator
from `std::random_device`. It also initializes the source's first target-point
buffer from the current path before the first update, replacing an upstream
uninitialized read with deterministic state. The source's duplicated X tangent
accumulation is otherwise retained.

Run:

```sh
pnpm prepare:cyclone
pnpm test:cyclone
pnpm build:cyclone
pnpm dev:cyclone
```

The first published frame qualifies the prepared smooth-light field. During
motion the highlight orientation stays attached to each particle while source
color restarts remain exact; this is an explicit performance approximation.
The complete dense scene is not pixel-identical because OpenGL also resolves
intersecting particles with a per-fragment depth buffer while the retained CSS
scene uses planar compositor ordering. The missing non-corner-shape triangle
fallback keeps this first slice from being a release claim.

The adapter is GPL-2.0-or-later; see [NOTICE.md](NOTICE.md).
