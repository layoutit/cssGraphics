# css.graphics/gravitywell

Source-backed XScreenSaver Gravity Well rendered as 1,984 retained PolyCSS
solid-quad grid lines: all 1,922 source-ordered coarse segments plus 62 prepared
closing-edge segments. Twenty-four deterministic prepared seed banks are
selected randomly on load, shuffled without replacement, and switched only
after every visible well has drained and the ground has held exactly flat.

```bash
CSSGRAVITYWELL_SOURCE_ROOT=/path/to/xscreensaver pnpm prepare:gravitywell:source
pnpm prepare:gravitywell:artifact
pnpm dev:gravitywell -- --port 5174
pnpm test:gravitywell:assets
pnpm test:gravitywell:browser
pnpm perf:gravitywell:frame-work
CSSGRAVITYWELL_SOURCE_ROOT=/path/to/xscreensaver pnpm oracle:gravitywell:visual
```

The performance command preserves its prepared worst-transition proof and also
records the 1.8-second canonical scheduler trial inside the Chrome trace. It
then writes a generic FrameSleuth worst-frame report to
`bench/results/cssgravitywell/performance/frame-sleuth-report.md`.

The product route contains no Canvas, WebGL, SVG scene geometry, mask, or clip
path. See `notes/provenance-bible.md` for the exact preparation and proof
boundary.

Deployment consumes a deterministic, hash-bound prepared product archive through
`prepared-bank.lock.json`; the browser downloads only the unpacked static files.
The 24 selected-bank products use 384 content-addressed sparse transform blocks
(sixteen per bank). Each block carries its local transform and color rows; block
zero also carries the selected bank's sparse write indices. The shared prepared
palette is stored once in the catalog: 412 hash-bound
closure files, or 413 on disk including the self-describing product descriptor,
with one-time block expansion and no decoding, transform formatting, or block
reconstruction inside frame publication. All sixteen blocks of the selected
bank expand beneath the loading cover before playback starts, then passed blocks
are released. Across the locked bank, that initial prepared CSS string residency
ranges from 22,143,898 to 31,076,733 bytes; the package descriptor's 4,894,248-byte
metric is only the largest adjacent block pair and is not the runtime residency
bound. The next shuffled bank begins expanding at the first block's midpoint in
two-millisecond timer slices separated by one source frame and is complete before
the exact-flat handoff. Each bank also embeds one viewport-visibility schedule
with 25 conservative portrait, landscape, and square profiles. Playback selects
the smallest-area rectangle that covers the CSS viewport, consumes its sparse
assignments, publishes transforms and colors only to selected leaves, and
catches a leaf up from its exact prepared state before making it visible again.
Coarse-pointer devices use a square profile whose prepared row and column
selections cannot contain an interior hole; whole offscreen tails remain culled
and non-square desktop profiles remain unchanged. Projection, topology closure,
and leaf visibility scans remain prepare-time work.
