# cssElectroPaint

This adapter prepares ElectroPaint, originally written by David Tristram, into
eight deterministic 64,000-state PolyCSS screensavers. Its prepared motion
model is source-bound through the Kent Rosenkoetter and Douglas McInnes macOS
port and two browser ports. One variant is selected
uniformly before any variant asset fetch. It keeps 40 stable retained CSS quads
and publishes the source 60 Hz sequence. Each 17:46.7 timeline is stored as 128
continuous 500-frame gzip chunks. Four chunks are fetched, parsed, and decoded
ahead; an inner chunk boundary is an ordinary sparse state transition, not a
reset or DOM swap. There is no Canvas, SVG, WebGL, alternate renderer, runtime
random walk, matrix calculation, camera calculation, or DOM growth.

The preparer binds three ignored source checkouts:

- `srirangav/electropaintosx` at `3be67ea1562c0df573edc21e8bfa9f88e62b5b38`
- `iamralpht/elektropaintjs` at `12d5f43ab34f26eb388651de3b870800972ac96c`
- `oppegard/electropaint` at `714092ad588e668bee9eb66dfdc94c66f516452b`

Place them at `.local/electropaint/kent-reference` and
`.local/electropaint/ralph-reference`, and
`.local/electropaint/browser-reference`, then run:

```sh
pnpm prepare:electropaint:source
pnpm prepare:electropaint:check
pnpm test:electropaint
pnpm test:electropaint:assets
pnpm test:electropaint:browser
pnpm perf:electropaint:trace
pnpm build:electropaint
```

Preparation freezes a seeded random sequence while preserving the source
parameters, call order, 40-wing history, transform order, projection, and fixed
animation interval. An ordinary runtime state performs 40 prepared transform
writes and at most one prepared color-class write. Each 64,000-state bank loops
after 1,066.7 seconds; this finite restart is not claimed to be an upstream
random-walk period.

The repository-wide deployment build uses the same checked-in source lock, then
copies only `/electropaint/` and `/cssselectropaint/` into the production site.
It does not require the ignored authority checkouts. Local source reproduction
continues to require and byte-verify those checkouts.

Source identity and deterministic preparation are verified. Native pixel parity
is not claimed; see [the provenance record](notes/provenance-bible.md).

This adapter is GPL-2.0-only and is not covered by the repository's blanket MIT
license. See [NOTICE.md](NOTICE.md).
