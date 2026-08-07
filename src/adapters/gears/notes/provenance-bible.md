# cssGears provenance bible

Status: 24 seeded non-planetary source-native assemblies qualified; product
camera and prepared lighting accepted without claiming pixel parity
Last verified: 2026-08-07
Target: XScreenSaver `gears` at
`906693799e4fb7581436590cf84ecb2d3c9186ba`
Renderer: retained-DOM PolyCSS only

## Product contract

Preparation verifies the pinned XScreenSaver source closure and uses the real
`gears.c`, `involute.c`, `normals.c`, `rotator.c`, and `yarandom.c` paths to
capture 24 deterministic, non-planetary three-gear assemblies. It prepares
geometry, native-positive gear phase, source timing, camera presentation,
fixed-eye-space lighting, source-face-preserving render bundles, and every
showreel transform.

Each bank entry has 720 prepared source-motion states and a 580-state product
showreel: 40 entry states, 500 spin states covering 15 seconds, and 40 exit
states. Preparation chooses three distinct viewport edges and rejects crossing
paths before the product bank is written. One snapshot retains 35,710 leaves,
three stable gear roots, and one active scene at a time. Hidden scene leaves
are not painted; bank switches write only the three short root classes.

Preparation also maps every scene into a right-facing product envelope with
source-derived pitch from 16–32 degrees and yaw from 22–38 degrees, then bakes
lighting for that exact view. Below 600px, runtime selects the scene's prepared
portrait orientation and cssPipes-style cover presentation.

The outer app shell uses the cssPipes background gradient. The model path uses
no CSS keyframes and performs no runtime interpolation, geometry, lighting,
ratio, phase, camera, edge-selection, leaf-style, or DOM-growth work.

This is the first deployed Gears contract. Only the current manifest, scene,
showreel, lighting, and player schemas are accepted. There are no legacy
readers, migrations, compatibility branches, or unknown-scene fallbacks.

## Authority order

1. Byte-identified XScreenSaver sources in `source-lock.json`.
2. Reproducible seeded source-native CGL state and frame captures.
3. Source-ordered polygon calls from pinned `involute.c` and `normals.c`.
4. Independently authored preparation, coordinate mapping, and contract tests.
5. Hash-locked browser-safe prepared product bank.
6. Browser smoke, performance, and native/browser comparison evidence.

## Rights and public-data boundary

Every upstream file used by the seeded native closure carries a permissive
permission-to-use, copy, modify, and distribute notice. The upstream checkout,
compiled helpers, native frames, state captures, traces, and oracle packets
remain local and ignored. The public product archive contains independently
authored code output and browser-safe prepared results only.

The product archive is published separately and bound by byte length, SHA-256,
unpacked closure hash, descriptor hash, scene counts, retained-root counts, and
timeline counts. Deployment downloads and verifies it before unpacking static
files; the browser never downloads the archive.

## Proven and pending

Proven locally:

- exact hashes for the twelve-file seeded source closure;
- exact source-native gear parameters and initial transforms for all 24
  selected seeds;
- exact source polygon-call census and source-face coverage;
- 24 720-state prepared motion tables using source draw-then-add semantics;
- 24 non-crossing 580-state enter/spin/exit showreels;
- prepared winding consistent with native `GL_CCW` backface culling;
- static prepared lighting atlases with no runtime lighting publication;
- stable retained DOM with three gear roots, no nested face elements, no data
  attributes, and zero runtime DOM growth;
- deadline-scheduled prepared publication with no catch-up work.

Pending:

- strict native/browser pixel-parity qualification for the accepted product
  camera and lighting presentation.

Native/browser visual comparisons remain evidence, not a pixel-parity claim.
