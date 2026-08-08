import { buildCssmengerFirstSliceScene } from "./sceneBuilder.mjs";
import { resolveCssmengerDataSource } from "./dataSource.mjs";
import { writeCssmengerPreparedOutput } from "./writeManifest.mjs";

export async function prepareCssmenger(options = {}) {
  const dataSource = await resolveCssmengerDataSource({ dataRoot: options.dataRoot });
  const scene = await buildCssmengerFirstSliceScene({
    dataSource,
    sceneId: options.scene ?? "depth-3",
  });
  return writeCssmengerPreparedOutput({
    scenes: [scene],
    defaultSceneId: scene.id,
    warnings: scene.warnings,
  });
}
