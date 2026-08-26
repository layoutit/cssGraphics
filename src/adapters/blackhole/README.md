# Black Hole adapter

`cssblackhole` is a source-backed cssGraphics adapter for Bjorge Meulemeester's
MIT-licensed Luminet Schwarzschild photon solver. Preparation produces one
canonical 1,979-point retained-DOM scene and a 180-second prepared playback
stream split into independently prefetched five-second banks. The count honors
the paper's 1979 publication year and is a deterministic proportional subset of
the 3,000-point source pool: 1,319 direct-image and 660 ghost-image photons. The
browser publishes every complete 1,979-point state at the source-timed 60 Hz,
using a continuous paint-aligned prepared publisher with no timer-to-rAF handoff
and no intermediate runtime generation. It
performs no photon physics, source solving, flux calculation, rasterization,
color selection, morph calculation, or DOM reconstruction.

The three moving source fields use Luminet at 85 degrees for the side view,
60 degrees for the angled view, and 0 degrees for the top-down view. Their
endless presentation sequence is side, angled, top, angled. A new configuration
arrives after variable 7, 4.5, 4, and 4.5-second slots. Those slots hold their
views for 5, 2.5, 2, and 2.5 seconds respectively, followed by a two-second
prepared smoothstep transition to the next concurrently moving field. Orbital
motion remains at the accepted 0.25 presentation scale. The four-slot 20-second
view sequence and 90-second source motion close together exactly after 180 seconds.

Luminet observed flux determines opacity. The fixed white, off-white, lavender,
and purple palette, `PowerNorm(gamma=0.35)`, 0.22 opacity floor, prepare-time
nearest-decile opacity, inclination sequence, and 0.25 speed are explicit
presentation choices. The browser receives only `0`, `0.1` through `0.9`, or
`1`, and the sparse prepared schedule omits changes that remain in the same
display decile. Sixteen source-valid periodic radii keep visible orbital rails
without forcing every point onto the same few paths. Its binary range format
packs each 12-bit retained-leaf index
and 4-bit opacity decile into one 16-bit assignment, with 16-bit frame offsets.
These choices preserve source ordering and motion equations but are not Luminet
defaults or pixel-parity claims.

The surrounding field is a decorative prepared space context, not Luminet
source state. Its landscape and portrait plates each place 1,000 deterministic,
non-overlapping stars, use the same square point primitive, six-value
white-to-purple palette, and their original one-decimal `0.2` through `1.0`
opacity distribution capped at a `0.8` base maximum. The former `0.9` and `1.0`
buckets map to `0.8`, preserving the prepared placement and lower-opacity assignments.
A prepared `0.5` multiplier is then applied to the whole background, preserving
those relative brightness differences and limiting effective opacity to `0.4`. Foreground
Luminet opacity remains source-derived and unchanged. The
plates have DPR 1 and DPR 2 variants, so contextual points follow the adapter's
accepted one-CSS-pixel and two-CSS-pixel sizing policy without resampling. The
plates themselves add no DOM nodes, animation, runtime style writes, or
runtime rasterization. The context lensing is an artistic thin-lens cue and is
not a Luminet parity claim.
The landscape plate is 2,560 by 1,440 logical pixels (with a 5,120 by 2,880 DPR
2 variant), repeats only as a beyond-monitor fallback, and keeps its sparse
density through the center. It remains a static prepared backdrop behind the
source-derived Luminet point field.

```sh
pnpm prepare:luminet
pnpm dev:luminet
pnpm test:luminet
pnpm build:luminet
```

`prepare:luminet` validates the pinned source checkout and reuses the exact
prepared source-state cache when it matches. `prepare:luminet:source` forces
the pinned Python solver to regenerate that state before packing the browser
bank. Generated assets live at `build/generated/public/cssblackhole`.

Source identity, dependency versions, and file hashes are locked in
[`notes/references/source-lock.json`](notes/references/source-lock.json). See
[`NOTICE.md`](NOTICE.md) and [`LICENSE.LUMINET-MIT`](LICENSE.LUMINET-MIT).
