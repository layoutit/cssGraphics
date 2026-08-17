# cssSolitaire

A behavior-backed retained-DOM PolyCSS recreation of the classic Solitaire
victory cascade. A king, queen, jack, and ace form the starting row. Three
descending four-card cycles run the recovered integer-motion trajectories and
accumulate as persistent framebuffer-style ghosts before the scene rewinds.
Each completed rewind selects from a shuffled bank of 24 prepared trajectory
patterns without an immediate repeat.

The browser adopts 1,952 prepared card leaves—the largest bank entry plus the
four launch cards—and applies sparse signed visibility rows. Card geometry,
trajectories, ordering, atlas coordinates, and the complete DOM snapshot are
prepared ahead of time. A handoff changes only the prepared bank index and the
hidden leaf layout. Runtime does not build a model, generate motion, rasterize
an atlas, create card leaves, or clear the trail at handoff.
`@layoutit/polycss-morph` owns the stable prepared-DOM target.

The source simulation stays bound to the recovered 585×384 playfield. Prepared
leaf transforms express position in viewport units, so there is no centered
reference playfield or letterbox. The foundation row keeps a fixed 80px top
margin while the recovered floor maps to the real viewport bottom at every size.
One smooth prepared curve maps the source apex to an 8px inset, the launch line
to 80px, and the lowest retained bounce point to the real viewport bottom.
Responsive cards therefore keep a natural continuous arch without clipping
either viewport edge.
Launch origins follow Solitaire's recovered seven-slot gap
rule; narrow portrait viewports launch one centered full-size card per pattern,
and the other retained copies are only its classic ghost trail. That card follows
three complete prepared floor-bounce cycles and reflects from normalized prepared
side-wall positions. On phone layouts, every wall and nonterminal floor impact
selects a different prepared source-range horizontal step, so one card does not
repeat the same outgoing angle through the whole path. Two prepared in-between ghosts per recovered motion step keep
the trail tight without changing its physics; wider layouts progressively expose two, three, then four
proper foundation slots.
The phone bank has 24 distinct effective launch angles from the recovered integer
horizontal and vertical step ranges. It balances direction 12/12, never reuses a
prepared path in one shuffled pass, starts each page load from a cryptographically
selected prepared pattern, and alternates starting direction at handoff.
The wider multi-card profiles and landscape map their prepared exit boundary
fully beyond the real viewport. The first two foundation lanes occasionally
exit right while the remaining lanes keep their leftward exit. Every card
remains upright. As in the sibling
cssGraphics adapters, one
retained-root presentation scale follows the viewport; CSS derives card dimensions
from it without per-leaf geometry work or retained-DOM changes.

## Run

From the repository root:

```sh
pnpm install
pnpm prepare:solitaire
pnpm dev:solitaire
```

Open <http://127.0.0.1:5173/>. `window.__cssSolitaireDebug` exposes prepared
state, pause/resume/seek controls, retained-DOM assertions, and runtime-work
counters.

## Verify

```sh
pnpm test:solitaire
pnpm test:solitaire:assets
pnpm build:solitaire
pnpm test:solitaire:browser
```

`pnpm build:solitaire:deploy && pnpm test:solitaire:deploy` also verifies the
production `/solitaire/` base path.

The Microsoft binary, Microsoft card artwork, native frames, and Ghidra project
remain ignored local oracle material. The shipped card faces are Loren Osborn's
CC0 English-pattern deck. See
[`notes/provenance-bible.md`](notes/provenance-bible.md).
