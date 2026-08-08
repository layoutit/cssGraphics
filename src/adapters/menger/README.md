# cssMenger

A source-backed retained-DOM PolyCSS port of XScreenSaver `menger`.

The implemented first slice is a deterministic depth-3 sponge prepared from
the pinned XScreenSaver 6.15 source semantics. Preparation generates the exact
18,048 visible source-face census, proves the 9,528-leaf minimum rectangular
fallback, then prebakes its holes into 84 coverage-proven directional-plane
atlas bundles. It prepares 1,440 rotator/palette states and exports one stable
PolyCSS snapshot. The browser adopts that snapshot and publishes prepared root
transform and axis-atlas rows only.

```sh
pnpm install
CSSMENGER_SOURCE_ROOT=/path/to/pinned/xscreensaver pnpm prepare:menger:source
pnpm test:menger
pnpm test:menger:assets
pnpm build:menger
pnpm test:menger:browser
CSSMENGER_SOURCE_ROOT=/path/to/pinned/xscreensaver pnpm oracle:menger
```

The source checkout must be at commit
`906693799e4fb7581436590cf84ecb2d3c9186ba`. Generated assets, source
checkouts, screenshots, and oracle evidence stay ignored locally.

The oracle follows the cssFlower exact-first shape over native/browser ticks
0-45: exact source binding, native state and frame A/A, browser frame A/A,
exact source-state comparison, and native/browser/absolute-diff artifacts.
Source state is exact and both A/A gates are pixel-exact. Native/browser pixels
still diverge because the browser has not yet prepared the native moving
fixed-function lighting, so native visual parity remains unqualified.
