# Platonic Folding provenance

The authority is XScreenSaver `hacks/glx/platonicfolding.c` at revision
`906693799e4fb7581436590cf84ecb2d3c9186ba`. The source file carries a
permissive use, copy, modification, and distribution notice from Carsten
Steger. The adjacent XML config supplies the public defaults and description.

The prepared source model preserves the five face-adjacency graphs, base face
geometry, face counts, eye distances, maximum fold angles, 25 ms cadence,
180-step entrance and exit, quintic hinge easing, 0.5-degree rotation cadence,
45-degree field of view, and portrait/landscape travel direction. The mobile
bank moves the eye 1.55 times farther away so complete nets fit narrow screens.
The product
chooses the source-supported one-folding mode and a deterministic valid run in
which each solid uses joint folding.

All five solids share one `static-prepared` Morph graph: 50 face roots and 50
raster leaves. Only the active solid's 4, 6, 8, 12, or 20 leaves are visible.
Preparation owns the unfolding trees, complete 2,710-frame sequence,
source-ordered sparse operation rows, six-decimal preformatted face matrices,
source-style face colors, quantized baked lighting rows, and the atlas with
quarter-pixel prepared edge coverage. Runtime binds the shared
graph with `createPolyMorphPreparedDomTarget` and owns only the clock, direct
prepared operation selection, and responsive perspective. Full prepared-state
materialization, full-state diffs, matrix formatting, id lookup, and normal-path
full-graph scans remain outside playback.

The independent oracle includes the pinned source file directly in a headless
CGL harness and exercises its GLSL folding draw path. Native and browser A/A
captures are exact. The matched native/browser schedule covers entrance,
folded, transition, unfolded, refolded, and exit poses for all five solids. The
qualified claim is a bounded source-faithful approximation rather than visual
parity or pixel identity: the remaining delta is confined to prepared atlas
filtering and the 64-state per-face color palettes. The existing upstream video
remains preview material, not proof.
