import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import {
  CSSPIPES_MANIFEST_PATH,
  CSSPIPES_PREPARE_SCENE_PATH,
  CSSPIPES_PREPARE_SNAPSHOT_PATH,
  CSSPIPES_SCENE_PATH,
  CSSPIPES_SNAPSHOT_PATH,
} from "./paths.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function writeCssPipesManifest(scene, snapshotMetrics) {
  const [prepareSceneBytes, snapshotBytes] = await Promise.all([
    readFile(CSSPIPES_PREPARE_SCENE_PATH),
    readFile(CSSPIPES_PREPARE_SNAPSHOT_PATH),
  ]);
  const prepareScene = JSON.parse(prepareSceneBytes.toString("utf8"));
  if (!Array.isArray(prepareScene.pipeMeshes) ||
      prepareScene.pipeMeshes.length !== prepareScene.playback?.pipeCount) {
    throw new Error("Prepared cssPipes snapshot geometry is incomplete");
  }
  const { pipeMeshes: _prepareOnlyPipeMeshes, ...runtimeScene } = prepareScene;
  const runtimeSceneBytes = Buffer.from(`${JSON.stringify(runtimeScene)}\n`);
  const compressedScene = gzipSync(runtimeSceneBytes, { level: 9 });
  const compressedSnapshot = gzipSync(snapshotBytes, { level: 9 });
  const manifest = {
    schema: "csspipes-manifest@1",
    status: "ready",
    title: "cssPipes — prepared PolyCSS pipe clips",
    scaffoldMode: "original-pipes-inspired-generative-artwork",
    artifactMode: "prepared-polycss-snapshot-plus-reverse-recordings",
    generatedAssetRoot: "/csspipes/",
    defaultRoute: "/",
    defaultScene: scene.id,
    provenance: scene.provenance,
    renderer: scene.renderer,
    scenes: [{
      id: scene.id,
      label: "32 desktop + 32 mobile prepared 3D pipe clips",
      sceneUrl: "/csspipes/scenes/pipes-clips.scene.json.gz",
      sceneSha256: sha256(compressedScene),
      snapshotUrl: "/csspipes/scenes/pipes-clips.polycss.html.gz",
      snapshotSha256: sha256(compressedSnapshot),
      metrics: {
        preparedLeafCount: scene.metrics.preparedLeafCount,
        retainedRootCount: scene.metrics.retainedRootCount,
        clipCount: scene.metrics.clipCount,
        mountedLeafCount: snapshotMetrics.mountedLeaves,
        snapshotPipeRootCount: snapshotMetrics.pipeRootCount,
        snapshotShapeTargetCount: snapshotMetrics.shapeTargetCount,
        snapshotLeafTargetCount: snapshotMetrics.leafTargetCount,
        preparedBandSlotCount: snapshotMetrics.bandSlotCount,
        preparedMaterialBindingCount: snapshotMetrics.materialBindingCount,
        atlasPageCount: 1,
        unresolvedTextureCount: 0,
      },
      warnings: scene.warnings,
    }],
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const forbiddenLocalPaths = [
    ["", "Users", ""].join("/"),
    ["file:", "", ""].join("/"),
  ];
  if (forbiddenLocalPaths.some((token) => text.includes(token))) {
    throw new Error("cssPipes manifest contains a local absolute path");
  }
  await mkdir(dirname(CSSPIPES_MANIFEST_PATH), { recursive: true });
  await Promise.all([
    writeCompressed(CSSPIPES_SCENE_PATH, compressedScene),
    writeCompressed(CSSPIPES_SNAPSHOT_PATH, compressedSnapshot),
  ]);
  const temporary = `${CSSPIPES_MANIFEST_PATH}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, CSSPIPES_MANIFEST_PATH);
  await Promise.all([
    unlink(CSSPIPES_PREPARE_SCENE_PATH),
    unlink(CSSPIPES_PREPARE_SNAPSHOT_PATH),
  ]);
  return Object.freeze({ manifest, text, sha256: sha256(text) });
}

async function writeCompressed(path, bytes) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}
