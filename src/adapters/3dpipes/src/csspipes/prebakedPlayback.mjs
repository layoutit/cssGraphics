import { createPreparedDomBanks } from "./preparedDomBanks.mjs";
import { createPreparedClipStore } from "./preparedClipStore.mjs";

function viewportProfile(value) {
  if (value !== "desktop" && value !== "mobile") {
    throw new RangeError("cssPipes viewport profile must be desktop or mobile");
  }
  return value;
}

function selectedPlaylistCursor(playback, profile) {
  const playlist = playback.viewportPlaylists[profile];
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % playlist.length;
  }
  return 0;
}

function horizonClipIndices(playback, playlist, startClipIndex) {
  const indices = new Set();
  let current = startClipIndex;
  while (indices.size < playback.clipChunks.runtimeLookaheadClipCount) {
    indices.add(current);
    const track = playback.experiments.zSeedLoop.tracks[current];
    if (track.recycleClipIndex !== null) indices.add(track.recycleClipIndex);
    current = track.terminal ? playlist[0] : track.nextClipIndex;
    indices.add(current);
  }
  return [...indices].slice(0, playback.clipChunks.runtimeLookaheadClipCount);
}

function loadedClip(store, index) {
  const prepared = store.loaded(index);
  if (!prepared) throw new Error(`Prepared clip ${index} is not loaded`);
  return prepared;
}

function trackShapeTransforms(playback, prepared) {
  const transforms = prepared.placement.shapeTransforms;
  if (transforms?.length !== playback.retainedRootCount) {
    throw new Error(`Prepared clip ${prepared.clipIndex} is missing its roots`);
  }
  return transforms;
}

export async function createCssPipesPrebakedPlayer(options) {
  const playback = options.playback;
  const sceneRoot = options.sceneRoot;
  if (!sceneRoot?.style) {
    throw new Error("Prepared cssPipes retained roots are missing");
  }
  const dom = createPreparedDomBanks(options);
  const clipStore = createPreparedClipStore(playback, options.fetchImpl);
  const requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis);
  const frameMilliseconds = 1000 / playback.playbackFramesPerSecond;
  let selectedViewportProfile = viewportProfile(options.initialViewportProfile ?? "desktop");
  let activePlaylist = playback.viewportPlaylists[selectedViewportProfile];
  let playlistCursor = selectedPlaylistCursor(playback, selectedViewportProfile);
  let clipIndex = activePlaylist[playlistCursor];
  let clipData = null;
  let frameIndex = -1;
  let seedLoopStep = 0;
  let seedLoopPhase = "opening";
  let headBank = 0;
  let tailBank = null;
  let nextHeadBank = 1;
  let clipCycle = 0;
  let paused = true;
  let request = null, nextFrameAt = null;
  let horizonRequest = 0;
  let selectionRequest = 0;
  const {
    hideAllBanks,
    hideBank,
    writeBankMaterial,
    writeLeaf,
    writeModelTransform,
    writePipeMaterial,
    writeShape,
  } = dom;

  async function prepareHorizon(startClipIndex) {
    const requestId = ++horizonRequest;
    const indices = horizonClipIndices(playback, activePlaylist, startClipIndex);
    await clipStore.preload(indices);
    if (requestId === horizonRequest) clipStore.retain(indices);
  }

  function seedTrack(currentClipIndex = clipIndex) {
    return playback.experiments.zSeedLoop.tracks[currentClipIndex];
  }

  function publishPreparedState(
    bank,
    initial,
    prepared,
    preparedShapeTransforms = trackShapeTransforms(playback, prepared),
  ) {
    const transforms = prepared.transforms;
    writeModelTransform(transforms, prepared.placement.modelTransform);
    for (let offset = 0; offset < initial.shapes.length; offset += 3) {
      const shapeIndex = initial.shapes[offset];
      writeShape(
        transforms,
        bank,
        shapeIndex,
        preparedShapeTransforms[shapeIndex],
        initial.shapes[offset + 2],
      );
    }
    for (let offset = 0; offset < initial.leaves.length; offset += 3) {
      writeLeaf(
        transforms,
        bank,
        initial.leaves[offset],
        initial.leaves[offset + 1],
        initial.leaves[offset + 2],
      );
    }
  }

  function publishInitial(bank, prepared) {
    publishPreparedState(bank, prepared.recording.experiment.initial, prepared);
  }

  function applyPackedLeafRow(bank, transforms, preparedRows, row, side) {
    const transformColumn = side === "before" ? 1 : 3;
    const visibilityColumn = side === "before" ? 2 : 4;
    for (let index = 0; index < row[1]; index += 1) {
      const offset = (row[0] + index) * 5;
      writeLeaf(
        transforms,
        bank,
        preparedRows.leafTransitions[offset],
        preparedRows.leafTransitions[offset + transformColumn],
        preparedRows.leafTransitions[offset + visibilityColumn],
      );
    }
  }

  function applyReverseSourceRow(bank, prepared, sourceIndex) {
    const recording = prepared.recording;
    const row = recording.sourceRows[sourceIndex];
    if (!row) throw new Error(`Prepared retraction source row ${sourceIndex} is missing`);
    applyPackedLeafRow(bank, prepared.transforms, recording, row, "before");
  }

  function applySnakeTailSourceRow(bank, prepared, sourceIndex) {
    const recording = prepared.recording;
    const tail = recording.snakeTail;
    const row = tail.sourceRows[sourceIndex];
    if (!row) throw new Error(`Prepared Snake tail row ${sourceIndex} is missing`);
    for (let index = 0; index < row[1]; index += 1) {
      const offset = (row[0] + index) * 3;
      writeLeaf(
        prepared.transforms,
        bank,
        tail.leafAssignments[offset],
        tail.leafAssignments[offset + 1],
        tail.leafAssignments[offset + 2],
      );
    }
  }

  function prearmPreparedBank(bank, prepared) {
    writeBankMaterial(bank, prepared.clipIndex);
    const initial = prepared.recording.experiment.connectedInitial;
    const shapeTransforms = trackShapeTransforms(playback, prepared);
    for (let offset = 0; offset < initial.shapes.length; offset += 3) {
      const shape = initial.shapes[offset];
      writeShape(prepared.transforms, bank, shape, shapeTransforms[shape], 0);
    }
    for (let offset = 0; offset < initial.leaves.length; offset += 3) {
      writeLeaf(
        prepared.transforms,
        bank,
        initial.leaves[offset],
        initial.leaves[offset + 1],
        0,
      );
    }
  }

  function applyPreparedBankRecycle(bank, track, frame) {
    const row = track.recycleRows[frame];
    if (!row) return;
    const recycled = loadedClip(clipStore, track.recycleClipIndex);
    for (let index = 0; index < row[1]; index += 1) {
      const offset = (row[0] + index) * 2;
      const pipe = track.recycleShapeAssignments[offset];
      writeShape(
        recycled.transforms,
        bank,
        pipe,
        track.recycleShapeAssignments[offset + 1],
        1,
      );
      writePipeMaterial(bank, pipe, track.recycleClipIndex);
    }
    for (let index = 0; index < row[3]; index += 1) {
      const offset = (row[2] + index) * 3;
      writeLeaf(
        recycled.transforms,
        bank,
        track.recycleLeafAssignments[offset],
        track.recycleLeafAssignments[offset + 1],
        track.recycleLeafAssignments[offset + 2],
      );
    }
  }

  function applyScheduledHeadRows(bank, prepared, scheduleRow) {
    if (!scheduleRow) throw new Error("Prepared Snake head schedule row is missing");
    for (let offset = 0; offset < scheduleRow[1]; offset += 1) {
      applyReverseSourceRow(bank, prepared, scheduleRow[0] - offset);
    }
  }

  function applyScheduledTailRows(bank, prepared, scheduleRow) {
    if (!scheduleRow) throw new Error("Prepared Snake tail schedule row is missing");
    for (let offset = 0; offset < scheduleRow[1]; offset += 1) {
      applySnakeTailSourceRow(bank, prepared, scheduleRow[0] + offset);
    }
  }

  function beginOpening() {
    const track = seedTrack();
    frameIndex = -1;
    seedLoopStep = 0;
    seedLoopPhase = "opening";
    headBank = 0;
    tailBank = null;
    nextHeadBank = 1;
    hideAllBanks();
    writeBankMaterial(headBank, clipIndex);
    publishInitial(headBank, clipData);
    if (!track.terminal) {
      prearmPreparedBank(nextHeadBank, loadedClip(clipStore, track.nextClipIndex));
    }
    dom.assertStableDomIdentity();
  }

  function restartOpening() {
    playlistCursor = 0;
    clipCycle += 1;
    clipIndex = activePlaylist[playlistCursor];
    clipData = loadedClip(clipStore, clipIndex);
    beginOpening();
  }

  function advanceOpeningFrame(track) {
    if (seedLoopStep === 0) {
      const growEntry = clipData.recording.experiment.growEntry;
      applyPackedLeafRow(headBank, clipData.transforms, growEntry, growEntry.row, "after");
    }
    applyScheduledHeadRows(headBank, clipData, track.openingHeadRows[seedLoopStep]);
    frameIndex = seedLoopStep;
    seedLoopStep += 1;
    if (seedLoopStep !== track.openingFrameCount) return;
    seedLoopStep = 0;
    seedLoopPhase = track.terminal ? "restart" : "transition";
  }

  function beginTransitionFrame(track, nextPrepared) {
    tailBank = headBank;
    nextHeadBank = headBank === 0 ? 1 : 0;
    publishPreparedState(
      nextHeadBank,
      nextPrepared.recording.experiment.connectedInitial,
      nextPrepared,
    );
    applySnakeTailSourceRow(tailBank, clipData, 0);
  }

  function finishTransition(track, nextPrepared, nextTrack) {
    if (track.recycleClipIndex === null) hideBank(tailBank);
    playlistCursor = nextTrack.chainIndex;
    clipCycle += 1;
    clipIndex = track.nextClipIndex;
    clipData = nextPrepared;
    headBank = nextHeadBank;
    tailBank = null;
    seedLoopStep = 0;
    seedLoopPhase = nextTrack.terminal ? "restart" : "transition";
    void prepareHorizon(clipIndex);
  }

  function advanceTransitionFrame(track) {
    const nextPrepared = loadedClip(clipStore, track.nextClipIndex);
    const nextTrack = seedTrack(track.nextClipIndex);
    if (seedLoopStep === 0) beginTransitionFrame(track, nextPrepared);
    applyScheduledTailRows(tailBank, clipData, track.tailSourceRows[seedLoopStep]);
    applyPreparedBankRecycle(tailBank, track, seedLoopStep);
    applyScheduledHeadRows(
      nextHeadBank,
      nextPrepared,
      track.headSourceRows[seedLoopStep],
    );
    frameIndex = seedLoopStep;
    seedLoopStep += 1;
    if (seedLoopStep === track.transitionFrameCount) {
      finishTransition(track, nextPrepared, nextTrack);
    }
  }

  function advanceFrame() {
    const track = seedTrack();
    if (seedLoopPhase === "opening") advanceOpeningFrame(track);
    else if (seedLoopPhase === "transition") advanceTransitionFrame(track);
    else if (seedLoopPhase === "restart") {
      restartOpening();
      return frameIndex;
    } else throw new Error(`Prepared seed-loop phase ${seedLoopPhase} cannot advance`);
    return frameIndex;
  }

  function stopPlaybackLoop() {
    const wasPaused = paused;
    paused = true;
    nextFrameAt = null;
    if (request !== null) cancelFrame(request);
    request = null;
    return wasPaused;
  }

  function restorePlaybackLoop(wasPaused) {
    if (wasPaused) return;
    paused = false;
    request = requestFrame(loop);
  }

  function loop(timestamp) {
    request = null;
    if (paused) return;
    if (nextFrameAt === null) {
      nextFrameAt = timestamp + frameMilliseconds;
    } else if (timestamp >= nextFrameAt - 0.5) {
      advanceFrame();
      nextFrameAt += frameMilliseconds;
      if (nextFrameAt <= timestamp) nextFrameAt = timestamp + frameMilliseconds;
    }
    request = requestFrame(loop);
  }

  function pause() {
    paused = true;
    nextFrameAt = null;
    if (request !== null) cancelFrame(request);
    request = null;
    return frameIndex;
  }

  function resume() {
    if (!paused) return frameIndex;
    paused = false;
    nextFrameAt = null;
    request = requestFrame(loop);
    return frameIndex;
  }

  async function setViewportProfile(value) {
    const nextProfile = viewportProfile(value);
    if (nextProfile === selectedViewportProfile) return selectedViewportProfile;
    const requestId = ++selectionRequest;
    const wasPaused = stopPlaybackLoop();
    selectedViewportProfile = nextProfile;
    activePlaylist = playback.viewportPlaylists[selectedViewportProfile];
    playlistCursor = clipCycle % activePlaylist.length;
    clipIndex = activePlaylist[playlistCursor];
    await prepareHorizon(clipIndex);
    if (requestId !== selectionRequest) return selectedViewportProfile;
    clipData = loadedClip(clipStore, clipIndex);
    beginOpening();
    restorePlaybackLoop(wasPaused);
    return selectedViewportProfile;
  }

  await prepareHorizon(clipIndex);
  clipData = loadedClip(clipStore, clipIndex);
  beginOpening();
  return Object.freeze({
    resume,
    setViewportProfile,
    destroy() {
      pause();
      dom.destroy();
    },
  });
}
