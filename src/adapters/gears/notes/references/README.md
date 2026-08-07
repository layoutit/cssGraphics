# cssGears references

The prototype is bound to the read-only XScreenSaver mirror at commit
`906693799e4fb7581436590cf84ecb2d3c9186ba`. Exact hashes, first-slice
closure, and the still-pending full native closure are recorded in
`source-lock.json`.

Preparation requires a checkout at `CSSGEARS_SOURCE_ROOT` (default:
`.local/xscreensaver`). It verifies the seeded native first-slice closure,
including `gears.c`, `involute.{c,h}`, `normals.{c,h}`, `rotator.{c,h}`, and
`yarandom.{c,h}`. It compiles the pinned sources into a no-window CGL state
and frame capture plus the existing headless geometry-call capture. The
checkout, compiler output, generated scene, snapshot, captures, and reports
remain ignored.

Seed `26080601` supplies the exact non-planetary assembly parameters, initial
scene transform, and tick-zero gear angles consumed by preparation. The
source-native frame is qualified; the strict browser comparison remains
`INVALID`, so do not describe the browser output as visual parity.
