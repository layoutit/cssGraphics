import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import {
  CSSFLOWER_PROJECTED_ATLAS_ENCODING,
  CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE,
  CSSFLOWER_PROJECTED_ATLAS_QUALITY,
} from "../../cssflower/renderContract.mjs";
import { prepareCssflowerSharedFramePage } from "./sharedFramePages.mjs";
import { buildCssflowerSharedFramePackingCandidates } from "./sharedFramePacking.mjs";

if (!parentPort) throw new Error("Shared-frame page worker requires a parent port");

parentPort.on("message", async ({ taskId, page, avifenc }) => {
  try {
    const prepared = prepareCssflowerSharedFramePage(page);
    const encodedPackings = await encodeLossyAvifCandidates(
      buildCssflowerSharedFramePackingCandidates(prepared.atlas),
      avifenc,
    );
    const selected = encodedPackings[0];
    const atlasBytes = selected.bytes;
    const layoutBytes = Buffer.from(prepared.layout.bytes);
    parentPort.postMessage({
      taskId,
      result: {
        descriptor: {
          schema: prepared.schema,
          index: prepared.index,
          startStateIndex: prepared.startStateIndex,
          usedFrameCount: prepared.usedFrameCount,
          retainedLeafCount: prepared.retainedLeafCount,
          activeUnionLeafCount: prepared.activeUnionLeafCount,
          atlas: {
            encoding: CSSFLOWER_PROJECTED_ATLAS_ENCODING,
            mimeType: CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE,
            quality: CSSFLOWER_PROJECTED_ATLAS_QUALITY,
            packing: selected.packing,
            width: selected.width,
            height: selected.height,
            frameWidth: prepared.atlas.frameWidth,
            frameHeight: prepared.atlas.frameHeight,
            cropLeft: prepared.atlas.cropLeft,
            cropTop: prepared.atlas.cropTop,
            frameBackgroundOffsets: selected.frameBackgroundOffsets,
            byteLength: atlasBytes.length,
            decodedBytes: selected.width * selected.height * 4,
            sha256: sha256(atlasBytes),
          },
          layout: {
            schema: prepared.layout.schema,
            encoding: prepared.layout.encoding,
            componentCount: prepared.layout.componentCount,
            bytesPerLeaf: prepared.layout.bytesPerLeaf,
            leafCount: prepared.layout.leafCount,
            byteLength: layoutBytes.length,
            sha256: sha256(layoutBytes),
          },
          authority: prepared.authority,
        },
        atlasBytes,
        layoutBytes,
      },
    });
  } catch (error) {
    parentPort.postMessage({
      taskId,
      error: String(error?.stack || error?.message || error),
    });
  }
});

async function encodeLossyAvifCandidates(candidates, avifenc) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cssflower-shared-frame-page-"));
  try {
    const encoded = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const input = join(temporaryRoot, `page-${index}.png`);
      const output = join(temporaryRoot, `page-${index}.avif`);
      await writeFile(input, candidate.bytes);
      const result = spawnSync(avifenc, [
        "--qcolor",
        String(CSSFLOWER_PROJECTED_ATLAS_QUALITY),
        "--speed",
        "6",
        "--yuv",
        "444",
        "--ignore-exif",
        "--ignore-xmp",
        "--ignore-icc",
        input,
        output,
      ], { encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`avifenc exited ${result.status}: ${result.stderr || result.stdout}`);
      }
      encoded.push(Object.freeze({
        ...candidate,
        bytes: await readFile(output),
      }));
    }
    encoded.sort((left, right) => (
      left.bytes.length - right.bytes.length ||
      left.packing.localeCompare(right.packing)
    ));
    return Object.freeze(encoded);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
