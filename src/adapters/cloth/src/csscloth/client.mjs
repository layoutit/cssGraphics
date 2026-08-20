import {
  createPolyMorphPreparedDomTarget,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { createPolyMorphPreparedShadowTarget } from "../shared/csscloth/morphShadowPatch.mjs";
import { createPolyMorphPreparedCornerTextureTarget } from "../shared/csscloth/morphTexturePatch.mjs";
import { selectClothStartingBank } from "../shared/csscloth/bankSelection.mjs";
import { loadClothPreparedPlayback } from "../shared/csscloth/preparedPlaybackTransport.mjs";

export function mountClothClient(host) {
  const state = { ready: false, errors: [], mounted: null, player: null, metadata: null };
  installDebugApi(state);
  window.addEventListener("error", (event) => recordError(event.message || String(event.error || "error")));
  window.addEventListener("unhandledrejection", (event) => recordError(String(event.reason?.stack || event.reason || "unhandled rejection")));
  window.addEventListener("resize", () => state.player?.resize(), { passive: true });
  main().catch((error) => recordError(error.stack || error.message || String(error)));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing Cloth host");
    setStatus("loading");
    const metadata = await fetch("/csscloth/prepared.json", { cache: "no-store" })
      .then(assertResponse)
      .then((response) => response.json());
    const bankDescriptors = validatePlaybackCatalog(metadata);
    const startingBankIndex = selectClothStartingBank(bankDescriptors.length);
    const loadStartedAt = performance.now();
    const [loaded, playback] = await Promise.all([
      loadPolyMorphPackage("/csscloth/model/", { modelId: "cloth" }),
      loadClothPreparedPlayback(bankDescriptors[startingBankIndex]),
    ]);
    const loadMilliseconds = performance.now() - loadStartedAt;
    if (loaded.model.identity.id !== "cloth" || metadata?.schema !== "csscloth-prepared-scene@1" ||
        metadata?.renderer?.textureLeafSizing !== "raster") {
      throw new Error("Cloth prepared model binding drifted");
    }
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 1200,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: 0,
      }),
    });
    cleanPreparedDom(mounted);
    const clothTexture = createPolyMorphPreparedCornerTextureTarget(
      mounted,
      loaded.resources,
      playback.triangleCount,
      metadata.renderer.logoAtlas,
    );
    const player = createPlayer(mounted, loaded.model, playback, clothTexture, {
      bankDescriptors,
      startingBankIndex,
      loadMilliseconds,
      loadPlayback: loadClothPreparedPlayback,
      recordError,
    });
    player.seekFrame(0);
    state.mounted = mounted;
    state.player = player;
    state.metadata = metadata;
    state.ready = true;
    setStatus("ready");
    player.resume();
  }

  function recordError(message) {
    state.errors.push(message);
    setStatus("error");
    if (document.querySelector(".csscloth-error-message")) return;
    const output = document.createElement("p");
    output.className = "csscloth-error-message";
    output.textContent = message;
    host.append(output);
  }
}

function createPlayer(mounted, model, initialPlayback, clothTexture, transport) {
  const bankDescriptors = transport.bankDescriptors;
  const startingDescriptor = bankDescriptors[transport.startingBankIndex];
  validatePlaybackBank(initialPlayback, startingDescriptor);
  if (model.profile !== "static-prepared") {
    throw new Error("Cloth prepared playback binding drifted");
  }
  const leafHandles = clothTexture.handles;
  if (leafHandles.some((handle) => !handle)) {
    throw new Error("Cloth retained DOM binding is incomplete");
  }
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.sceneElement,
      writeTransform() {
        return false;
      },
    },
    shapes: [],
    leaves: leafHandles.map(({ element }) => ({ element })),
  });
  const shadowTarget = createPolyMorphPreparedShadowTarget(mounted, initialPlayback);
  const frameMilliseconds = initialPlayback.frameMilliseconds;
  const schedulerLeadMilliseconds = Math.min(8, frameMilliseconds / 2);
  const currentLightingRows = new Uint32Array(initialPlayback.triangleCount);
  currentLightingRows.fill(0xffff_ffff);
  let playback = initialPlayback;
  let currentBankIndex = transport.startingBankIndex;
  let prefetchedBankIndex = -1;
  let prefetchedPlayback = null;
  let prefetchingBankIndex = -1;
  let prefetchPromise = null;
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let nextFrameAt = 0;
  let pausedDelayMilliseconds = frameMilliseconds;
  let lastFrameIndex = -1;
  let schedulerFrameRequestCount = 0;
  let schedulerFrameCallbackCount = 0;
  let schedulerFrameCancelCount = 0;
  let schedulerEarlyCallbackCount = 0;
  let schedulerLateResetCount = 0;
  let applyCount = 0;
  let leafTransformWrites = 0;
  let atlasRowWrites = 0;
  let bankHandoffCount = 0;
  let bankBoundaryWaitCount = 0;
  let preparedPlaybackLoadCount = 1;
  let preparedPlaybackCompressedBytes = startingDescriptor.compressedByteLength;
  let preparedPlaybackDecodedBytes = initialPlayback.decodedByteLength;
  let preparedPlaybackLoadMilliseconds = transport.loadMilliseconds;

  function publish(frameIndex) {
    if (frameIndex === lastFrameIndex) return frameIndex;
    const frameOffset = frameIndex * playback.triangleCount;
    for (let triangleIndex = 0; triangleIndex < playback.triangleCount; triangleIndex += 1) {
      leafTransformWrites += Number(target.leaves[triangleIndex].writeTransform(
        playback.transforms[frameOffset + triangleIndex],
      ));
      const lightingRow = playback.lightingRows[frameOffset + triangleIndex];
      if (currentLightingRows[triangleIndex] === lightingRow) continue;
      const atlasSlot = playback.atlasSlots[
        playback.atlasStateOffsets[triangleIndex] + lightingRow
      ];
      atlasRowWrites += Number(clothTexture.writeSlot(triangleIndex, atlasSlot));
      currentLightingRows[triangleIndex] = lightingRow;
    }
    shadowTarget.publish(frameIndex);
    lastFrameIndex = frameIndex;
    applyCount += 1;
    return frameIndex;
  }

  function prefetchNextBank() {
    if (destroyed || prefetchedPlayback || prefetchPromise) return;
    const bankIndex = (currentBankIndex + 1) % bankDescriptors.length;
    const descriptor = bankDescriptors[bankIndex];
    const startedAt = performance.now();
    prefetchingBankIndex = bankIndex;
    prefetchPromise = transport.loadPlayback(descriptor)
      .then((nextPlayback) => {
        validatePlaybackBank(nextPlayback, descriptor, playback);
        if (destroyed || prefetchingBankIndex !== bankIndex) return;
        prefetchedBankIndex = bankIndex;
        prefetchedPlayback = nextPlayback;
        preparedPlaybackLoadCount += 1;
        preparedPlaybackCompressedBytes += descriptor.compressedByteLength;
        preparedPlaybackDecodedBytes += nextPlayback.decodedByteLength;
        preparedPlaybackLoadMilliseconds += performance.now() - startedAt;
      })
      .catch((error) => {
        if (!destroyed && prefetchingBankIndex === bankIndex) {
          transport.recordError(error.stack || error.message || String(error));
        }
      });
  }

  function advancePlayback() {
    if (lastFrameIndex + 1 < playback.frameCount) {
      publish(lastFrameIndex + 1);
      return true;
    }
    if (!prefetchedPlayback || prefetchedBankIndex !== (currentBankIndex + 1) % bankDescriptors.length) {
      bankBoundaryWaitCount += 1;
      return false;
    }
    playback = prefetchedPlayback;
    currentBankIndex = prefetchedBankIndex;
    prefetchedPlayback = null;
    prefetchedBankIndex = -1;
    prefetchingBankIndex = -1;
    prefetchPromise = null;
    currentLightingRows.fill(0xffff_ffff);
    shadowTarget.setPlayback(playback);
    lastFrameIndex = -1;
    publish(0);
    bankHandoffCount += 1;
    prefetchNextBank();
    return true;
  }

  function tick(timestamp) {
    frameRequest = null;
    if (paused || destroyed) return;
    schedulerFrameCallbackCount += 1;
    const publicationTime = Math.max(Number(timestamp) || 0, performance.now());
    if (publicationTime + schedulerLeadMilliseconds + 0.75 < nextFrameAt) {
      schedulerEarlyCallbackCount += 1;
      scheduleNextFrame();
      return;
    }
    const advanced = advancePlayback();
    nextFrameAt = advanced
      ? nextFrameAt + frameMilliseconds
      : publicationTime + frameMilliseconds;
    if (nextFrameAt <= publicationTime) {
      nextFrameAt = publicationTime + frameMilliseconds;
      schedulerLateResetCount += 1;
    }
    scheduleNextFrame();
  }

  function requestPaintAlignedFrame() {
    frameRequest = requestAnimationFrame(tick);
    schedulerFrameRequestCount += 1;
  }

  function scheduleNextFrame() {
    if (paused || destroyed || frameRequest !== null) return;
    requestPaintAlignedFrame();
  }

  function resume() {
    if (!paused || destroyed) return;
    nextFrameAt = performance.now() + pausedDelayMilliseconds;
    pausedDelayMilliseconds = frameMilliseconds;
    paused = false;
    scheduleNextFrame();
  }

  function pause() {
    if (paused || destroyed) return;
    pausedDelayMilliseconds = Math.min(
      frameMilliseconds,
      Math.max(0, nextFrameAt - performance.now()),
    );
    paused = true;
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
      schedulerFrameCancelCount += 1;
    }
    frameRequest = null;
  }

  function seekFrame(frameIndex) {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= playback.frameCount) {
      throw new RangeError("Cloth prepared frame is out of range");
    }
    const wasPaused = paused;
    if (!wasPaused) pause();
    publish(frameIndex);
    if (!wasPaused) resume();
    return snapshot();
  }

  function resize() {
    const perspective = innerHeight / (2 * Math.tan(15 * Math.PI / 180));
    mounted.cameraElement.style.perspective = `${Number(perspective.toFixed(4))}px`;
    mounted.sceneElement.style.transform = `translateZ(${Number(perspective.toFixed(4))}px)`;
    return snapshot();
  }

  function snapshot() {
    const shadow = shadowTarget.snapshot();
    return Object.freeze({
      paused,
      startingBankIndex: transport.startingBankIndex,
      bankIndex: currentBankIndex,
      frameIndex: lastFrameIndex,
      streamFrameIndex: currentBankIndex * playback.frameCount + lastFrameIndex,
      bankCount: bankDescriptors.length,
      bankFrameCount: playback.frameCount,
      frameCount: bankDescriptors.length * playback.frameCount,
      bankDurationMilliseconds: playback.durationMilliseconds,
      durationMilliseconds: bankDescriptors.length * playback.durationMilliseconds,
      prefetchedBankIndex,
      prefetchingBankIndex,
      bankHandoffCount,
      bankBoundaryWaitCount,
      applyCount,
      runtimeSchedulerTransport: "continuous-requestAnimationFrame-prepared-bank-publication",
      schedulerFrameRequestCount,
      schedulerFrameCallbackCount,
      schedulerFrameCancelCount,
      schedulerEarlyCallbackCount,
      schedulerLateResetCount,
      leafTransformWrites,
      atlasRowWrites,
      shadowTransformAssignments: shadow.transformAssignments,
      shadowVisibilityAssignments: shadow.visibilityAssignments,
      shadowTransformWrites: shadow.transformWrites,
      shadowVisibilityWrites: shadow.visibilityWrites,
      shadowAbsoluteSeekCount: shadow.absoluteSeekCount,
      preparedPlaybackLoadCount,
      preparedPlaybackCompressedBytes,
      preparedPlaybackDecodedBytes,
      preparedPlaybackLoadMilliseconds: Number(preparedPlaybackLoadMilliseconds.toFixed(2)),
      preparedPlaybackCatalogCompressedBytes: bankDescriptors.reduce(
        (sum, descriptor) => sum + descriptor.compressedByteLength,
        0,
      ),
    });
  }

  resize();
  prefetchNextBank();
  return Object.freeze({
    resume,
    pause,
    resize,
    seekFrame,
    snapshot,
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      shadowTarget.assertStableDomIdentity();
      return true;
    },
    destroy() {
      pause();
      destroyed = true;
      clothTexture.destroy();
      shadowTarget.destroy();
      target.destroy();
      mounted.destroy();
    },
  });
}

function validatePlaybackCatalog(metadata) {
  const catalog = metadata?.playback;
  const presentation = metadata?.presentation;
  const banks = catalog?.banks;
  if (metadata?.schema !== "csscloth-prepared-scene@1" ||
      catalog?.schema !== "csscloth-prepared-playback-bank-catalog@1" ||
      !Number.isSafeInteger(catalog.bankCount) || catalog.bankCount < 2 ||
      !Number.isSafeInteger(catalog.bankFrameCount) || catalog.bankFrameCount < 2 ||
      !Array.isArray(banks) || banks.length !== catalog.bankCount ||
      presentation?.startingBankSelection?.policy !==
        "crypto-random-uniform-starting-bank-once-before-prepared-bank-fetch" ||
      presentation.startingBankSelection.bankCount !== catalog.bankCount ||
      presentation.bankCount !== catalog.bankCount ||
      presentation.bankFrameCount !== catalog.bankFrameCount ||
      presentation.frameCount !== catalog.bankCount * catalog.bankFrameCount ||
      banks.some((descriptor, bankIndex) => descriptor?.bankIndex !== bankIndex ||
        descriptor.frameCount !== catalog.bankFrameCount)) {
    throw new Error("Cloth prepared playback bank catalog drifted");
  }
  return banks;
}

function validatePlaybackBank(playback, descriptor, currentPlayback = playback) {
  if (playback?.triangleCount !== 200 || playback.frameCount !== 1440 ||
      playback.frameMilliseconds !== 1000 / 60 || playback.frameCount !== descriptor?.frameCount ||
      playback.triangleCount !== descriptor.triangleCount ||
      playback.shadowTriangleCount !== descriptor.shadowTriangleCount ||
      playback.triangleCount !== currentPlayback.triangleCount ||
      playback.shadowTriangleCount !== currentPlayback.shadowTriangleCount ||
      playback.frameMilliseconds !== currentPlayback.frameMilliseconds) {
    throw new Error("Cloth prepared playback bank binding drifted");
  }
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.sceneElement.className = "polycss-scene";
  mounted.modelElement.removeAttribute("class");
  mounted.modelElement.removeAttribute("data-poly-morph-model");
  for (const element of mounted.shapeElements.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-shape");
    element.style.removeProperty("transform");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
  for (const { element } of mounted.leafHandles.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-leaf");
    element.removeAttribute("data-poly-morph-strategy");
    element.removeAttribute("data-poly-morph-resolved-strategy");
    if (element.localName === "u") {
      element.style.removeProperty("backface-visibility");
      element.style.removeProperty("color");
    }
    element.style.removeProperty("background-repeat");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
  if (mounted.modelElement.parentElement !== mounted.sceneElement ||
      [...mounted.shapeElements.values()].some((element) =>
        element.parentElement !== mounted.modelElement)) {
    throw new Error("Cloth prepared model wrapper binding drifted");
  }
  for (let triangleIndex = 0; triangleIndex < 200; triangleIndex += 1) {
    const suffix = String(triangleIndex).padStart(3, "0");
    const shape = mounted.shapeElements.get(`cloth-${suffix}`);
    const leaf = mounted.leafHandles.get(`leaf-cloth-${suffix}`)?.element;
    if (!shape || !leaf || leaf.localName !== "u" || leaf.parentElement !== shape ||
        shape.childElementCount !== 1) {
      throw new Error(`Cloth prepared triangle ${suffix} cannot be flattened`);
    }
    mounted.sceneElement.append(leaf);
    shape.remove();
  }
  for (const [id, element] of mounted.shapeElements) {
    if (!/^cloth-\d{3}$/u.test(id)) mounted.sceneElement.append(element);
  }
  if (mounted.modelElement.childElementCount !== 0) {
    throw new Error("Cloth prepared model wrapper contains unexpected retained nodes");
  }
  mounted.modelElement.remove();
}

function installDebugApi(state) {
  Object.defineProperty(window, "__cssClothDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { state.player?.pause(); },
      resume() { state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      state() { return state.player?.snapshot() ?? null; },
      metadata() { return state.metadata; },
      stats() {
        if (!state.mounted || !state.player) return null;
        return Object.freeze({
          retainedShapeCount: state.mounted.shapeElements.size,
          retainedLeafCount: state.mounted.leafHandles.size,
          retainedDomStable: state.player.assertStableDomIdentity(),
          runtimeGeometryConstructionCount: 0,
          runtimeDomGrowth: false,
          ...state.player.snapshot(),
        });
      },
    }),
  });
}

function assertResponse(response) {
  if (!response.ok) throw new Error(`Cloth prepared asset failed: ${response.status} ${response.url}`);
  return response;
}

function setStatus(kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
}
