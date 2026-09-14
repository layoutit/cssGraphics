# LED provenance

## Product source

The adapter is extracted from the working CSS scene in
`/Users/ekrof/fed/cssled`, based on repository revision
`08792e7a96f4d201c4885d5accc31b5467dbfcee` and the exact working-tree files
recorded in `source-lock.json`.

That scene was created by Agustin Capeletto for Ben Evans's CSS LED challenge.
Ben's original Pure CSS LED Playboard remains credited and linked in the
public project metadata.

## Preserved animation facts

- Three 9 by 9 LED faces.
- Cyan front, magenta right, and white top light paths.
- Source cue ordering, 90/120 millisecond cue spacing, face offsets, repeated
  strokes, room spill, wall backlight, and 4,500 millisecond close time.
- Source camera transform: `rotateX(-25deg) rotateY(-45deg) scale3d(.7,.7,.7)`.

## Deliberate product changes

- The animation is always in the 3D presentation.
- The interactive playboard, view controls, page header, and hover response are
  omitted.
- The source's exact retained `<u><i></i><b></b></u>` hierarchy and separate
  ambient, wall, floor, and cube blend layers are preserved; only their
  selectors are scoped to the css.graphics stage.
- The one-shot animation is mirrored into a 9,100 millisecond loop: 4,500
  milliseconds forward, the same cue timing in reverse, and a 100-millisecond
  fully dark beat before the next draw.
