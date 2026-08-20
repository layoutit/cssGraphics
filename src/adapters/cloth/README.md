# css.graphics/cloth

The Three.js r132 cloth example rendered as one retained PolyCSS Morph graph.

```bash
CSSCLOTH_SOURCE_ROOT=/path/to/three-r132 pnpm prepare:cloth
pnpm dev:cloth
pnpm test:cloth
pnpm build:cloth
```

Preparation discards a 24-second warm-up, then writes eight continuous 24-second banks from the pinned 10 by 10 Verlet simulation. Desktop keeps its 200-triangle cloth. At 600px and below, a separate prepared profile bilinearly remeshes the same simulation to a full 6 by 6 square with 72 cloth triangles and 158 total retained leaves. Both profiles rasterize the official CSS logo into an exact-deduplicated opaque RGB atlas and prepare every cloth triangle matrix, lighting row, and moving shadow transform. The page chooses one starting bank with `crypto.getRandomValues`, loads it before leaving the standard cssGraphics loading state, and retains only that bank plus one prefetched successor. Runtime owns only the one-time responsive profile choice, playback clock, prepared state publication, bank handoff, and one responsive perspective carrier.
