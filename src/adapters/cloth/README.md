# css.graphics/cloth

The Three.js r132 cloth example rendered as one retained PolyCSS Morph graph.

```bash
CSSCLOTH_SOURCE_ROOT=/path/to/three-r132 pnpm prepare:cloth
pnpm dev:cloth
pnpm test:cloth
pnpm build:cloth
```

Preparation discards a 24-second warm-up, then writes eight continuous 24-second banks from the pinned 10 by 10 Verlet simulation. It rasterizes the official CSS logo into an exact-deduplicated opaque RGB atlas and prepares every cloth triangle matrix, lighting row, and moving shadow transform. The page chooses one starting bank with `crypto.getRandomValues`, loads it before leaving the standard cssGraphics loading state, and retains only that bank plus one prefetched successor. The prepared graph mounts the cloth as retained `<u>` corner-shape leaves and also retains static projected shadows for the two poles, top bar, and feet. Runtime owns only the playback clock, prepared state publication, bank handoff, and one responsive perspective carrier.
