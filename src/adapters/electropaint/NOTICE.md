# ElectroPaint adapter attribution

This notice applies to `src/adapters/electropaint` and its generated browser
artifacts. It does not relicense the MIT-licensed cssGraphics core.

The motion parameters, history model, and transform order are adapted from:

- ElectropaintOSX, copyright 2004 Kent Rosenkoetter and Douglas McInnes,
  distributed under GPL version 2 or any later version; pinned source:
  <https://github.com/srirangav/electropaintosx/tree/3be67ea1562c0df573edc21e8bfa9f88e62b5b38>.
- Electropaint/JS, copyright 2013 Ralph Thomas, derived from the same GPL work;
  pinned source:
  <https://github.com/iamralpht/elektropaintjs/tree/12d5f43ab34f26eb388651de3b870800972ac96c>.
- Electropaint browser reconstruction, copyright Glenn Oppegard; the prepared
  matrix and HLS helpers are adapted from its GPL-2.0-only implementation at:
  <https://github.com/oppegard/electropaint/tree/714092ad588e668bee9eb66dfdc94c66f516452b>.

The adapter is distributed under GPL-2.0-only; see `LICENSE.GPL-2.0`. It contains
no upstream image, model, video, or executable asset. The prepared state bank is
generated locally from the source-bound motion model.

ElectroPaint names the upstream screensaver. This project is an independent CSS
port and is not endorsed by the original authors or SGI.
