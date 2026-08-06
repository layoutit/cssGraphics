import { buildCssPipesScene } from "./sceneBuilder.mjs";
import {
  buildPipeSpaceTexelLighting,
  writePipeSpaceTexelLighting,
} from "./preparedLighting.mjs";
import { writeCssPipesScene } from "./writeScene.mjs";

export async function prepareCssPipesScene() {
  const lightingBundle = buildPipeSpaceTexelLighting();
  const scene = await buildCssPipesScene({ lightingBundle });
  const lighting = await writePipeSpaceTexelLighting(lightingBundle);
  if (lighting.contract.assetSha256 !== scene.lighting.assetSha256) {
    throw new Error("Prepared cssPipes space-texel lighting drifted while writing");
  }
  const output = await writeCssPipesScene(scene);
  return Object.freeze({ scene, output, lighting });
}
