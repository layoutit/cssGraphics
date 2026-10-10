# Saturn

Saturn from [css.earth](https://css.earth/saturn/), as prepared for the
[3D CSS Saturn](https://codepen.io/alowpoly/pen/XJMVyXW) pen: a globe of 448
faces with its polar caps, the rings with the planet's shadow on them, the limb
shading with the night side and the rings' shadow, and five moons on their
orbits.

The css.graphics adapter contains only the scene. It omits the pen's header and
its eight switches (Textures, Limb, Shadows, Fill, Features, Motion, Perspective
and Mesh) with every rule they drove.

The scene mounts one retained DOM tree and CSS draws and moves all of it: the
globe's spin, the rings' turn and the moons' orbits are CSS animations, and the
scroll zoom is a scroll timeline. Runtime JavaScript mounts the markup, opens the
scroll surface at the scene's own framing and pauses the animations while the
page is hidden. It does not construct frames. The zoom is off on touch screens
and in browsers without scroll timelines.

The eight pictures load from css.earth's asset host
(`notes/source-lock.json`).

```sh
pnpm dev:saturn
pnpm test:saturn
pnpm build:saturn
pnpm test:saturn:browser
```
