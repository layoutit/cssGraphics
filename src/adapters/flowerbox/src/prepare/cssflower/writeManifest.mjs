import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  generatedPublicRoot,
  generatedScenePath,
  generatedSceneUrl,
  manifestPath,
} from "./paths.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";

export async function writeCssflowerPreparedOutput({
  title = "cssFlower — Microsoft Flower Box",
  scenes,
  defaultSceneId,
  warnings = [],
  debugApi = "window.__cssFlowerDebug",
} = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("writeCssflowerPreparedOutput requires at least one prepared scene.");
  }
  await mkdir(generatedPublicRoot, { recursive: true });
  const manifestScenes = [];
  for (const scene of scenes) {
    await writeJsonAtomic(generatedScenePath(scene.id), scene);
    const snapshot = snapshotEntryForScene(scene);
    manifestScenes.push({
      id: scene.id,
      label: scene.label,
      sceneUrl: generatedSceneUrl(scene.id),
      ...snapshot,
      metrics: scene.metrics ?? {},
      warnings: scene.warnings ?? [],
    });
  }
  const defaultId = defaultSceneId ?? scenes[0].id;
  const manifest = {
    schema: "cssflower-manifest@1",
    status: "ready",
    title,
    artifactMode: "prepared-polycss-snapshot",
    scaffoldMode: "model-viewer",
    generatedAssetRoot: "/cssflower/",
    defaultScene: { id: defaultId },
    scenes: manifestScenes,
    source: scenes[0].source,
    sourceProfileId: scenes[0].sourceProfile?.id,
    renderer: scenes[0].renderer,
    metrics: scenes[0].metrics,
    oracle: scenes[0].oracle,
    assets: {
      transforms: scenes[0].playback?.transformAsset,
      lighting: scenes[0].lighting,
      stateEvidenceUrl: scenes[0].playback?.stateEvidenceUrl,
    },
    warnings,
    runtime: {
      debugApi,
      routeContract: "?scene=<scene-id>",
    },
  };
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, manifest };
}

function snapshotEntryForScene(scene) {
  if (scene.snapshotUrl) {
    return {
      snapshotUrl: scene.snapshotUrl,
      snapshotKind: scene.snapshotKind ?? "polycss-exported-html",
      artifactKind: "prepared-polycss-snapshot",
    };
  }
  if ("prepared-polycss-snapshot" !== "prepared-polycss-snapshot") return {};
  return {
    snapshotUrl: "/cssflower/scenes/" + scene.id + ".polycss.html",
    snapshotKind: "polycss-exported-html",
    artifactKind: "prepared-polycss-snapshot",
  };
}

async function writeJsonAtomic(path, value) {
  assertNoBrowserPathLeaks(value);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, path);
}
