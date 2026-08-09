import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const adapterRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const CSSMAZE_REPO_ROOT = adapterRoot;

export function generatedPublicDirectory() {
  return resolve(
    process.env.CSSMAZE_GENERATED_PUBLIC_DIR ??
      join(repositoryRoot, "build/generated/public"),
  );
}

export function generatedProductRoot() {
  return join(generatedPublicDirectory(), "cssmaze");
}

export function generatedPrivateDirectory() {
  return resolve(
    process.env.CSSMAZE_GENERATED_PRIVATE_DIR ??
      join(repositoryRoot, "build/generated/private"),
  );
}

export function generatedPrivateProductRoot() {
  return join(generatedPrivateDirectory(), "cssmaze");
}

export function generatedScenePath(sceneId) {
  return join(generatedProductRoot(), "scenes", `${sceneId}.json`);
}

export function generatedPreparedScenePath(sceneId) {
  return join(generatedPrivateProductRoot(), "scenes", `${sceneId}.prepared.json`);
}

export function generatedCompressedScenePath(sceneId) {
  return join(generatedProductRoot(), "scenes", `${sceneId}.json.gz`);
}

export function generatedSceneUrl(sceneId) {
  return `/cssmaze/scenes/${sceneId}.json.gz`;
}

export function generatedSourceSceneUrl(sceneId) {
  return `/cssmaze/scenes/${sceneId}.json`;
}

export function generatedSnapshotPath(sceneId) {
  return join(generatedProductRoot(), "scenes", `${sceneId}.polycss.html`);
}

export function generatedSnapshotUrl(sceneId) {
  return `/cssmaze/scenes/${sceneId}.polycss.html.gz`;
}

export function generatedCompressedSnapshotPath(sceneId) {
  return join(generatedProductRoot(), "scenes", `${sceneId}.polycss.html.gz`);
}

export function manifestPath() {
  return join(generatedProductRoot(), "manifest.json");
}

export function localBuildRoot() {
  return resolve(
    process.env.CSSMAZE_NATIVE_BUILD_ROOT ??
      join(repositoryRoot, ".local/cssmaze"),
  );
}
