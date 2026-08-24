# cssGalaxy

This adapter prepares XScreenSaver's `hacks/galaxy.c` into one stable retained
PolyCSS point field. Each published star is one anonymous `<b>` leaf; there are
no per-star wrappers, ids, or data attributes and no Canvas, SVG, WebGL, or
alternate renderer.

Preparation compiles a small C11 oracle from the pinned source equations,
initializes every complete source galaxy, advances the native galaxy-center and
stellar-disc state in source order, applies the source projection, and only then
selects deterministic per-galaxy star prefixes. Prefix count therefore cannot
feed back into galaxy-center motion. The browser receives content-addressed,
Brotli-compressed 24-second banks of tenth-pixel coordinates expanded by HTTP. Each bank contains
six independently decodable four-second blocks using visibility bits and per-star
leaf-major, axis-separated second-difference zigzag-varint residuals; it does not ship
CSS-string dictionaries.
A Worker verifies and retains the current and next compact bank, then expands only
the current and next four-second playback blocks into prepared `translate(...)` transform strings
in two-millisecond-budgeted slices. Playback only publishes those strings to the
same retained nodes; it performs no physics, interpolation, formatting, allocation,
or DOM reconstruction. The palette and constant opacity live in the snapshot CSS.

The presentation uses the 10 strongest qualified generation-zero encounters. Every pair
in each curated three-galaxy seed must make a material close passage and
projected disc collision. Qualification is limited to the native source frames that the
product actually presents. Every incoming center must start at least 96 prepared pixels
inside the camera and every pair at least 140 pixels apart. All three source-space centers
must then fit inside one shared 40-pixel span in the same native frame. Ranking and gates also favor
sustained all-pair overlap, post-collision cohort mixing, tidal growth, and coherent
foreign-cohort orbiting around another center as a secondary-vortex signal.
Magenta, cyan, and off-white presentation families
are derived from native palette-reference seed 4946, include small deterministic hue
variance, and clear a 7:1 black-background contrast floor. The off-white family
is deliberately near-neutral and brighter than the chromatic families so its
small points read as white instead of beige. Point footprint is presentation-only:
one CSS pixel on DPR-1 displays and 2 CSS pixels on DPR-2-and-higher displays,
without changing or duplicating prepared motion banks.

The source's native reset is abrupt after 1,001 frames. The endless browser reel
is an intentional presentation override: each encounter plays native-derived
motion from frames 0–409 over nine seconds, then the same retained leaves follow
a prepared three-second velocity-matched cubic bridge into the next three discs.
Nothing fades, stops, remounts, or changes identity. The 10 twelve-second encounters
span five full 24-second transport banks,
forming a continuous 120-second stream. Curated encounters constrain closest
approach to native frames 180–320 so formation, collision, and dispersal stay balanced.
The browser chooses the starting encounter from a session-persistent
cryptographically shuffled bag, visiting all 10 prepared encounters before any
starting seed repeats. Continuous playback also shows each encounter exactly once
before the 120-second prepared stream closes.

Run locally:

```sh
pnpm prepare:galaxy
pnpm test:galaxy
pnpm build:galaxy
pnpm dev:galaxy --port 4199
```

Build the scoped public route and verify its copied prepared tree with:

```sh
pnpm build:galaxy:deploy
pnpm test:galaxy:deploy
```

The retained-DOM product has one canonical local route, `/`, and one deployed
route, `/galaxy/`. It always plays
the qualified three-galaxy, 1,500-leaf stream with display-responsive points, fixed camera,
and unit zoom. Seed 2298 is the prepared transport lead, while startup is selected
from the 10 prepared qualified encounters without URL controls. Qualification variants remain preparation evidence
and are not exposed through the product runtime or copied into its public payload.

Source identity is pinned in
[`notes/references/source-lock.json`](notes/references/source-lock.json), and
license/presentation boundaries are documented in [`NOTICE.md`](NOTICE.md).
Preparation verifies an existing local source checkout or downloads the exact
pinned GitHub revision and rejects any SHA-256 mismatch.
Native C11 projection bytes are authoritative for prepared browser assets. The
independent JavaScript equation model is diagnostic and diverges at floating
point bit level; it is not the asset generator. Native pixel parity is not
claimed for the intentional colors, prefix selection, fixed presentation
camera, or identity-preserving reformation.
