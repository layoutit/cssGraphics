import { createHash } from "node:crypto";

import { titleHeadContentHash } from "./contract.mjs";

const TITLE_HEAD_PLAYBACK_PACKET_SCHEMA = "cssgraphics-title-head-playback-packet@1";
const TITLE_HEAD_PLAYBACK_LAYOUT = "flat-delta-index-v1";
const TITLE_HEAD_PLAYBACK_FRAME_COUNT = 820;

function fail(message) {
  throw new Error(`Title-head playback prepare failed: ${message}`);
}

function hash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(`${label} has no content hash`);
  return value;
}

function initialVisibleFaces(lighting, trianglePlan) {
  const visibility = lighting.visibilityCulling;
  const faceCount = trianglePlan.leaves.length;
  if (visibility?.trianglePlanHash !== trianglePlan.contentHash
    || visibility.faceCount !== faceCount) {
    fail("prepared visibility does not match the playback topology");
  }
  const encoded = visibility.initialVisibleBitsBase64;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== Math.ceil(faceCount / 8)) fail("prepared visibility is truncated");
  const faces = new Uint8Array(faceCount);
  for (let index = 0; index < faceCount; index += 1) {
    faces[index] = (bytes[index >> 3] >> (index & 7)) & 1;
  }
  return faces;
}

function lightingFaces(trianglePlan, lighting) {
  if (lighting?.schema !== "cssgraphics-title-head-lighting-atlases@9"
    || lighting.trianglePlanHash !== trianglePlan.contentHash
    || lighting.surface?.faces?.length !== trianglePlan.leaves.length) {
    fail("prepared lighting does not match the playback topology");
  }
  return lighting.surface.faces;
}

function fittedAtlasTransform(transform, leaf, raster) {
  const canonicalSize = leaf.polycss.update.canonicalSize;
  if (raster.leafWidth === canonicalSize && raster.leafHeight === canonicalSize) {
    return transform;
  }
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) fail(`${leaf.faceId} has no prepared matrix3d sizing bypass`);
  const values = match[1].split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    fail(`${leaf.faceId} has an invalid prepared matrix3d sizing bypass`);
  }
  const xScale = canonicalSize / raster.leafWidth;
  const yScale = canonicalSize / raster.leafHeight;
  for (const index of [0, 1, 2]) values[index] *= xScale;
  for (const index of [4, 5, 6]) values[index] *= yScale;
  const decimals = Math.max(6, Math.min(12, leaf.polycss.update.matrixDecimals));
  const factor = 10 ** decimals;
  return `matrix3d(${values.map((value) => {
    const rounded = Math.round(value * factor) / factor;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }).join(",")})`;
}

function assertPreparedInput(motion, table, trianglePlan, lighting) {
  const faceCount = trianglePlan?.leaves?.length;
  const shapeCount = trianglePlan?.topology?.shapes?.length;
  if (trianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
    || faceCount !== 1213 || shapeCount !== 6
    || motion?.profiles?.length !== TITLE_HEAD_PLAYBACK_FRAME_COUNT
    || !(motion.profileFaceStateIndices instanceof Uint16Array)
    || motion.profileFaceStateIndices.length !== 821 * faceCount
    || !(motion.faceStateOffsets instanceof Uint32Array)
    || motion.faceStateOffsets.length !== faceCount + 1
    || motion.timeline?.frames?.length !== 1711
    || table?.contract?.trianglePlanHash !== trianglePlan.contentHash
    || table.strings?.length !== motion.faceStateOffsets[faceCount]
    || lighting?.motionTransforms?.sha256 !== table.contract.sha256) {
    fail("prepared motion, transforms, and topology do not form one closure");
  }
}

function createPlaybackCompiler(
  motionPlayback,
  motionTransformTable,
  trianglePlan,
  lighting,
) {
  assertPreparedInput(
    motionPlayback,
    motionTransformTable,
    trianglePlan,
    lighting,
  );
  const rasters = lightingFaces(trianglePlan, lighting);
  const visibility = initialVisibleFaces(lighting, trianglePlan);
  const transformStrings = motionTransformTable.strings;
  const shapes = trianglePlan.topology.shapes.map(() => ["", 1]);
  const leaves = trianglePlan.leaves.map((leaf, sourceOrder) => [
    fittedAtlasTransform(leaf.polycss.transform, leaf, rasters[sourceOrder]),
    visibility[sourceOrder],
  ]);
  let modelTransform = "";
  return Object.freeze({
    shapes,
    leaves,
    tick(profileIndex) {
      const profile = motionPlayback.profiles[profileIndex];
      let transformWrites = 0;
      if (profile.modelTransform !== modelTransform) {
        modelTransform = profile.modelTransform;
        transformWrites += 1;
      }
      for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
        const transform = profile.shapeTransforms[shapeIndex];
        if (shapes[shapeIndex][0] !== transform) {
          shapes[shapeIndex][0] = transform;
          transformWrites += 1;
        }
      }
      const stateOffset = profileIndex * leaves.length;
      for (let faceIndex = 0; faceIndex < leaves.length; faceIndex += 1) {
        const row = leaves[faceIndex];
        const stateIndex = motionPlayback.faceStateOffsets[faceIndex]
          + motionPlayback.profileFaceStateIndices[stateOffset + faceIndex];
        const transform = transformStrings[stateIndex];
        const visible = transform !== "" && visibility[faceIndex] === 1 ? 1 : 0;
        if (row[1] !== visible) {
          row[1] = visible;
          transformWrites += 1;
        }
        if (transform !== "" && row[0] !== transform) {
          row[0] = transform;
          transformWrites += 1;
        }
      }
      return transformWrites;
    },
    snapshot() {
      return Object.freeze({
        shapes: Object.freeze(shapes.map((state) => Object.freeze([...state]))),
        leaves: Object.freeze(leaves.map((state) => Object.freeze([...state]))),
      });
    },
  });
}

function snapshot(compiler, sourceFrame, appearance, lightingRow, modelTransform) {
  const state = compiler.snapshot();
  return Object.freeze({
    sourceFrame,
    appearance: Object.freeze([appearance.id, appearance.scale, appearance.translateYSourcePx]),
    lightingRow,
    modelTransform,
    shapes: state.shapes,
    leaves: state.leaves,
  });
}

function delta(previous, current) {
  const shapeChanges = [];
  const leafChanges = [];
  for (let index = 0; index < current.shapes.length; index += 1) {
    if (previous.shapes[index][0] !== current.shapes[index][0]
      || previous.shapes[index][1] !== current.shapes[index][1]) {
      shapeChanges.push([index, current.shapes[index][0], current.shapes[index][1]]);
    }
  }
  for (let index = 0; index < current.leaves.length; index += 1) {
    if (previous.leaves[index][0] !== current.leaves[index][0]
      || previous.leaves[index][1] !== current.leaves[index][1]) {
      leafChanges.push([index, current.leaves[index][0], current.leaves[index][1]]);
    }
  }
  return Object.freeze({
    sourceFrame: current.sourceFrame,
    appearance: current.appearance,
    lightingRow: current.lightingRow,
    modelTransform: previous.modelTransform === current.modelTransform ? null : current.modelTransform,
    shapeChanges: Object.freeze(shapeChanges),
    leafChanges: Object.freeze(leafChanges),
  });
}

function dictionaries(initial, changes) {
  const transforms = [];
  const transformIndices = new Map();
  const appearances = [];
  const appearanceIndices = new Map();
  const transform = (value) => {
    if (!transformIndices.has(value)) {
      transformIndices.set(value, transforms.length);
      transforms.push(value);
    }
    return transformIndices.get(value);
  };
  const appearance = (value) => {
    const key = JSON.stringify(value);
    if (!appearanceIndices.has(key)) {
      appearanceIndices.set(key, appearances.length);
      appearances.push(value);
    }
    return appearanceIndices.get(key);
  };
  transform(initial.modelTransform);
  for (const state of initial.shapes) transform(state[0]);
  for (const state of initial.leaves) transform(state[0]);
  for (const row of changes) {
    appearance(row.appearance);
    if (row.modelTransform !== null) transform(row.modelTransform);
    for (const entry of row.shapeChanges) transform(entry[1]);
    for (const entry of row.leafChanges) transform(entry[1]);
  }
  return Object.freeze({
    transforms: Object.freeze(transforms),
    appearances: Object.freeze(appearances),
    transform,
    appearance,
  });
}

function publicationHashUpdate(digest, state) {
  digest.update(JSON.stringify(state));
  digest.update("\n");
}

function buildTitleHeadPlaybackPacket({
  animation,
  deformation,
  geometry,
  materials,
  motionPlayback,
  motionTransformTable,
  trianglePlan,
  lighting,
} = {}) {
  const compiler = createPlaybackCompiler(
    motionPlayback,
    motionTransformTable,
    trianglePlan,
    lighting,
  );

  let first = null;
  let previous = null;
  const changes = new Array(TITLE_HEAD_PLAYBACK_FRAME_COUNT);
  const sourcePublicationDigest = createHash("sha256");
  const legacyAffineEvaluations = motionPlayback.affineEvaluations;
  let legacyTransformWrites = 0;
  for (let sourceFrame = 1; sourceFrame <= TITLE_HEAD_PLAYBACK_FRAME_COUNT; sourceFrame += 1) {
    const tick = sourceFrame - 1;
    const profile = motionPlayback.profiles[tick];
    legacyTransformWrites += compiler.tick(tick);
    const current = snapshot(
      compiler,
      sourceFrame,
      profile.appearance,
      tick,
      profile.modelTransform,
    );
    publicationHashUpdate(sourcePublicationDigest, current);
    if (first === null) first = current;
    if (previous !== null) changes[tick] = delta(previous, current);
    previous = current;
  }
  changes[0] = delta(previous, first);

  const dictionary = dictionaries(first, changes);
  const shapeChanges = [];
  const leafChanges = [];
  const frameRows = changes.map((row) => {
    const shapeOffset = shapeChanges.length / 3;
    const leafOffset = leafChanges.length / 3;
    for (const [index, transform, isVisible] of row.shapeChanges) {
      shapeChanges.push(index, dictionary.transform(transform), isVisible);
    }
    for (const [index, transform, isVisible] of row.leafChanges) {
      leafChanges.push(index, dictionary.transform(transform), isVisible);
    }
    return Object.freeze([
      row.sourceFrame,
      dictionary.appearance(row.appearance),
      row.lightingRow,
      row.modelTransform === null ? -1 : dictionary.transform(row.modelTransform),
      shapeOffset,
      row.shapeChanges.length,
      leafOffset,
      row.leafChanges.length,
    ]);
  });
  const initial = Object.freeze({
    sourceFrame: 1,
    appearance: dictionary.appearance(first.appearance),
    lightingRow: first.lightingRow,
    modelTransform: dictionary.transform(first.modelTransform),
    shapes: Object.freeze(first.shapes.flatMap((state, index) => [index, dictionary.transform(state[0]), state[1]])),
    leaves: Object.freeze(first.leaves.flatMap((state, index) => [index, dictionary.transform(state[0]), state[1]])),
  });
  const bindings = Object.freeze({
    animationHash: hash(animation?.contentHash, "animation"),
    deformationHash: hash(deformation?.contentHash, "deformation"),
    geometryHash: hash(geometry?.contentHash, "geometry"),
    materialsHash: hash(materials?.contentHash, "materials"),
    trianglePlanHash: hash(trianglePlan?.contentHash, "triangle plan"),
    lightingHash: hash(lighting?.contentHash, "lighting"),
  });
  const transformUtf8Bytes = dictionary.transforms.reduce((total, value) => total + Buffer.byteLength(value), 0);
  const payload = {
    schema: TITLE_HEAD_PLAYBACK_PACKET_SCHEMA,
    layout: TITLE_HEAD_PLAYBACK_LAYOUT,
    bindings,
    sourceFrames: Object.freeze({ first: 1, last: 820, count: 820, wrapTo: 1 }),
    timeline: motionPlayback.timeline,
    directFrameIndex: "sourceFrame-1",
    transitionContract: "frame row is the sparse delta from the preceding source frame; frame 1 follows frame 820",
    shapeCount: 6,
    leafCount: 1213,
    transforms: dictionary.transforms,
    appearances: dictionary.appearances,
    initial,
    frameRows: Object.freeze(frameRows),
    shapeChanges: Object.freeze(shapeChanges),
    leafChanges: Object.freeze(leafChanges),
    totals: Object.freeze({
      frames: TITLE_HEAD_PLAYBACK_FRAME_COUNT,
      transformStrings: dictionary.transforms.length,
      transformUtf8Bytes,
      appearanceRows: dictionary.appearances.length,
      initialShapeEntries: first.shapes.length,
      initialLeafEntries: first.leaves.length,
      changedShapeEntries: shapeChanges.length / 3,
      changedLeafEntries: leafChanges.length / 3,
      denseFrameLeafEntries: TITLE_HEAD_PLAYBACK_FRAME_COUNT * first.leaves.length,
      omittedDenseLeafEntries: TITLE_HEAD_PLAYBACK_FRAME_COUNT * first.leaves.length - leafChanges.length / 3,
      legacyAffineEvaluations,
      legacyTransformWrites,
    }),
    proof: Object.freeze({
      sourcePublicationSha256: sourcePublicationDigest.digest("hex"),
      directFrameRows: true,
      sparseRows: true,
      preformattedTransforms: true,
      completeLoopCompared: true,
      wrapCompared: true,
    }),
  };

  const packetWithoutHash = Object.freeze(payload);
  return Object.freeze({
    ...packetWithoutHash,
    contentHash: titleHeadContentHash(packetWithoutHash),
  });
}

function serializeTitleHeadPlaybackPacket(value) {
  return `${JSON.stringify(value)}\n`;
}

export function prepareTitleHeadPlaybackPacket({
  animation,
  deformation,
  geometry,
  materials,
  motionPlayback,
  motionTransformTable,
  trianglePlan,
  lighting,
}) {
  const packet = buildTitleHeadPlaybackPacket({
    animation,
    deformation,
    geometry,
    materials,
    motionPlayback,
    motionTransformTable,
    trianglePlan,
    lighting,
  });
  return Object.freeze({
    contract: packet,
    files: Object.freeze([
      Object.freeze({
        path: "playback-packet.json",
        role: "title-head-playback-packet-contract",
        bytes: Buffer.from(serializeTitleHeadPlaybackPacket(packet)),
      }),
    ]),
  });
}
