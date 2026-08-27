# Chaos

Chaos is css.graphics adapter 011: a retained-DOM PolyCSS presentation of 50 source-backed
chaotic attractors prepared from the pinned `GilpinLab/dysts` collection. Exactly 2,000 stable
`<b>` leaves draw every attractor, scatter directly toward the next one, and remain mounted for
the lifetime of the scene. Each page load shuffles the 50-system sequence without repeating a
system until the full set has played.

The preparation audits all 135 continuous upstream systems, preserves the recorded visual,
similarity, and motion-interest curation decisions, and packages the final 50. Three-dimensional
systems keep their source-axis proportions under a rigid prepared camera. Higher-dimensional
systems use unscaled PCA into three dimensions. A deterministic preparation-time camera audit
chooses a strong fixed view for each system, then bakes the final CSS projection, billboard depth
scale, dot distribution, reveal order, and handoff controls.

The browser performs no physics, source-coordinate projection, point matching, reveal sorting,
or handoff path construction. It streams the current and next Brotli-compressed prepared assets,
materializes them in one worker, and publishes prepared samples at 60 Hz. The initial reveal is
three seconds; each later handoff is two seconds followed by a three-second hold. Prepared spatial
identity is matched at incoming frame 120 and outgoing frame 300.

The cyclic green-to-white-to-yellow-to-red palette follows prepared source trajectory phase rank.
It is interpolated in OKLab and gamut-mapped to sRGB during preparation. This palette and the
editorial chapters are PolyCSS presentation choices, not upstream metadata.

```sh
pnpm prepare:chaos
pnpm test:chaos
pnpm test:chaos:browser
pnpm build:chaos:deploy
pnpm test:chaos:deploy
```

`pnpm prepare:chaos` checks out the exact pinned dysts commit, verifies the recorded source hashes,
creates the ignored Python environment when needed, runs the complete source-backed ranking, and
emits the deploy product at `build/generated/public/csschaos/`.

The exact 33-system visual-audition removal decision, seven measured lookalikes removed at a 0.91
similarity threshold, one dot-fidelity rejection, and 44 lower-motion-quality systems removed after
the exact 94-system prepared motion audit
are recorded under `notes/curation/`. Ranking previews and generated audit evidence remain under
the ignored `output/dysts-ranking/` tree.
