export const cssgearsSlicePlan = {
  schema: "polycss-port-slice-plan@1",
  title: "cssGears — XScreenSaver Gears",
  slug: "cssgears",
  mode: "model-viewer",
  artifactMode: "prepared-polycss-snapshot",
  referenceHarness: "source-dump",
  defaultSceneId: "fixed-non-planetary",
  firstSlice: {
    kind: "prepared-seeded-native-rigid-multi-root-assembly-bank",
    label: "One startup-selected assembly from a deterministic bank of native XScreenSaver non-planetary assemblies",
    routeContract: "/ random prepared bank entry; ?scene=<scene-id> explicit",
    expectedInputs: [
      "seeded pinned gears.c assembly state and motion",
      "pinned involute.c geometry",
      "pinned normals.c helpers",
      "pinned rotator.c and yarandom.c source state"
],
    cameraIntent: "source 30-degree perspective with prepared lit three-quarter framing derived from the seeded no-spin/no-wander orientation",
  },
  formatHints: [
    "pinned-c-source",
    "headless-opengl-call-capture",
    "prepared-source-transform-segment"
],
};

export function describeFirstSlice() {
  return cssgearsSlicePlan.firstSlice.label + " (" + cssgearsSlicePlan.mode + ", " + cssgearsSlicePlan.artifactMode + ")";
}
