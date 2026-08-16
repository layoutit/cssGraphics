# cssSolitaire

A behavior-backed retained-DOM PolyCSS recreation of the classic Solitaire
victory cascade. Cards remain upright, bounce under the recovered integer
motion rules, and accumulate as persistent framebuffer-style ghosts.

The browser adopts 8,839 prepared card leaves and applies sparse signed
visibility rows. Card geometry, trajectories, ordering, atlas coordinates, and
the complete DOM snapshot are prepared ahead of time. Runtime does not build a
model, randomize motion, rasterize an atlas, create card leaves, or clear the
trail at handoff. `@layoutit/polycss-morph` owns the stable prepared-DOM target.

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
