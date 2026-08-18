# Cityflow adapter contract

- Read `notes/provenance-bible.md` before changing source simulation, box geometry, colors, lighting, camera, timing, or parity claims.
- Preserve the XScreenSaver simulation contract: six waves, 25 wave speed, 256 radius, 12-degree skew, 20 ms cadence, the source-supported `count` control set to 200, and only the source-emitted top, front, and right faces. The source default remains 800; do not describe 200 as that default.
- Preserve the seeded initialization, wave equation, palette, lighting, camera, and cadence. Cityflow has one prepared product bank and no runtime bank selection.
- Preparation owns the exact seeded `ya_random` initialization, palette, box census, wave phases, source lighting, native far-plane cutoff, retained Morph package, canonical transform dictionary, and typed transform/color frame tables.
- Runtime may mount the prepared graph, derive static face lighting from each prepared box transform, and apply changed prepared transform indices and palette classes. Playback must follow the merged DOMFORMAT `polycss-playback@0` precedent: timer wait, one paint-aligned callback when due, and `elapsed` catch-up. It must not calculate geometry, rasterize assets, grow the DOM, or rebuild topology during playback.
- Keep every box as one retained rigid root with exactly three solid `<b>` leaves. No Canvas, WebGL, WebGPU, SVG scene geometry, masks, clip paths, runtime atlas work, or paint-heavy CSS effects.
- Native state claims require the pinned headless C source harness at revision `906693799e4fb7581436590cf84ecb2d3c9186ba`. Native visual claims require the independent CGL frame-sequence oracle and calibrated native/browser comparison.
- Keep source checkouts, native binaries, captures, traces, and generated packages ignored.
