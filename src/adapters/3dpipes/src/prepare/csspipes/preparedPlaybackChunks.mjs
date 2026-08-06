import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function createTransformLocalizer(transforms) {
  const localTransforms = [];
  const localIndices = new Map();
  return Object.freeze({
    transforms: localTransforms,
    intern(globalIndex) {
      if (!Number.isInteger(globalIndex) || typeof transforms[globalIndex] !== "string") {
        throw new Error(`Prepared global transform ${globalIndex} is invalid`);
      }
      let localIndex = localIndices.get(globalIndex);
      if (localIndex === undefined) {
        localIndex = localTransforms.length;
        localTransforms.push(transforms[globalIndex]);
        localIndices.set(globalIndex, localIndex);
      }
      return localIndex;
    },
    lookup(globalIndex) {
      const localIndex = localIndices.get(globalIndex);
      if (localIndex === undefined) {
        throw new Error(`Prepared transform ${globalIndex} is outside its clip chunk`);
      }
      return localIndex;
    },
  });
}

function remapStrided(values, stride, transformColumns, localize) {
  const remapped = [...values];
  for (let offset = 0; offset < remapped.length; offset += stride) {
    for (const column of transformColumns) {
      remapped[offset + column] = localize(remapped[offset + column]);
    }
  }
  return Object.freeze(remapped);
}

function localizeInitialState(initial, localize) {
  return Object.freeze({
    ...initial,
    modelTransform: localize(initial.modelTransform),
    rootTransform: localize(initial.rootTransform),
    shapes: remapStrided(initial.shapes, 3, [1], localize),
    leaves: remapStrided(initial.leaves, 3, [1], localize),
  });
}

function localizeRecording(recording, localize) {
  return Object.freeze({
    ...recording,
    experiment: Object.freeze({
      ...recording.experiment,
      initial: localizeInitialState(recording.experiment.initial, localize),
      connectedInitial: localizeInitialState(
        recording.experiment.connectedInitial,
        localize,
      ),
      growEntry: Object.freeze({
        ...recording.experiment.growEntry,
        leafTransitions: remapStrided(
          recording.experiment.growEntry.leafTransitions,
          5,
          [1, 3],
          localize,
        ),
      }),
    }),
    snakeTail: Object.freeze({
      ...recording.snakeTail,
      leafAssignments: remapStrided(
        recording.snakeTail.leafAssignments,
        3,
        [1],
        localize,
      ),
    }),
    leafTransitions: remapStrided(
      recording.leafTransitions,
      5,
      [1, 3],
      localize,
    ),
  });
}

function buildClipChunks(playback) {
  const tracks = playback.experiments.zSeedLoop.tracks;
  const localizers = playback.clips.map(() =>
    createTransformLocalizer(playback.transforms));
  const chunks = playback.clips.map((clip, clipIndex) => {
    const track = tracks[clipIndex];
    const localizer = localizers[clipIndex];
    const recording = localizeRecording(clip.recording, localizer.intern);
    const placement = Object.freeze({
      seedOriginTransform: localizer.intern(track.seedOriginTransform),
      modelTransform: localizer.intern(track.modelTransform),
      shapeTransforms: Object.freeze(track.shapeTransforms.map(localizer.intern)),
    });
    return Object.freeze({
      schema: "csspipes-prepared-clip-chunk@1",
      clipIndex,
      clipId: clip.id,
      transforms: Object.freeze(localizer.transforms),
      placement,
      recording,
    });
  });
  return Object.freeze({ chunks: Object.freeze(chunks), localizers });
}

function buildShellTrack(track, localizers) {
  const {
    seedOriginTransform: _seedOriginTransform,
    modelTransform: _modelTransform,
    shapeTransforms: _shapeTransforms,
    nextShapeTransforms: _nextShapeTransforms,
    recycleShapeAssignments,
    recycleLeafAssignments,
    ...metadata
  } = track;
  const recycle = track.recycleClipIndex === null
    ? null
    : localizers[track.recycleClipIndex];
  return Object.freeze({
    ...metadata,
    recycleShapeAssignments: recycle
      ? remapStrided(recycleShapeAssignments, 2, [1], recycle.lookup)
      : recycleShapeAssignments,
    recycleLeafAssignments: recycle
      ? remapStrided(recycleLeafAssignments, 3, [1], recycle.lookup)
      : recycleLeafAssignments,
    transformDomains: Object.freeze({
      currentPlacement: "current-clip-chunk",
      nextPlacement: "next-clip-chunk",
      recycleAssignments: "recycle-clip-chunk",
    }),
  });
}

function clipMetadata(clip, descriptor) {
  const { recording, ...metadata } = clip;
  return Object.freeze({
    ...metadata,
    recording: Object.freeze({
      schema: recording.schema,
      contentHash: recording.contentHash,
      sourceFrameCount: recording.sourceFrameCount,
      reverseFrameCount: recording.reverseFrameCount,
    }),
    chunk: descriptor,
  });
}

export function buildPreparedPlaybackPackage(scene) {
  const playback = scene.playback;
  const { chunks: preparedChunks, localizers } = buildClipChunks(playback);
  const chunkFiles = preparedChunks.map((chunk) => {
    const text = `${JSON.stringify(chunk)}\n`;
    const payload = gzipSync(text, { level: 9 });
    const hash = sha256(payload);
    const url = `/csspipes/clips/clip-${String(chunk.clipIndex).padStart(3, "0")}-${hash.slice(0, 16)}.json.gz`;
    return Object.freeze({
      clipIndex: chunk.clipIndex,
      url,
      sha256: hash,
      bytes: Buffer.byteLength(text),
      storedBytes: payload.byteLength,
      transformCount: chunk.transforms.length,
      payload,
    });
  });
  const descriptors = Object.freeze(chunkFiles.map((file) => Object.freeze({
    clipIndex: file.clipIndex,
    url: file.url,
    sha256: file.sha256,
    bytes: file.bytes,
    storedBytes: file.storedBytes,
    encoding: "gzip",
    transformCount: file.transformCount,
  })));
  const shellTracks = Object.freeze(playback.experiments.zSeedLoop.tracks.map(
    (track) => buildShellTrack(track, localizers),
  ));
  const {
    transforms: _transforms,
    clips: _clips,
    experiments,
    ...playbackMetadata
  } = playback;
  const shellPlayback = Object.freeze({
    ...playbackMetadata,
    schema: "csspipes-prebaked-playback@13",
    preparation: Object.freeze({
      ...playback.preparation,
      clipStorage: "content-addressed-gzip-local-transform-chunks",
      runtimeLookaheadClipCount: 4,
    }),
    clipChunks: Object.freeze({
      schema: "csspipes-prepared-clip-chunks@1",
      count: descriptors.length,
      runtimeLookaheadClipCount: 4,
      descriptors,
      totalBytes: chunkFiles.reduce((total, file) => total + file.bytes, 0),
      totalStoredBytes: chunkFiles.reduce(
        (total, file) => total + file.storedBytes,
        0,
      ),
      maximumBytes: Math.max(...chunkFiles.map((file) => file.bytes)),
      maximumStoredBytes: Math.max(...chunkFiles.map((file) => file.storedBytes)),
      maximumTransformCount: Math.max(
        ...chunkFiles.map((file) => file.transformCount),
      ),
    }),
    experiments: Object.freeze({
      ...experiments,
      zSeedLoop: Object.freeze({
        ...experiments.zSeedLoop,
        tailStorage: "inline-in-content-addressed-clip-chunks",
        tracks: shellTracks,
      }),
    }),
    clips: Object.freeze(playback.clips.map((clip, index) =>
      clipMetadata(clip, descriptors[index]))),
  });
  const shellScene = Object.freeze({
    ...scene,
    schema: "csspipes-prebaked-scene@12",
    playback: shellPlayback,
  });
  return Object.freeze({ scene: shellScene, chunks: Object.freeze(chunkFiles) });
}
