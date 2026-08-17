# css.graphics/flipflop

Source-backed XScreenSaver Flip Flop rendered as startup-selected PolyCSS Morph
banks: the source-default 9x9 desktop board has 76 stable tile roots and 456
retained prepared-raster leaves; the source-supported 5x5 mobile board has 23
roots and 138 leaves.

```bash
CSSFLIPFLOP_SOURCE_ROOT=/path/to/xscreensaver pnpm prepare:flipflop
pnpm dev:flipflop
pnpm test:flipflop
pnpm build:flipflop
```

Preparation owns the exact seeded tile simulation and a 600-frame source
segment. The product loops by rewinding the same prepared states. Runtime owns
only the playback clock, sparse Morph state publication, and one responsive
perspective carrier. The viewport/device-selected bank is loaded once at startup
and does not switch while the retained graph is mounted.
