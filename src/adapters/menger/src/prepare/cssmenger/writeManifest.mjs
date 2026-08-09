import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generatedPublicRoot,
  generatedScenePath,
  generatedSceneUrl,
  manifestPath,
} from "./paths.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";
import { preparedMengerPlaneAtlasBytes } from "./preparedPlaneAtlas.mjs";

export async function writeCssmengerPreparedOutput({
  title = "cssMenger — XScreenSaver Menger",
  scenes,
  defaultSceneId,
  warnings = [],
  debugApi = "window.__cssMengerDebug",
} = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("writeCssmengerPreparedOutput requires at least one prepared scene.");
  }
  await mkdir(generatedPublicRoot, { recursive: true });
  const manifestScenes = [];
  for (const scene of scenes) {
    await writePreparedPlaneAtlas(scene.planeAtlas);
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
    schema: "cssmenger-manifest@1",
    status: "ready",
    title,
    artifactMode: "prepared-polycss-snapshot",
    scaffoldMode: "spatial-document",
    generatedAssetRoot: "/cssmenger/",
    defaultScene: { id: defaultId },
    scenes: manifestScenes,
    warnings,
    runtime: {
      debugApi,
      routeContract: "?scene=<scene-id>",
      geometryPayload: false,
      runtimeDomGrowth: false,
    },
  };
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, manifest };
}

async function writePreparedPlaneAtlas(atlas) {
  const bytes = preparedMengerPlaneAtlasBytes(atlas);
  if (!bytes || atlas?.schema !== "cssmenger-prepared-coplanar-plane-atlas@1" ||
      !/^\/cssmenger\/assets\/planes-[a-f0-9]{64}\.png$/u.test(atlas.assetUrl)) {
    throw new Error("Prepared cssMenger plane atlas bytes are missing or invalid");
  }
  const assetPath = join(generatedPublicRoot, atlas.assetUrl.replace(/^\/cssmenger\//u, ""));
  await mkdir(dirname(assetPath), { recursive: true });
  const temporary = `${assetPath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, assetPath);
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
    snapshotUrl: "/cssmenger/scenes/" + scene.id + ".polycss.txt",
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
