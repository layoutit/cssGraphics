# Gears

A source-backed retained-DOM PolyCSS port of XScreenSaver `gears.c` at pinned
revision `906693799e4fb7581436590cf84ecb2d3c9186ba`.

The product bank contains 24 prepared, three-gear assemblies in one retained
snapshot. Each assembly enters from three distinct prepared viewport edges
without crossing, locks, spins for 15 seconds, and exits along the same paths.
A cryptographic shuffled bag selects the next prepared assembly without an
immediate repeat. Runtime publishes prepared gear-root transforms and three
short bank classes over stable DOM. Geometry, ratios, phase, camera, lighting,
edge selection, interpolation, and DOM growth remain prepare-time work.

Prepared scenes and snapshots are gzip-bound files. Startup fetches the chosen
scene and retained snapshot first, begins playback, then fills the remaining
bank through a four-request cached background queue. A static loading mark is
shown during the initial fetch; the model path still uses no CSS keyframes.

Below 600px the runtime selects each scene's prepared portrait orientation and
uses the cssPipes cover presentation. It does not calculate an orientation.

From the repository root:

```sh
pnpm install
pnpm prepare:gears:artifact
pnpm build:gears
pnpm dev:gears
```

Open <http://127.0.0.1:5173/>. The production route is
<https://css.graphics/gears/>.

To reproduce the bank from source on macOS, place the pinned XScreenSaver
checkout at `.local/xscreensaver` or set `CSSGEARS_SOURCE_ROOT`, then run:

```sh
pnpm prepare:gears:source
pnpm test:gears
pnpm test:gears:assets
pnpm test:gears:browser
```

This is the first public Gears contract. There are no legacy manifests,
compatibility readers, migrations, or runtime fallbacks.

The prepared product archive is hash-bound by `prepared-bank.lock.json` and is
unpacked into static files during deployment. The upstream checkout, native
binaries, captures, traces, oracle packets, and generated browser assets are
not committed. See [`notes/provenance-bible.md`](notes/provenance-bible.md).
