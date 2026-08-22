# Flocks source notice

This adapter is a source-informed PolyCSS recreation of **Flocks** by Terence M. Welsh.

- Upstream: <https://github.com/reallyslickscreensavers/reallyslickscreensavers>
- Revision: `a419fc4ecf4b9b19526448bf9f5dfc435e24ca4c`
- Source path: `src/flocks/flocks.cpp`
- Source SHA-256: `0db819da1d123ad4ae2cf5f53bec278e64b2f65ecabe617a843197446c1813d6`
- Source license: GNU General Public License, version 2 or later

The adapter ports the source defaults, seeded leader/follower motion, hue following, velocity orientation, stretch calculation, and geometry-one topology. Browser product profiles use explicit deterministic prefixes of the source-ordered bug population; they do not change or relabel the source default of 4 leaders plus 1000 followers.

Prepared-product deviations:

- OpenGL/GLU rendering is replaced by six PolyCSS solid triangles per bug.
- Dynamic OpenGL lighting/specular response is replaced by fixed per-face flat-light factors.
- Exact source hue remains in the prepared stream, but its rank is presented through the same three-color analogous palette bank and weighted session cycle as Cyclone.
- Every source transform state is published at 60 Hz, while each retained root's prepared color is published on one of five staggered phases (12 Hz per root) to bound repaint work.
- The exact-source bank lasts 216 seconds. Its final 8 seconds are followed by a prepare-only cubic-Hermite correspondence bridge so the retained roots can loop without the source stream's discontinuous restart.
- Source-optional dot, line, Chromatek, and connection modes are not exposed on the default route.

The compiled native oracles include the pinned upstream source and qualify state evolution, GL transforms, GLU topology, winding, camera projection, and the numbered native reference sequence. Native/browser RGB results are diagnostic, not a visual-parity claim, because the shared product palette and accepted flat-lighting system intentionally differ from source OpenGL lighting. Physical-device mobile cadence has not been qualified.

This adapter is distributed under GPL-2.0-or-later. The GPL version 2 terms are included at `src/adapters/electropaint/LICENSE.GPL-2.0`; the pinned rsMath and Rgbhsl dependencies are LGPL-2.1-or-later as recorded in `notes/references/source-lock.json`.
