import { CssPipesContractError, nonEmptyString, object, safeGeneratedUrl } from "./types.mjs";
import { readPreparedJson } from "./preparedResponse.mjs";

export function validateCssPipesManifest(input) {
  const manifest = object(input, "cssPipes manifest");
  if (manifest.schema !== "csspipes-manifest@1" || manifest.status !== "ready") {
    throw new CssPipesContractError("cssPipes manifest is not a ready v1 manifest");
  }
  const defaultScene = nonEmptyString(manifest.defaultScene, "manifest.defaultScene");
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    throw new CssPipesContractError("cssPipes manifest has no prepared scenes");
  }
  const ids = new Set();
  const scenes = manifest.scenes.map((entry, index) => {
    const scene = object(entry, `manifest.scenes[${index}]`);
    const id = nonEmptyString(scene.id, `manifest.scenes[${index}].id`);
    if (ids.has(id)) throw new CssPipesContractError(`Duplicate manifest scene ${id}`);
    ids.add(id);
    return Object.freeze({
      ...scene,
      id,
      sceneUrl: safeGeneratedUrl(scene.sceneUrl, `manifest.scenes[${index}].sceneUrl`),
      snapshotUrl: safeGeneratedUrl(scene.snapshotUrl, `manifest.scenes[${index}].snapshotUrl`),
    });
  });
  if (!ids.has(defaultScene)) {
    throw new CssPipesContractError("manifest.defaultScene does not name a prepared scene");
  }
  return Object.freeze({ ...manifest, defaultScene, scenes: Object.freeze(scenes) });
}

export async function loadCssPipesManifest(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response?.ok) throw new CssPipesContractError(`Manifest request failed (${response?.status ?? "network"})`);
  return validateCssPipesManifest(await response.json());
}

export function selectDefaultScene(manifest) {
  const scene = manifest.scenes.find((candidate) => candidate.id === manifest.defaultScene);
  if (!scene) throw new CssPipesContractError("Prepared default scene is missing");
  return scene;
}

export async function loadCssPipesScene(descriptor, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(descriptor.sceneUrl, { cache: "no-store" });
  if (!response?.ok) {
    throw new CssPipesContractError(`Prepared scene request failed (${response?.status ?? "network"})`);
  }
  const scene = descriptor.sceneUrl.endsWith(".gz")
    ? await readPreparedJson(response)
    : await response.json();
  if (scene.schema !== "csspipes-prebaked-scene@12" || scene.id !== descriptor.id) {
    throw new CssPipesContractError("Prepared cssPipes scene does not match its manifest descriptor");
  }
  return Object.freeze({
    ...scene,
    snapshotUrl: descriptor.snapshotUrl,
    manifestMetrics: descriptor.metrics,
  });
}
