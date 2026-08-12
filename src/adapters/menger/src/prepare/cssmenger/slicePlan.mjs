export const cssmengerSlicePlan = Object.freeze({
  schema: "polycss-port-slice-plan@1",
  title: "cssMenger — XScreenSaver Menger",
  slug: "cssmenger",
  mode: "spatial-document",
  artifactMode: "prepared-polycss-snapshot",
  referenceHarness: "source-dump",
  defaultSceneId: "depth-3",
  firstSlice: Object.freeze({
    kind: "procedural-spatial-object",
    label: "One deterministic depth-3 source-ordered Menger sponge with a prepared XScreenSaver rotation/color segment",
    routeContract: "/",
    expectedInputs: Object.freeze(["hacks/glx/menger.c", "colors.c/h", "hsv.c/h", "rotator.c/h", "yarandom.c/h"]),
    cameraIntent: "XScreenSaver 30 degree perspective at a fixed 960x600 viewport",
  }),
  formatHints: Object.freeze(["c-source-algorithm"]),
});

export function describeFirstSlice() {
  return cssmengerSlicePlan.firstSlice.label;
}
