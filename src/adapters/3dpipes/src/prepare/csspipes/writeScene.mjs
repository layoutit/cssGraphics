import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { buildPreparedPlaybackPackage } from "./preparedPlaybackChunks.mjs";
import { CSSPIPES_CLIPS_ROOT, CSSPIPES_PREPARE_SCENE_PATH } from "./paths.mjs";

function serializeCssPipesScene(scene) {
  const text = `${JSON.stringify(scene)}\n`;
  const forbiddenLocalPaths = [
    ["", "Users", ""].join("/"),
    ["file:", "", ""].join("/"),
  ];
  if (forbiddenLocalPaths.some((token) => text.includes(token))) {
    throw new Error("Prepared cssPipes scene contains a local absolute path");
  }
  return text;
}

export async function writeCssPipesScene(scene, outputPath = CSSPIPES_PREPARE_SCENE_PATH) {
  const prepared = buildPreparedPlaybackPackage(scene);
  const text = serializeCssPipesScene(prepared.scene);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(CSSPIPES_CLIPS_ROOT, { recursive: true });
  await Promise.all(prepared.chunks.map(async (chunk) => {
    const path = resolve(CSSPIPES_CLIPS_ROOT, basename(chunk.url));
    const temporaryChunk = `${path}.tmp`;
    await writeFile(temporaryChunk, chunk.payload);
    await rename(temporaryChunk, path);
  }));
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, outputPath);
  return Object.freeze({
    outputPath,
    bytes: Buffer.byteLength(text),
    text,
    scene: prepared.scene,
    chunkCount: prepared.chunks.length,
    chunkBytes: prepared.chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    storedChunkBytes: prepared.chunks.reduce(
      (total, chunk) => total + chunk.storedBytes,
      0,
    ),
  });
}
