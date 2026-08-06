import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";
import { applyPreparedProjectedLeafLayout } from "./projectedPageStyles.mjs";

export function timelineStateIndexForTick(tick, cycle) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssFlower tick must be a non-negative safe integer");
  if (tick < cycle.stateCount) return tick;
  return cycle.cycleStartState + ((tick - cycle.cycleStartState) % cycle.cycleLength);
}

export async function createCssflowerPreparedPlayer(options) {
  const { playback, mesh, projectedPages, rotationRoot } = options;
  const leaves = [...options.leaves];
  validatePlayback(playback, projectedPages, rotationRoot, mesh, leaves);
  const projected = playback.projectedPixels;
  const requestFrame = options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const now = options.now ?? (() => globalThis.performance.now());
  const frameMilliseconds = 1000 / playback.sourceTicksPerSecond;
  let paused = true;
  let request = null;
  let nextFrameAt = null;
  let globalTick = 0;
  let timelineStateIndex = -1;
  let geometryStateIndex = -1;
  let rootStateIndex = -1;
  let projectedPageIndex = 0;
  let projectedFrameIndex = -1;
  let preparedStatesApplied = 0;
  let modelTransformWrites = 0;
  let shapeTransformWrites = 0;
  let projectedFrameWrites = 0;
  let projectedAtlasWrites = 0;
  let preparedPageLayoutAdoptions = 0;
  let preparedPageBoundaryLeafStyleWrites = 0;
  let runtimeSchedulerCallbacks = 0;
  let runtimeSchedulerStateTransitions = 0;
  let runtimeSchedulerLateResetCount = 0;
  let runtimeSchedulerMaximumLatenessMs = 0;

  const morphTarget = createPolyMorphPreparedDomTarget({
    model: {
      element: rotationRoot,
      writeTransform(transform) {
        if (rotationRoot.style.transform === transform) return false;
        rotationRoot.style.transform = transform;
        return true;
      },
    },
    shapes: [{ element: mesh }],
    leaves: leaves.map((element) => ({ element })),
  });

  async function applyTick(tick) {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssFlower tick must be a non-negative safe integer");
    const nextTimelineStateIndex = timelineStateIndexForTick(tick, playback.cycle);
    const state = playback.cycle.states[nextTimelineStateIndex];
    if (!state) throw new Error(`Prepared cssFlower timeline state ${nextTimelineStateIndex} is missing`);
    const nextRootStateIndex = state.rootStateIndex;
    const nextProjectedPageIndex = state.projectedPageIndex;
    const nextProjectedFrameIndex = state.projectedFrameIndex;
    let nextResidentPageIndex = null;
    if (nextProjectedPageIndex !== projectedPageIndex) {
      nextResidentPageIndex = projectedPageAfter(projected, playback.cycle, nextProjectedPageIndex);
      const record = await projectedPages.activate(nextProjectedPageIndex, nextResidentPageIndex);
      const atlasImage = `url("${record.url}")`;
      if (rotationRoot.style.getPropertyValue("--cssflower-projected-atlas") !== atlasImage) {
        rotationRoot.style.setProperty("--cssflower-projected-atlas", atlasImage);
        projectedAtlasWrites += 1;
      }
      applyPreparedProjectedLeafLayout({
        leaves,
        layoutValues: record.layoutValues,
        atlas: projected.pages[nextProjectedPageIndex].atlas,
      });
      preparedPageLayoutAdoptions += 1;
      preparedPageBoundaryLeafStyleWrites += leaves.length;
    }
    const frameValue = `${projected.pages[nextProjectedPageIndex].atlas.frameBackgroundOffsets[nextProjectedFrameIndex]}px`;
    if (rotationRoot.style.getPropertyValue("--cssflower-projected-frame-offset") !== frameValue) {
      rotationRoot.style.setProperty("--cssflower-projected-frame-offset", frameValue);
      projectedFrameWrites += 1;
    }
    if (morphTarget.model.writeTransform(playback.cycle.rootTransforms[nextRootStateIndex])) {
      modelTransformWrites += 1;
    }
    if (morphTarget.shapes[0].writeTransform(projected.inverseRootTransforms[nextRootStateIndex])) {
      shapeTransformWrites += 1;
    }
    globalTick = tick;
    timelineStateIndex = nextTimelineStateIndex;
    geometryStateIndex = state.geometryStateIndex;
    rootStateIndex = nextRootStateIndex;
    projectedPageIndex = nextProjectedPageIndex;
    projectedFrameIndex = nextProjectedFrameIndex;
    preparedStatesApplied += 1;
    rotationRoot.dataset.cssflowerGlobalTick = String(globalTick);
    rotationRoot.dataset.cssflowerTimelineStateIndex = String(timelineStateIndex);
    rotationRoot.dataset.cssflowerGeometryStateIndex = String(geometryStateIndex);
    rotationRoot.dataset.cssflowerRootStateIndex = String(rootStateIndex);
    rotationRoot.dataset.cssflowerProjectedPage = String(projectedPageIndex);
    rotationRoot.dataset.cssflowerProjectedFrame = String(projectedFrameIndex);
    if (nextResidentPageIndex !== null) {
      await waitForPresentedPaint(requestFrame);
      projectedPages.commitPresented(nextProjectedPageIndex, nextResidentPageIndex);
    }
    morphTarget.assertStableDomIdentity();
    return globalTick;
  }

  async function loop(timestamp) {
    request = null;
    runtimeSchedulerCallbacks += 1;
    if (paused) return;
    if (nextFrameAt === null) {
      nextFrameAt = timestamp + frameMilliseconds;
    } else if (timestamp >= nextFrameAt - 0.5) {
      const scheduledAt = nextFrameAt;
      await applyTick(globalTick + 1);
      runtimeSchedulerStateTransitions += 1;
      nextFrameAt = scheduledAt + frameMilliseconds;
      const completedAt = now();
      if (completedAt > nextFrameAt) {
        const lateness = completedAt - nextFrameAt;
        runtimeSchedulerLateResetCount += 1;
        runtimeSchedulerMaximumLatenessMs = Math.max(runtimeSchedulerMaximumLatenessMs, lateness);
        nextFrameAt = completedAt + frameMilliseconds;
      }
    }
    if (!paused) request = requestFrame(loop);
  }

  await applyTick(0);
  return Object.freeze({
    get tick() { return globalTick; },
    get paused() { return paused; },
    pause() {
      paused = true;
      nextFrameAt = null;
      if (request !== null) cancelFrame(request);
      request = null;
      return globalTick;
    },
    resume() {
      if (!paused) return globalTick;
      paused = false;
      nextFrameAt = null;
      request = requestFrame(loop);
      return globalTick;
    },
    async step(count = 1) {
      this.pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("cssFlower step count must be a positive integer");
      return applyTick(globalTick + amount);
    },
    async setTick(value) {
      this.pause();
      const tick = Math.trunc(Number(value));
      return applyTick(tick);
    },
    assertStableDomIdentity() {
      morphTarget.assertStableDomIdentity();
      return true;
    },
    stats() {
      morphTarget.assertStableDomIdentity();
      const state = playback.cycle.states[timelineStateIndex];
      return Object.freeze({
        schema: "cssflower-prepared-player-stats@1",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        globalTick,
        timelineStateIndex,
        geometryStateIndex,
        rootStateIndex,
        projectedPageIndex,
        projectedFrameIndex,
        sourceSf: state.sf,
        sourceSfHex: state.sfHex,
        sourceSfi: state.sfi,
        sourceSfiHex: state.sfiHex,
        sourceRotationDegrees: [state.rotationXDegrees, state.rotationYDegrees, state.rotationZDegrees],
        sourceRotationIncrementDegrees: [3, 2, 0],
        retainedTriangleLeafCount: leaves.length,
        retainedRotationRootCount: 1,
        retainedPreparedShapeCount: 1,
        preparedTimelineStateCount: playback.cycle.stateCount,
        preparedGeometryStateCount: playback.cycle.geometryStateCount,
        preparedRootStateCount: playback.cycle.rootStateCount,
        preparedProjectedPageCount: projected.pageCount,
        preparedStatesApplied,
        runtimeModelTransformWrites: modelTransformWrites,
        runtimeShapeTransformWrites: shapeTransformWrites,
        runtimeLeafTransformWrites: 0,
        runtimePerFrameLeafStyleWrites: 0,
        runtimeProjectedFrameWrites: projectedFrameWrites,
        runtimeProjectedAtlasWrites: projectedAtlasWrites,
        runtimePreparedPageLayoutAdoptions: preparedPageLayoutAdoptions,
        runtimePreparedPageBoundaryLeafStyleWrites: preparedPageBoundaryLeafStyleWrites,
        projectedPageLoader: projectedPages.stats(),
        runtimeSchedulerCallbacks,
        runtimeSchedulerStateTransitions,
        runtimeSchedulerSkippedPreparedStateCount: 0,
        runtimeSchedulerLateResetCount,
        runtimeSchedulerMaximumLatenessMs,
        runtimePolygonConstructionCount: 0,
        runtimeGeometryConstructionCount: 0,
        runtimeRadialProjectionCount: 0,
        runtimeProjectionCalculationCount: 0,
        runtimeRasterizationCount: 0,
        runtimeNormalCalculationCount: 0,
        runtimeLightingCalculationCount: 0,
        runtimeAtlasConstructionCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomGrowth: false,
      });
    },
    nodes() {
      return Object.freeze({ rotationRoot, mesh, leaves: Object.freeze([...leaves]) });
    },
    destroy() {
      this.pause();
      morphTarget.destroy();
    },
  });
}

function projectedPageAfter(projected, cycle, pageIndex) {
  if (pageIndex + 1 < projected.pageCount) return pageIndex + 1;
  return cycle.states[cycle.cycleStartState].projectedPageIndex;
}

function validatePlayback(playback, projectedPages, rotationRoot, mesh, leaves) {
  const projected = playback?.projectedPixels;
  if (playback?.schema !== "cssflower-prepared-playback@1" ||
      playback.target !== "createPolyMorphPreparedDomTarget" ||
      playback.sourceTicksPerSecond !== 30 ||
      playback.cycle?.stateCount !== 9_331 ||
      playback.cycle?.cycleStartState !== 331 ||
      playback.cycle?.cycleLength !== 9_000 ||
      playback.cycle?.bloomTraceStateCount !== 581 ||
      playback.cycle?.bloomCycleLength !== 250 ||
      playback.cycle?.geometryStateCount !== 414 ||
      playback.cycle?.rootStateCount !== 360 ||
      playback.cycle?.states?.length !== 9_331 ||
      playback.cycle?.rootTransforms?.length !== 360 ||
      projected?.schema !== "cssflower-prepared-projected-pixel-playback@1" ||
      projected.stateCount !== playback.cycle.stateCount ||
      projected.retainedLeafCount !== 1_200 ||
      projected.pages?.length !== projected.pageCount ||
      projected.inverseRootTransforms?.length !== playback.cycle.rootStateCount ||
      playback.cycle.states.some((state) =>
        !Number.isSafeInteger(state.rootStateIndex) || state.rootStateIndex < 0 || state.rootStateIndex >= 360 ||
        !Number.isSafeInteger(state.projectedPageIndex) || state.projectedPageIndex < 0 ||
        state.projectedPageIndex >= projected.pageCount ||
        !Number.isSafeInteger(state.projectedFrameIndex) || state.projectedFrameIndex < 0 ||
        state.projectedFrameIndex >= projected.pages[state.projectedPageIndex].usedFrameCount) ||
      !projectedPages?.activate || !projectedPages?.commitPresented ||
      !projectedPages?.urlFor || !projectedPages?.layoutFor || !projectedPages?.stats ||
      !(rotationRoot instanceof HTMLElement) || !(mesh instanceof HTMLElement) ||
      leaves.length !== 1_200) {
    throw new Error("Complete prepared cssFlower projected Morph playback is required");
  }
}

function waitForPresentedPaint(requestFrame) {
  return new Promise((resolvePaint) => requestFrame(() => requestFrame(resolvePaint)));
}
