# Saturn provenance

## Product source

The adapter is taken from the 3D CSS Saturn pen
(`https://codepen.io/alowpoly/pen/XJMVyXW`) as built on 2026-10-09: its
`pen.html` and `pen.css`, written by `output/codepen/saturn/build/build-nojs.mts`
in the css.earth checkout. That pen is css.earth's Saturn page as it serves it
with script off (`https://css.earth/saturn/?dataset=normal`), reduced to one
stylesheet and one short markup file.

The sources and credits of css.earth's Saturn apply and are listed on that
page, which the public project metadata links. `source-lock.json` names the pen,
the page and the eight pictures.

## Preserved scene facts

- Six layers painted in the order written, each with the same lens and tilt: far
  half of the rings, inner fill, polar caps and globe, limb, near half of the
  rings, moons.
- Globe: 448 faces in 14 bands of 32, one `matrix3d` per band and one turn about
  the pole per column. Four polar cap faces.
- Camera: `perspective: min(200cqw, 338.8889cqh, 3840px)`, the scene tilted 40
  degrees.
- Motion: the globe turns once in 72 seconds, the rings in 68.7 seconds, and
  Mimas, Enceladus, Tethys, Dione and Rhea take 154.2 to 739.3 seconds an orbit.
- Light: the Sun 10 degrees north and 50 degrees to the left, as three layers of
  the limb leaf (limb shading, night side, rings' shadow) and the planet's
  shadow on the rings.
- Zoom: 1,640 px of scroll, open at 1,200 px.
- Smaller ring and orbit boxes on touch screens and small windows.

## Deliberate product changes

- The pen's header and its eight switches are omitted, with their checkboxes and
  rules. Their reduced-motion rule went with the Motion switch.
- The page rules (`html`, `body`) became the stage's: every rule is nested under
  `.csssaturn-stage`, and keyframes and the scroll timeline carry the
  `csssaturn-` prefix.
- The scroll surface is placed at its opening by the mount script, in place of
  the pen's `autofocus`; its `scroll-initial-target` stays.
- The animations pause through an `is-paused` class while the page is hidden.
- Two forms the site build's CSS minifier breaks are written another way: the
  rings' `scale` is inside their `transform` (beside a `transform` it was
  dropped), and the zoom's `animation-timeline` has a rule of its own (beside
  `animation` it was folded into a shorthand no browser reads).
