import {
  buildCssflowerFirstSliceScene,
} from "./sceneBuilder.mjs";
import { compilePreparedCssflowerCycle } from "./compilePreparedCycle.mjs";
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

export async function prepareCssflower(options = {}) {
  const dataSource = await resolveCssflowerDataSource({
    nativeRoot: options.nativeRoot,
  });
  const sceneId = options.scene ?? "default-cube";
  const lightingPageStore = await createCssflowerPreparedLightingPageStore();
  const compiled = await compilePreparedCssflowerCycle({
    nativeAuthorityStatus: dataSource?.nativeAuthorityStatus ?? "missing",
    readLightingPage: lightingPageStore.read,
    writeLightingPage: lightingPageStore.write,
  });
  const assets = await writeCssflowerPreparedAssets(compiled, { lightingPageStore });
  const { scene } = await buildCssflowerFirstSliceScene({
    compiled,
    dataSource,
    preparedAssets: assets,
    sceneId,
  });
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
