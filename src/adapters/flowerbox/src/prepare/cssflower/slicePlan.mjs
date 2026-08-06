export const cssflowerSlicePlan = Object.freeze({
  schema: "polycss-port-slice-plan@1",
  title: "cssFlower — Microsoft Flower Box",
  slug: "cssflower",
  mode: "model-viewer",
  artifactMode: "prepared-polycss-snapshot",
  referenceHarness: "source-dump",
  defaultSceneId: "default-cube",
  firstSlice: Object.freeze({
    kind: "fixed-topology-deforming-model",
    label: "Microsoft Flower Box default cube, subdivision 10",
    routeContract: "/",
    expectedInputs: Object.freeze(["documented source-behavior profile", "optional owned native authority"]),
    cameraIntent: "source 45-degree square perspective from eye (0,0,3.5)",
  }),
  formatHints: Object.freeze(["procedural-cube", "prepared-float32-matrix-cycle", "prepared-space-texel-atlas"]),
});

export function describeFirstSlice() {
  return `${cssflowerSlicePlan.firstSlice.label} (${cssflowerSlicePlan.artifactMode})`;
}
