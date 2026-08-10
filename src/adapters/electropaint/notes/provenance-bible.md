# cssElectroPaint provenance

## Bound inputs

| Authority | Commit | File | SHA-256 |
| --- | --- | --- | --- |
| `srirangav/electropaintosx` | `3be67ea1562c0df573edc21e8bfa9f88e62b5b38` | `ElectropaintView.mm` | `d9ff76dbcdabac585b37875f3f9a8a43d8f690ca2a4dbc4d383ec9fb5feb81eb` |
| same | same | `README.txt` | `c74886353299157aa7f6573a63793af1efb18b0915703262a60c69bbecc77659` |
| same | same | `gpl.txt` | `204d8eff92f95aac4df6c8122bc1505f468f3a901e5a4cc08940e0ede1938994` |
| `iamralpht/elektropaintjs` | `12d5f43ab34f26eb388651de3b870800972ac96c` | `ep.js` | `cacb3616fae29e26128baf5b522caefe11d2e354198d29168b81a29e8a46c654` |
| same | same | `ep.html` | `60307c9bb0683f620be15757a41bafdbbaa763defe77676f48c80df7fecd276c` |
| `oppegard/electropaint` | `714092ad588e668bee9eb66dfdc94c66f516452b` | `src/math.ts` | `ae7b9e794fa31e4d66df24f29282bc2bb62e73bc6181631707e7fe70386e4420` |
| same | same | `package.json` | `96381dbe445bf73d133646b6d1a5632b68252ed46c1943d7bcc26a31e5df02bd` |
| same | same | `LICENSE` | `204d8eff92f95aac4df6c8122bc1505f468f3a901e5a4cc08940e0ede1938994` |

Preparation rejects commit or bound-file drift.

## Prepared interpretation

- 40 retained wings and one new wing per source tick.
- Fixed 60 Hz animation interval.
- Kent random-walk limits and stability values, with the source call order:
  radius, angle, delta angle, z delta, roll, pitch, yaw, red, green, blue.
- Cumulative z translation followed by z rotation, radial translation, yaw,
  pitch, and roll.
- 5 vmin source square at 960x540, represented as a 27 px retained CSS quad.
- CSS perspective 1000 px and a 45-degree x rotation, matching the Ralph
  retained-layer presentation of the Kent model.
- A fixed preparation seed replaces the intentionally nondeterministic upstream
  random source so generated artifacts are reproducible.

Runtime publishes prepared transform and palette ranges only. It does not run
the source random walk, generate geometry, calculate matrices, calculate color,
calculate a camera or cadence, compare all leaves, grow the DOM, or use an
alternate renderer.

## Proof boundary

- Source identity: exact pinned commits and hashes.
- Prepared state count: 64,000 in 128 continuous 500-state chunks.
- Inner chunk handoff: the next chunk's state zero is the sparse delta from the
  preceding chunk's final physical ring state; there is no inner reset.
- Retained graph: 40 stable PolyCSS `<b>` quad leaves directly under the scene, with no per-quad wrapper.
- Determinism: verified by byte-identical independent preparations.
- Native state parity: not claimed because the published bank intentionally uses
  a reproducible PRNG instead of macOS `arc4random()`.
- Native pixel parity: not claimed. A Kent-native synchronized frame oracle has
  not yet been qualified.
