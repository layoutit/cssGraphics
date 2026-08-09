import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const adapterRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const repoRoot = repositoryRoot;
export const localRoot = join(repositoryRoot, ".local", "cssmenger");
export const generatedRoot = resolve(
  process.env.CSSMENGER_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
export const generatedPublicRoot = join(generatedRoot, "public", "cssmenger");
export const generatedSceneDir = join(generatedPublicRoot, "scenes");
export const generatedPrivateRoot = join(generatedRoot, "private", "cssmenger");
export const manifestPath = join(generatedPublicRoot, "manifest.json");

export function generatedScenePath(sceneId) {
  return join(generatedSceneDir, sceneId + ".json");
}

export function generatedSceneUrl(sceneId) {
  return "/cssmenger/scenes/" + sceneId + ".json";
}

export function generatedSnapshotPath(sceneId) {
  return join(generatedSceneDir, sceneId + ".polycss.txt");
}

export function generatedSnapshotUrl(sceneId) {
  return "/cssmenger/scenes/" + sceneId + ".polycss.txt";
}
