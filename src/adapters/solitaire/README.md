# cssSolitaire

A behavior-backed retained-DOM PolyCSS recreation of the classic Solitaire
victory cascade. A king, queen, jack, and ace form the starting row. Three
descending four-card cycles run the recovered integer-motion trajectories and
accumulate as persistent framebuffer-style ghosts before the scene rewinds.
Each completed rewind selects from a shuffled bank of 24 prepared trajectory
patterns without an immediate repeat.

The browser adopts 1,911 prepared card leaves—the largest bank entry plus the
four launch cards—and applies sparse signed visibility rows. Card geometry,
trajectories, ordering, atlas coordinates, and the complete DOM snapshot are
prepared ahead of time. A handoff changes only the prepared bank index and the
hidden leaf layout. Runtime does not build a model, generate motion, rasterize
an atlas, create card leaves, or clear the trail at handoff.
`@layoutit/polycss-morph` owns the stable prepared-DOM target.

The package carries a 585×384 landscape transform profile plus four 384×720
portrait profiles. Narrow portrait viewports show one centered full-size card
stream; wider portrait layouts progressively show two, three, then four.
Portrait horizontal motion reflects from the prepared side walls, and every
card remains upright. CSS selects the matching profile without changing the
retained DOM.

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
