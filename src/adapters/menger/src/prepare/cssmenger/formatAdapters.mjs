export const PORT_FORMAT_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "xscreensaver-menger-c",
    entry: "hacks/glx/menger.c",
    support: Object.freeze([
      "utils/colors.c",
      "utils/hsv.c",
      "hacks/glx/rotator.c",
      "utils/yarandom.c",
    ]),
    behavior: "recursive face-mask traversal plus prepared color and rotator state",
  }),
]);
