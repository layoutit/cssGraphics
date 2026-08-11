import { buildCssmengerFirstSliceScene } from "./sceneBuilder.mjs";
import { resolveCssmengerDataSource } from "./dataSource.mjs";
import { writeCssmengerPreparedOutput } from "./writeManifest.mjs";

export async function prepareCssmenger(options = {}) {
  const dataSource = await resolveCssmengerDataSource({ dataRoot: options.dataRoot });
  const sceneIds = options.scene ? [options.scene] : ["depth-3", "depth-2"];
  const scenes = [];
  for (const sceneId of sceneIds) {
    scenes.push(await buildCssmengerFirstSliceScene({ dataSource, sceneId }));
  }
  return writeCssmengerPreparedOutput({
    scenes,
    defaultSceneId: options.scene ?? "depth-3",
    warnings: scenes.flatMap((scene) => scene.warnings),
  });
}
