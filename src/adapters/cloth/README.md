# css.graphics/cloth

The Three.js r132 cloth example rendered as one retained PolyCSS Morph graph.

```bash
CSSCLOTH_SOURCE_ROOT=/path/to/three-r132 pnpm prepare:cloth
pnpm dev:cloth
pnpm test:cloth
pnpm build:cloth
```

Preparation discards a 24-second warm-up, then writes eight continuous 24-second banks from the pinned 10 by 10 Verlet simulation. Each bank stores one exact simulation checkpoint plus its sparse lighting schedule. Desktop keeps its 200-triangle cloth. At 600px and below, a separate prepared profile bilinearly remeshes the same simulation to a full 6 by 6 square with 72 cloth triangles and 158 total retained leaves. Both profiles rasterize the official CSS logo into an exact-deduplicated opaque RGB atlas.

The page fetches the selected profile's fixed package resources concurrently and chooses one starting bank with `crypto.getRandomValues`. A Worker expands that checkpoint into exact cloth and shadow transforms, sends the first four seconds before the page leaves the standard cssGraphics loading state, then streams bounded matrix chunks while the main thread consumes them in idle slices. Successor banks are fully Worker-prepared before handoff. Runtime publication owns only the playback clock, prepared transform, sparse lighting and shadow application, bank handoff, and one responsive perspective carrier.
