export const PORT_FORMAT_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "xscreensaver-gears-seeded-headless-cgl-capture",
    sourceFiles: Object.freeze([
      "hacks/glx/gears.c",
      "hacks/glx/involute.c",
      "hacks/glx/normals.c",
      "hacks/glx/rotator.c",
      "utils/yarandom.c",
    ]),
    output: "seeded-native-gear-state-and-720x720-ppm-frame",
  }),
  Object.freeze({
    id: "xscreensaver-involute-opengl-call-capture",
    sourceFiles: Object.freeze([
      "hacks/glx/involute.c",
      "hacks/glx/involute.h",
      "hacks/glx/normals.c",
      "hacks/glx/normals.h",
    ]),
    output: "source-ordered-triangle-and-quad-polygons",
  }),
]);
