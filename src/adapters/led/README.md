# LED

A looped extraction of the three-dimensional LED draw from Agustin
Capeletto's entry for Ben Evans's CSS LED challenge.

The css.graphics adapter intentionally contains only the animation. It omits
the challenge page header, the 2D/3D controls, hover interaction, CodePen
packaging, measurement tools, and experimental variants from `/fed/cssled`.

The scene mounts one retained DOM tree. CSS owns a 9.1-second loop: the
four-and-a-half-second source light sequence, the same cues in reverse, and a
100-millisecond fully dark beat. Runtime JavaScript does not construct
animation frames.

```sh
pnpm dev:led
pnpm test:led
pnpm build:led
pnpm test:led:browser
```
