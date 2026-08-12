# cssMenger

A source-backed retained-DOM PolyCSS port of XScreenSaver `menger`.

The implemented first slice is a deterministic depth-3 sponge prepared from
the pinned XScreenSaver 6.15 source semantics. Preparation generates the exact
18,048 visible source-face census, proves the 9,528-leaf minimum rectangular
fallback, then prebakes its holes into 84 coverage-proven directional-plane
atlas bundles. It prepares 1,536 rotator/palette states and exports one stable
PolyCSS snapshot with only camera/scene projection roots and 84 direct leaves.
Preparation bakes moving two-light color into one Q83 AVIF atlas, byte-dedupes
its source-cell tiles, and emits one forward exact delta address schedule. The
first 995 states retain the native rotator exactly; preparation then closes the
sequence into a 46.08 second C2 forward cycle with continuous orientation,
velocity, acceleration, and palette cadence. The compositor publishes prepared
rotation every 30 ms. Default lighting is held for 60 ms; the CSS-opacity
presentation publishes prepared lighting every 30 ms. Runtime performs no
lighting math, geometry, merging, address comparison, or DOM construction.

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
intentionally diverge because the prepared browser product trades Q83 atlas
encoding, prepared cycle closure, and profile-specific lighting cadence for
lower transfer and runtime work, so native visual parity remains unqualified.
