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

The product route contains no Canvas, WebGL, SVG scene geometry, mask, or clip
path. See `notes/provenance-bible.md` for the exact preparation and proof
boundary.

Deployment consumes a deterministic, hash-bound prepared product archive through
`prepared-bank.lock.json`; the browser downloads only the unpacked static files.
The 24 selected-bank products use 72 content-addressed sparse transform blocks
(three per bank). Each block carries its local transform and color rows; block
zero also carries the selected bank's sparse write indices. The shared prepared
palette is stored once in the catalog: 100 hash-bound
closure files, or 101 on disk including the self-describing product descriptor,
with one-time block expansion and no per-frame decoding, transform formatting,
or block reconstruction.
