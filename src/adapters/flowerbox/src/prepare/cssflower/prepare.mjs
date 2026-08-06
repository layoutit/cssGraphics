import {
  buildCssflowerFirstSliceScene,
} from "./sceneBuilder.mjs";
import {
  resolveCssflowerDataSource,
} from "./dataSource.mjs";
import {
  writeCssflowerPreparedOutput,
} from "./writeManifest.mjs";
import {
  writeCssflowerPreparedAssets,
  createCssflowerPreparedLightingPageStore,
} from "./writePreparedAssets.mjs";
import { prepareCssflowerSharedFrameWindowPages } from "./sharedFramePageStore.mjs";

export async function prepareCssflower(options = {}) {
  const dataSource = await resolveCssflowerDataSource({
    nativeRoot: options.nativeRoot,
  });
  const sceneId = options.scene ?? "default-cube";
  const lightingPageStore = await createCssflowerPreparedLightingPageStore();
  const projectedPixels = await prepareCssflowerSharedFrameWindowPages({
    concurrency: options.concurrency,
    onProgress: options.onProjectedProgress,
  });
  const { scene, compiled } = await buildCssflowerFirstSliceScene({
    dataSource,
    projectedPixels,
    sceneId,
    readLightingPage: lightingPageStore.read,
    writeLightingPage: lightingPageStore.write,
  });
  const assets = await writeCssflowerPreparedAssets(compiled, projectedPixels);
  const output = await writeCssflowerPreparedOutput({
    scenes: [scene],
    defaultSceneId: scene.id,
  });
  return Object.freeze({
    ...output,
    scene,
    assets: Object.freeze({ ...assets, lightingPageCache: lightingPageStore.stats() }),
  });
}
