# cssFlipFlop provenance

## Authority

- Project: XScreenSaver Flip Flop
- Revision: `906693799e4fb7581436590cf84ecb2d3c9186ba`
- Primary source: `hacks/glx/flipflop.c`
- Primary SHA-256: `099d290a75e52d6ccc5de7ea1344ef8ee0889293acef034e9ed85f2bdf2e41fb`
- Configuration: `hacks/config/flipflop.xml`
- Mode: the source-default untextured `tiles` mode

The primary file grants permission to use, copy, modify, distribute, and sell,
provided its copyright and permission notices are preserved.

## Prepared boundary

The preparer ports the default `randsheet_initialize`, `randsheet_new_move`, and
`randsheet_move` state machine with XScreenSaver's `ya_random` stream. The first
600 frames per prepared bank run at the source 20 ms cadence. Desktop uses the
source-default 9x9 board; mobile uses the source-supported 5x5 board. The product then traverses those
exact prepared states backward so the retained graph can loop without a state
jump. That reverse traversal is presentation behavior, not a native parity
claim.

Each source tile remains one rigid Morph shape with the six quads emitted by
`draw_sheet`. Tile motion changes the shape root; it never rebuilds or deforms
the six retained leaves. Source primary colors are preserved. A prepared raster
profile bank approximates the source fixed-function per-vertex lighting and
remains visually unqualified.

The CSS perspective derives from the source `gluPerspective(45, ...)` vertical
field of view: the viewport height is divided by twice `tan(22.5deg)`. The
`0.9 * viewport width` cap is a responsive presentation choice that keeps the
rotating square board visible in portrait layouts; it is not native behavior.

## Proof state

- Source-state parity: the durable native oracle checks desktop and mobile at
  ticks 0, 180, and 599 within float tolerance.
- Native raster capture: headless CGL works.
- Browser raster parity: unqualified.
