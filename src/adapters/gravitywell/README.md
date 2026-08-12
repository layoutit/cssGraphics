# css.graphics/gravitywell

Source-backed XScreenSaver Gravity Well rendered as 1,922 retained PolyCSS
solid-quad grid lines. Twenty-four deterministic prepared seed banks are
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
reconstruction inside frame publication. The initial current-plus-lookahead
pair expands beneath the loader. During endless playback, later blocks expand
incrementally in request-idle slices with a two-millisecond target budget; the
next slice is delayed by one source frame so lookahead formatting cannot bunch
inside one idle window. The player retains only the current and one lookahead
block, so activation does not wait for expansion. A block expands to at most
3,449,674 bytes of final CSS strings, and every prepared current-plus-lookahead
pair stays below 6,754,392 bytes. Each bank also embeds one small viewport-visibility
schedule with 25 conservative portrait, landscape, and square profiles. Playback
selects the smallest-area rectangle that covers the CSS viewport, consumes its
sparse assignments, publishes transforms and colors only to selected leaves,
and catches a leaf up from its exact prepared state before making it visible
again. Projection and leaf visibility scans remain prepare-time work.
