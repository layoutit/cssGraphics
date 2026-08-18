# Flip Flop adapter contract

- Read `notes/provenance-bible.md` before changing source simulation, tile geometry, matrices, colors, camera, timing, or parity claims.
- Preparation owns the exact seeded `ya_random` move stream, every selected-bank tile state, six source quads per tile, every board/tile matrix, source-light atlas row, and the forward/reverse presentation timeline.
- Runtime may only mount the prepared Morph package, publish prepared model/shape/atlas-row state, and update the single responsive perspective carrier.
- Preserve the XScreenSaver desktop defaults: 9 by 9 board, 95 percent tile ratio, 76 tiles, five holes, 0.04 half-thickness, 40 move attempts per source frame, 0.03-pi flip step, 20 ms cadence, and 0.1 spin. The mobile bank uses the source-supported 5 by 5 tile mode with the same ratio and dynamics, yielding 23 tiles and two holes.
- Select one prepared bank at startup and never switch it at runtime: desktop owns 76 rigid tile roots and 456 `<s>` leaves; mobile owns 23 roots and 138 leaves. Both use the prepared raster atlas with zero geometry seam bleed. No Canvas, WebGL, WebGPU, SVG scene geometry, masks, clip paths, runtime polygon construction, runtime atlas rasterization, or DOM growth.
- Keep the first 600 frames in each bank source-authoritative. The exact-state rewind is a prepared presentation envelope and must not be described as native behavior.
- Native state or visual claims require the pinned headless CGL harness at revision `906693799e4fb7581436590cf84ecb2d3c9186ba`.
- Keep source checkouts, native binaries, captures, and generated prepared assets ignored.
