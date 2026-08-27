// SPDX-License-Identifier: MIT
import { mountPreparedChaosSnapshot } from "./polycssScene.mjs";
import { createChaosPreparedPlayer } from "./preparedPlayback.mjs";

const ASSET_ROOT = "/csschaos";

export function mountChaosClient(host) {
  let destroyed = false;
  let player = null;
  let scene = null;
  let resizeObserver = null;
  let playbackEpoch = 0;
  const preparedCache = new Map();
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    currentIndex: 0,
    playbackOrder: null,
    playbackOrderPosition: 0,
    nextPlaybackOrder: null,
    rankToPhysical: null,
    phase: "loading",
    phaseStartedAt: 0,
    transitionCount: 0,
    assetFetchCount: 0,
    assetFetchEncodedBytes: 0,
    workerStartCount: 0,
    workerMaterializationCount: 0,
    workerMaterializationMilliseconds: 0,
    workerMaximumSliceMilliseconds: 0,
  };
  const materializer = createPreparedAssetMaterializer(state);
  const controller = Object.freeze({
    pause() {
      if (destroyed || state.phase !== "holding") return false;
      player?.pause();
      setPhase("paused");
      return true;
    },
    resume() {
      if (destroyed || state.phase !== "paused") return false;
      player?.resume();
      setPhase("holding");
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playbackEpoch += 1;
      player?.destroy();
      resizeObserver?.disconnect();
      scene?.destroy();
      materializer.destroy();
      preparedCache.clear();
      state.ready = false;
    },
  });
  installDebugApi(state, controller, () => ({ player, scene, preparedCache }));
  main().catch(fail);
  return controller;

  async function main() {
    const metadata = await fetchJson(`${ASSET_ROOT}/prepared.json`);
    validateMetadata(metadata);
    state.metadata = metadata;
    state.playbackOrder = prepareShuffledPlaybackOrder(metadata.sequence.length, {
      firstIndex: resolveStartIndex(metadata, location.search),
    });
    state.currentIndex = state.playbackOrder[0];
    const currentDescriptor = metadata.sequence[state.currentIndex];
    const nextIndex = peekNextPlaybackIndex();
    const snapshotPromise = fetchText(`${ASSET_ROOT}/snapshot.html`);
    const currentPromise = loadPrepared(state.currentIndex);
    void loadPrepared(nextIndex);
    const snapshotHtml = await snapshotPromise;
    if (destroyed) return;
    scene = mountPreparedChaosSnapshot({ host, catalog: metadata, snapshotHtml });
    resizeObserver = installResponsiveStage(scene.camera, host);
    performance.mark("csschaos-snapshot-mounted");
    const currentPrepared = await currentPromise;
    if (destroyed) return;
    state.ready = true;
    document.body.classList.replace("loading", "ready");
    performance.mark("csschaos-ready");
    startHold(state.currentIndex, currentDescriptor, currentPrepared, {
      handoff: false,
      initialFrame: 0,
      previousRankToPhysical: null,
    });
  }

  function startHold(index, descriptor, prepared, playbackOptions) {
    if (playbackOptions.handoff && !player) {
      throw new Error("Chaos handoff requires an outgoing prepared player");
    }
    const handoffStartCoordinates = playbackOptions.handoff
      ? player.captureTerminalPreparedComponents()
      : null;
    player?.destroy();
    state.currentIndex = index;
    const rankToPhysical = prepareRankToPhysical(descriptor, playbackOptions);
    state.rankToPhysical = rankToPhysical;
    player = createChaosPreparedPlayer({
      catalog: { ...state.metadata, ...descriptor },
      prepared,
      leafPhaseIndices: prepared.leafPhaseIndices,
      leafRevealOrder: prepared.leafRevealOrder,
      leafOpacities: state.metadata.leafOpacities,
      publish: scene.publishTransform,
      publishOpacity: scene.publishOpacity,
      handoff: playbackOptions.handoff,
      handoffStartCoordinates,
      rankToPhysical,
      onCycleComplete: () => {
        if (destroyed || state.currentIndex !== index) return;
        void selectModel(advancePlaybackIndex(), {
          handoff: true,
          initialFrame: 0,
          previousRankToPhysical: rankToPhysical,
        });
      },
    });
    player.publishFrame(playbackOptions.initialFrame);
    player.resume();
    setPhase("holding");
    const nextIndex = peekNextPlaybackIndex();
    void loadPrepared(nextIndex);
    trimPreparedCache([index, nextIndex]);
  }

  async function selectModel(index, playbackOptions) {
    const expectedEpoch = ++playbackEpoch;
    setPhase("loading-selection");
    try {
      const prepared = await loadPrepared(index);
      if (destroyed || expectedEpoch !== playbackEpoch) return;
      state.transitionCount += 1;
      startHold(index, state.metadata.sequence[index], prepared, playbackOptions);
    } catch (error) {
      fail(error);
    }
  }

  function loadPrepared(index) {
    const normalized = normalizeIndex(index, state.metadata.sequence.length);
    if (preparedCache.has(normalized)) return preparedCache.get(normalized);
    const descriptor = state.metadata.sequence[normalized];
    const pending = fetch(`${ASSET_ROOT}/${descriptor.asset}`).then(async (response) => {
      if (!response.ok) throw new Error(`Chaos asset fetch failed: ${response.status}`);
      state.assetFetchCount += 1;
      state.assetFetchEncodedBytes += descriptor.encodedByteLength;
      const bytes = await response.arrayBuffer();
      return materializer.materialize(descriptor, bytes);
    }).catch((error) => {
      preparedCache.delete(normalized);
      throw error;
    });
    preparedCache.set(normalized, pending);
    return pending;
  }

  function trimPreparedCache(retainedIndices) {
    const retained = new Set(retainedIndices);
    for (const index of preparedCache.keys()) {
      if (!retained.has(index)) preparedCache.delete(index);
    }
  }

  function peekNextPlaybackIndex() {
    if (state.playbackOrderPosition + 1 < state.playbackOrder.length) {
      return state.playbackOrder[state.playbackOrderPosition + 1];
    }
    state.nextPlaybackOrder ??= prepareShuffledPlaybackOrder(state.metadata.sequence.length, {
      excludedFirstIndex: state.currentIndex,
    });
    return state.nextPlaybackOrder[0];
  }

  function advancePlaybackIndex() {
    if (state.playbackOrderPosition + 1 < state.playbackOrder.length) {
      state.playbackOrderPosition += 1;
      return state.playbackOrder[state.playbackOrderPosition];
    }
    state.playbackOrder = state.nextPlaybackOrder ?? prepareShuffledPlaybackOrder(
      state.metadata.sequence.length, { excludedFirstIndex: state.currentIndex });
    state.nextPlaybackOrder = null;
    state.playbackOrderPosition = 0;
    return state.playbackOrder[0];
  }

  function setPhase(phase) {
    state.phase = phase;
    state.phaseStartedAt = performance.now();
    document.body.dataset.phase = phase;
  }

  function fail(error) {
    if (destroyed) return;
    state.errors.push(String(error?.stack || error));
    player?.pause();
    document.body.classList.remove("loading", "ready");
    document.body.classList.add("error");
    console.error(error);
  }
}

function createPreparedAssetMaterializer(state) {
  const worker = new Worker(new URL("./preparedAssetWorker.mjs", import.meta.url),
    { type: "module" });
  const pending = new Map();
  let nextRequestId = 1;
  let destroyed = false;
  state.workerStartCount += 1;
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data?.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    const { descriptor, resolve, reject } = request;
    if (data.type === "error") {
      reject(new Error(data.message));
      return;
    }
    if (data.type !== "ready" || !Array.isArray(data.transforms) ||
        data.transforms.length !== descriptor.sampleCount ||
        !(data.coordinates instanceof Uint16Array) ||
        data.coordinates.length !== descriptor.sampleCount * 3 ||
        !(data.handoffControlCoordinates instanceof Uint16Array) ||
        data.handoffControlCoordinates.length !== descriptor.handoffControlPointCount * 3 ||
        !(data.leafPhaseIndices instanceof Uint16Array) ||
        data.leafPhaseIndices.length !== descriptor.starCount ||
        !(data.leafRevealOrder instanceof Uint16Array) ||
        data.leafRevealOrder.length !== descriptor.starCount) {
      reject(new Error("Chaos worker response drifted"));
      return;
    }
    state.workerMaterializationCount += 1;
    state.workerMaterializationMilliseconds += data.workerDurationMilliseconds;
    state.workerMaximumSliceMilliseconds = Math.max(state.workerMaximumSliceMilliseconds,
      data.workerMaximumSliceMilliseconds);
    resolve(Object.freeze(data));
  });
  worker.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });
  return Object.freeze({
    materialize(descriptor, bytes) {
      if (destroyed) return Promise.reject(new Error("Chaos materializer is destroyed"));
      const requestId = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { descriptor, resolve, reject });
        worker.postMessage({ type: "materialize", requestId, descriptor, bytes }, [bytes]);
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      for (const { reject } of pending.values()) {
        reject(new Error("Chaos materializer was destroyed"));
      }
      pending.clear();
    },
  });
}

function validateMetadata(metadata) {
  if (metadata?.schema !== "csschaos-prepared-sequence@12" ||
      metadata.status !== "ready" || metadata.adapterId !== "chaos" ||
      metadata.starCount !== 2000 || metadata.framesPerSecond !== 60 ||
      metadata.preparedRevealSeconds !== 3 ||
      metadata.preparedHandoffSeconds !== 2 ||
      metadata.preparedHoldSeconds !== 3 ||
      metadata.identityMatchingFrames?.length !== 2 ||
      metadata.identityMatchingFrames[0] !== 120 ||
      metadata.identityMatchingFrames[1] !== 300 ||
      metadata.sequence?.length !== 50 || metadata.audition?.candidateCount !== 50 ||
      metadata.audition?.reviewedCandidateCount !== 135 ||
      metadata.audition?.removedSystemIds?.length !== 85 ||
      metadata.audition?.visualRemovedSystemIds?.length !== 33 ||
      metadata.audition?.similarityRemovedSystemIds?.length !== 7 ||
      metadata.audition?.motionRemovedSystemIds?.length !== 45 ||
      metadata.audition?.motionAuditSchema !== "csschaos-motion-interest-audit@2" ||
      metadata.audition?.similarityThreshold !== 0.91 ||
      metadata.audition?.advance !== "automatic-shuffled-handoff" ||
      metadata.audition?.selectionTransition !== "instant" ||
      metadata.audition?.reviewState !== "published-motion-curated-shortlist" ||
      metadata.chapters?.length !== 7 ||
      metadata.renderer?.runtimePhysics !== false ||
      metadata.renderer?.kind !==
        "retained-dom-polycss-prepared-chaotic-attractor-sequence" ||
      metadata.renderer?.runtimeCoordinateFormatting !== true ||
      metadata.renderer?.runtimeSourceCoordinateFormatting !== false ||
      metadata.renderer?.runtimeHandoffInterpolation !== true ||
      metadata.renderer?.preparedThreeDimensionalGeometry !== true ||
      metadata.renderer?.preparedFinalCameraProjection !== true ||
      metadata.renderer?.preparedDepthScale !== true ||
      metadata.renderer?.runtimeThreeDimensionalTransform !== false ||
      metadata.renderer?.sourceAxisIndependentScaling !== false ||
      metadata.renderer?.runtimeRevealSorting !== false ||
      metadata.renderer?.runtimeHandoffCalculation !== false ||
      metadata.renderer?.preparedSourcePhaseReveal !== true ||
      metadata.renderer?.preparedSpatialHandoff !== true ||
      metadata.renderer?.preparedForwardHandoff !== true ||
      metadata.renderer?.preparedSinglePassScatterHandoff !== true ||
      metadata.renderer?.preparedPerSystemCamera !== true ||
      metadata.renderer?.retainedAxisElementCount !== 3 ||
      metadata.viewport?.depth !== 600 || metadata.viewport?.perspective !== 900 ||
      metadata.leafOpacities?.length !== 2000 ||
      metadata.sequence.some((descriptor) => descriptor.starCount !== 2000) ||
      metadata.sequence.some((descriptor) => descriptor.revealSeconds !== 3) ||
      metadata.sequence.some((descriptor) => descriptor.handoffSeconds !== 2) ||
      metadata.sequence.some((descriptor) => descriptor.holdSeconds !== 3) ||
      metadata.sequence.some((descriptor) => descriptor.handoffControlPointCount !== 2000) ||
      metadata.sequence.some((descriptor) => descriptor.contentEncoding !== "br" ||
        descriptor.transportEncoding !==
          "axis-split-zigzag-varint-second-difference-u16-plus-sorted-phase-ranks-packed-reveal@1" ||
        !Number.isSafeInteger(descriptor.decodedByteLength) ||
        !Number.isSafeInteger(descriptor.materializedByteLength) ||
        descriptor.materializedByteLength !== 37_280 ||
        descriptor.encodedByteLength >= descriptor.materializedByteLength) ||
      metadata.sequence.some((descriptor) =>
        descriptor.presentationOrientation?.method !==
          "prepared deterministic rigid orientation audition" ||
        !Number.isFinite(descriptor.presentationOrientation.yawDegrees) ||
        !Number.isFinite(descriptor.presentationOrientation.pitchDegrees) ||
        !Number.isFinite(descriptor.presentationOrientation.rollDegrees) ||
        !Number.isFinite(descriptor.presentationOrientation.baselineScore) ||
        !Number.isFinite(descriptor.presentationOrientation.selectedScore) ||
        descriptor.presentationOrientation.selectedScore <
          descriptor.presentationOrientation.baselineScore ||
        descriptor.presentationOrientation.candidateCount !== 187) ||
      metadata.sequence.some((descriptor) => !Number.isSafeInteger(descriptor.sourcePhaseOffset) ||
        descriptor.sourcePhaseOffset < 0 || descriptor.sourcePhaseOffset >= metadata.sampleCount) ||
      metadata.sequence.some((descriptor) =>
        typeof descriptor.preparedHandoffControlSeedFrom !== "string") ||
      metadata.renderer?.runtimePointMatching !== false) {
    throw new Error("Chaos prepared metadata drifted");
  }
}

function resolveStartIndex(metadata, search) {
  const requested = new URLSearchParams(search).get("start");
  if (!requested) return null;
  const index = metadata.sequence.findIndex((system) => system.id === requested.toLowerCase());
  return index < 0 ? null : index;
}

export function prepareShuffledPlaybackOrder(count, {
  firstIndex = null,
  excludedFirstIndex = null,
  random = Math.random,
} = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || typeof random !== "function") {
    throw new TypeError("Chaos shuffle requires a positive system count");
  }
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  if (Number.isSafeInteger(firstIndex) && firstIndex >= 0 && firstIndex < count) {
    const position = order.indexOf(firstIndex);
    [order[0], order[position]] = [order[position], order[0]];
  } else if (count > 1 && order[0] === excludedFirstIndex) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return Object.freeze(order);
}

function prepareRankToPhysical(descriptor, { handoff, previousRankToPhysical }) {
  if (!handoff) {
    return Uint16Array.from({ length: descriptor.starCount }, (_, rank) => rank);
  }
  if (!(previousRankToPhysical instanceof Uint16Array) ||
      previousRankToPhysical.length !== descriptor.starCount) {
    throw new Error("Chaos previous retained-dot identity drifted");
  }
  return previousRankToPhysical;
}

function installResponsiveStage(camera, stage) {
  const update = () => {
    const scale = Math.min(stage.clientWidth / 800, stage.clientHeight / 600) * 0.9;
    camera.style.setProperty("--stage-scale", String(scale));
  };
  const observer = new ResizeObserver(update);
  observer.observe(stage);
  update();
  return observer;
}

function installDebugApi(state, controller, readRuntime) {
  Object.defineProperty(window, "__cssChaosDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause: controller.pause,
      resume: controller.resume,
      stats() {
        const { player, scene, preparedCache } = readRuntime();
        if (!state.ready || !player || !scene) return null;
        const descriptor = state.metadata.sequence[state.currentIndex];
        return Object.freeze({
          adapterId: "chaos",
          currentSystem: descriptor.name,
          currentSystemIndex: state.currentIndex,
          playbackOrderPosition: state.playbackOrderPosition,
          currentChapter: descriptor.chapterTitle,
          currentChapterIndex: descriptor.chapterIndex,
          chapterCount: state.metadata.chapters.length,
          sequenceSystemCount: state.metadata.sequence.length,
          phase: state.phase,
          phaseElapsedMilliseconds: performance.now() - state.phaseStartedAt,
          transitionCount: state.transitionCount,
          starCount: state.metadata.starCount,
          sampleCount: state.metadata.sampleCount,
          retainedPreparedSystemCount: preparedCache.size,
          assetFetchCount: state.assetFetchCount,
          assetFetchEncodedBytes: state.assetFetchEncodedBytes,
          workerStartCount: state.workerStartCount,
          workerMaterializationCount: state.workerMaterializationCount,
          workerMaterializationMilliseconds: state.workerMaterializationMilliseconds,
          workerMaximumSliceMilliseconds: state.workerMaximumSliceMilliseconds,
          runtimePhysicsCount: 0,
          runtimeCoordinateFormattingCount: 0,
          runtimeRasterizationCount: 0,
          ...scene.stats(),
          ...player.stats(),
        });
      },
      assertStableDomIdentity() { return readRuntime().scene?.assertStableDomIdentity() ?? false; },
    }),
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chaos metadata fetch failed: ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chaos snapshot fetch failed: ${response.status}`);
  return response.text();
}

function normalizeIndex(index, count) {
  return (index % count + count) % count;
}
