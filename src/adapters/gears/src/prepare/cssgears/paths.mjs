import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const adapterRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const localRoot = join(repositoryRoot, ".local", "cssgears");
export const generatedRoot = resolve(
  process.env.CSSGEARS_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
export const generatedPublicRoot = join(generatedRoot, "public", "cssgears");
export const generatedSceneDir = join(generatedPublicRoot, "scenes");
export const manifestPath = join(generatedPublicRoot, "manifest.json");

export function generatedScenePath(sceneId) {
  return join(generatedSceneDir, sceneId + ".json");
}

export function generatedSceneUrl(sceneId) {
  return "/cssgears/scenes/" + sceneId + ".json";
}
