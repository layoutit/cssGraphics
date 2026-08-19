# cssCyclone

This adapter translates Really Slick Cyclone into one retained PolyCSS Morph
graph. Desktop mounts the source-default 400 particle roots and mobile mounts a
prepared prefix of 166 complete source particles. Every particle retains all six
original solid-triangle leaves: 2,400 desktop leaves or 996 mobile leaves. The
selected profile plays 24 source-continuous logical chunks of 450 prepared 20 ms
transform states. The stream is transported as 216 one-second prepared blocks
so decompression stays outside long animation frames. Source fixed-function
smooth-vertex lighting is prepared at the first published frame into a verified
lossless WebP atlas. Initial leaf addresses are bound once. Later address writes
are limited to the six leaves of a particle when the source restarts it with a
new color. The mounted graph is camera, scene, particle roots, and leaves; the
PolyCSS Morph model wrapper is removed after adoption and its fixed transform is
composed onto the existing scene node.
There is no Canvas, SVG, WebGL, runtime random walk, geometry construction,
lighting calculation, matrix formatting, atlas rasterization, or DOM growth.
The prepared presentation maps the source's random saturation samples into a
0.55-1.0 range and lifts only the dark end of prepared HSV value to 0.65. The
source's uniform random hue-target timing and its rule that
particles change color only when they restart are preserved. At preparation,
each source hue is assigned to one of three slots in the selected session palette.
Five lossless lighting-atlas variants provide blue-, yellow-, red-, magenta-,
and green-centered palettes; each variant spans at most three adjacent hue
families for the entire playback. The browser selects one prepared atlas and
performs no color calculation. The same source RNG draws preserve RNG cadence,
geometry, restart timing, and coherent color bands, but prepared hue values are
intentionally quantized and low lightness is intentionally lifted; these are not
exact source colors.
Startup is prebaked to ten audited 40-frame source windows. The selector gives
each of the five prepared palette variants—blue, yellow, red, magenta, and
green—exactly once per session-shuffled cycle before any family repeats, then
chooses between two expressive browser-reviewed source windows in that family.
It never phases individual particles around a full hue wheel. This is an
intentional presentation rather than an exact native-color or random-start
claim. Mobile/coarse-pointer devices and viewports below 600px select the
166-particle prepared profile before mount and use a 90-degree presentation
field of view instead of the source-default 80 degrees. Prepared motion and each
particle's complete six-face topology are unchanged.

The stream discards the source's dark startup by preparing 24 seconds before its
first published frame. Its 10,800 states cover 216 seconds before repeating.
Startup uses `crypto.getRandomValues` to shuffle the five-family session bag and
to select an audited source window and frame, excluding the previous exact
window. Playback
then follows the original source order. Each hash-bound
gzip transport stores shared source control points and widths, one initial
state per particle, sparse reset events, and flat `Uint16` lighting indices;
it does not store repeated CSS transform strings. It downloads, verifies, and
decompresses the active block plus 11 successors behind the loading indicator
on both desktop and mobile, but initially expands CSS strings only for the
active block and its immediate successor. A dedicated preparation worker
materializes the rest sequentially while the main thread publishes the same
stable retained DOM and maintains the 12-second source-state window. The
single terminal stream wrap is the only
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

The retained-DOM route is publication-qualified within its documented PolyCSS
constraints. The first published frame qualifies the prepared smooth-light
field. During motion the highlight orientation stays attached to each particle
while source color restarts remain exact; this is an intentional performance
adaptation. The complete dense scene is not claimed to be pixel-identical to
OpenGL because OpenGL resolves intersecting particles with a per-fragment depth
buffer while the retained CSS scene uses planar compositor ordering. The
supported Chrome path renders all six CSS triangle leaves per particle with no
alternate renderer or geometry fallback.

The adapter is GPL-2.0-or-later; see [NOTICE.md](NOTICE.md).
