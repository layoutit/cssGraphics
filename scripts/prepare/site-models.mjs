import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const modelIds = [
  "animated-morph-sphere",
  "webgl-morphtargets",
  "morph-stress-test",
];

for (const modelId of modelIds) {
  const modelDirectory = resolve(
    repoRoot,
    "site/public/models",
    modelId,
  );
  const wrapper = JSON.parse(
    await readFile(resolve(modelDirectory, "model.json"), "utf8"),
  );
  const model = structuredClone(
    wrapper.sections?.structure?.polyMorphModel ?? wrapper,
  );

  delete model.render.cssText;
  for (const clip of model.animations) {
    for (const channel of clip.channels) {
      if (channel.target === "shape-matrix") channel.interpolation = "step";
    }
  }

  await writeFile(
    resolve(modelDirectory, "runtime.json"),
    `${JSON.stringify(model)}\n`,
  );
  console.log(`prepared site/public/models/${modelId}/runtime.json`);
}
