export const PORT_FORMAT_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "maze3d-native-state-json",
    source: "native/maze3d-state.c",
    role: "headless exact maze generation, placement, and camera state dump",
  }),
  Object.freeze({
    id: "xscreensaver-png-textures",
    extensions: Object.freeze([".png"]),
    role: "byte-verified local wall, floor, and ceiling inputs",
  }),
]);
