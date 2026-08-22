# cssCyclone

This adapter translates Really Slick Cyclone into one retained PolyCSS Morph
graph. The source-default 400-particle simulation is prepared into prefixes of
320 complete particles on desktop and 166 on mobile. Every retained particle is
a forward-pointing triangular bipyramid with six solid-triangle faces: 1,920
desktop leaves or 996 mobile leaves. The
selected profile plays 24 source-continuous logical chunks of 540 prepared
16.667 ms
transform states. The stream is transported as 216 one-second prepared blocks
so decompression stays outside long animation frames. The source fixed-function
light is sampled at each particle's original smooth vertex normals in the first
published frame, then the three lit vertex colors of every triangle are averaged
into one prepared opaque CSS face color, then receives a prepared 1.4 sRGB
exposure. The twelve variants are then normalized once in OKLab using visible
frame-occurrence weights for each of their three hue groups. Chroma is reduced
only where the adjusted color would
leave the sRGB gamut, so every family keeps its hue and face-lighting contrast
without blue and violet sessions becoming perceptually dark. A preparation guard
checks OKLab lightness rather than the maximum RGB channel. Exact cross-palette color tuples
are deduplicated into a compact prepared slot table. Initial leaf colors are
bound once. Later color writes are limited to the six leaves of a particle when
the source restarts it with a new color. The mounted graph is camera, scene,
particle roots, and leaves; the
PolyCSS Morph model wrapper is removed after adoption and its fixed transform is
composed onto the existing scene node.
There is no Canvas, SVG, WebGL, runtime random walk, geometry construction,
lighting calculation, color calculation, matrix formatting, image decode, atlas
rasterization, or DOM growth.
The prepared presentation maps the source's random saturation samples into a
0.55-1.0 range and lifts the dark end of prepared HSV value to 0.75. Each
session variant contains at most three coordinated hue families: two primaries
and one secondary, separated by 30-degree steps across a 60-degree analogous range. Source hue ranks
assign 40% of particle colors to each primary and 20% to the secondary. The source's uniform
random hue-target timing and rule that particles change color only when they
restart remain unchanged. Twelve prepared variants use explicit audited
three-hue sets; none combines opposing families such as red and blue. The
palette definition is shared with Flocks. The browser selects one complete prepared color table and performs no color calculation. The same source RNG
draws preserve RNG cadence, trajectory geometry, restart timing, and coherent
color bands. The session palette, prepared exposure, and perceptual-lightness normalization are
intentional presentation changes; they are not exact source colors.
Startup is prebaked to ten audited 48-frame source windows. A 12-load
session-shuffled cycle includes every prepared palette exactly once without
adjacent repeats, so red rotations have the same reload odds as every other
rotation. It independently
chooses one expressive browser-reviewed source window while excluding the
previous exact window.
It never phases individual particles around a full hue wheel. This is an
intentional presentation rather than an exact native-color or random-start
claim. Mobile/coarse-pointer devices and viewports below 600px select the
166-particle prepared profile before mount and use a 90-degree presentation
field of view instead of the source-default 80 degrees. Prepared motion and each
particle's prepared six-face topology are unchanged during playback. The
bipyramid's forward tip follows local -Z, the source transform's stretched
orbital travel axis. Its unstretched tip-to-tip depth equals its equator
diameter, so the source transform alone controls elongation. The prepared radial
orbit is scaled to 0.75 of the source width around the unchanged spline, packing
the reduced particle budget into tighter cyclone bands without runtime layout.

The stream discards the source's dark startup by preparing 12 seconds before its
first published frame. Its 12,960 states cover 216 seconds before repeating.
Startup uses `crypto.getRandomValues` to shuffle the twelve-rotation session bag and
to select an audited source window and frame, excluding the previous exact
window. Playback
then follows the original source order. Each hash-bound
gzip transport stores shared source control points and widths, one initial
state per particle, sparse reset events, and flat `Uint16` lighting indices;
it does not store repeated CSS transform strings. It downloads, verifies, and
decompresses the active block plus 11 successors behind the loading indicator
on both desktop and mobile, but expands CSS strings only for the active block
and two successors. Those first three blocks are complete before the loading
indicator clears. A dedicated preparation worker expands later successors
sequentially; the worker transfers bounded 960-transform structured-clone
chunks at the prepared source cadence and the main thread adopts them in idle
slices without a TextDecoder-backed string table. A continuous animation-frame
scheduler publishes the same stable retained DOM while maintaining the
12-second compact source-state window. The
single terminal stream wrap is the only
non-source-continuous boundary.

Source identity is pinned in `notes/references/source-lock.json`. Preparation
uses a fixed MT19937 authoring seed because current `rslibs` seeds its generator
from `std::random_device`. Preparation preserves that source stream and smoothly
compresses only particle centers that enter the last 80 CSS units before the
camera, keeping at least 40 CSS units of depth. This prepared-only guard applies
to every authoring seed and rejects any generated stream that still crosses the
camera-depth boundary. It also initializes the source's first target-point
buffer before the first update, replacing an upstream uninitialized read with
deterministic state. The source's duplicated X tangent accumulation is otherwise
retained.

Run:

```sh
pnpm prepare:cyclone
pnpm test:cyclone
pnpm build:cyclone
pnpm dev:cyclone
```

The retained-DOM route is publication-qualified within its documented PolyCSS
constraints. The first published frame qualifies the prepared source-vertex-
averaged solid-face light field. During motion the face shading stays attached to each particle
while source color restarts remain exact; this is an intentional performance
adaptation. The complete dense scene is not claimed to be pixel-identical to
OpenGL because OpenGL resolves intersecting particles with a per-fragment depth
buffer while the retained CSS scene uses planar compositor ordering. The
supported Chrome path renders all six prepared CSS leaves per particle with no
alternate renderer or geometry fallback.

The adapter is GPL-2.0-or-later; see [NOTICE.md](NOTICE.md).
