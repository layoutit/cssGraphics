// SPDX-License-Identifier: HPND
import { createCityflowDeadlineScheduler } from "./deadlineScheduler.mjs";
import { decodeMobileHeights, mobileFaceTransforms } from "./mobileTransforms.mjs";

export function preparedMobileBank(metadata) {
  const bank = metadata?.mobile;
  if (bank?.schema !== "csscityflow-mobile-product@1" || bank.id !== "mobile" ||
      bank.modelId !== "cityflow-mobile" || !Number.isSafeInteger(bank.boxCount) ||
      bank.boxCount < 1 || bank.boxCount > 100 || bank.leafCount !== bank.boxCount * 3) {
    throw new Error("Cityflow mobile product is incomplete; run prepare:cityflow");
  }
  for (const [kind, extension] of [["snapshot", "html"], ["stylesheet", "css"], ["playback", "json"]]) {
    const asset = bank[kind];
    if (!asset || !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
        asset.assetUrl !== `/csscityflow/assets/mobile-${kind}-${asset.sha256}.${extension}` ||
        !Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) {
      throw new Error(`Cityflow mobile ${kind} metadata drifted`);
    }
  }
  return bank;
}

export async function loadCityflowMobilePlayback(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Cityflow mobile playback failed: ${response.status}`);
  return response.json();
}

export function createCityflowMobilePlayer({ playback, dom, ...overrides }) {
  const heights = decodeMobileHeights(playback);
  if (dom.shapeElements.length !== playback.boxCount ||
      dom.leafElements.some((leaves) => leaves.length !== 3)) {
    throw new Error("Cityflow mobile face binding drifted");
  }
  const dictionary = new Map();
  const states = Array.from(heights, (height, index) => {
    const [width, depth] = playback.footprints[index % playback.boxCount];
    const key = `${width},${depth},${height}`;
    if (!dictionary.has(key)) dictionary.set(key, mobileFaceTransforms(height, width, depth, playback.heightScale));
    return dictionary.get(key);
  });
  let frameIndex = 0;
  let publicationCount = 0;
  let runtimeTransformWrites = 0;
  let destroyed = false;
  const lastPublication = { frameIndex: 0, faceTransformWrites: 0 };
  const scheduler = createCityflowDeadlineScheduler({
    ...overrides,
    frameMilliseconds: 1000 / playback.framesPerSecond,
    publishDue(tick) { publishFrame(tick % playback.frameCount); },
  });

  function publishFrame(frame) {
    const offset = frame * playback.boxCount;
    let writes = 0;
    for (let box = 0; box < playback.boxCount; box += 1) {
      const transforms = states[offset + box];
      if (transforms === states[frameIndex * playback.boxCount + box]) continue;
      const leaves = dom.leafElements[box];
      for (let face = 0; face < 3; face += 1) leaves[face].style.transform = transforms[face];
      writes += 3;
    }
    frameIndex = frame;
    publicationCount += 1;
    runtimeTransformWrites += writes;
    lastPublication.frameIndex = frame;
    lastPublication.faceTransformWrites = writes;
  }

  function stats() {
    return {
      ...dom.stats(), ...scheduler.stats(),
      bankId: "mobile", modelId: "cityflow-mobile", frameIndex,
      frameCount: playback.frameCount, publicationCount, runtimeTransformWrites,
      lastPublication: { ...lastPublication }, retainedBoxCount: playback.boxCount,
      retainedFaceCount: playback.boxCount * 3,
      runtimeGeometry: false, runtimeFormatting: false, runtimeCulling: false,
      runtimeColorWrites: 0, css3d: false,
    };
  }

  return Object.freeze({
    stats,
    pause() { scheduler.pause(); return stats(); },
    resume() { if (!destroyed) scheduler.resume(); return stats(); },
    seekFrame(frame) {
      if (!Number.isSafeInteger(frame) || frame < 0 || frame >= playback.frameCount) {
        throw new RangeError("Cityflow mobile frame is out of range");
      }
      publishFrame(frame);
      scheduler.seekTick(frame);
      return stats();
    },
    destroy() { destroyed = true; scheduler.destroy(); },
  });
}
