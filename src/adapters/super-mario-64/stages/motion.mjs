import {
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  resolve,
} from "node:path";
import {
  computeSolidTrianglePlanFromCssPoints,
} from "@layoutit/polycss";
import {
  preparationRuntimeCodeUrl,
} from "../codeLayout.mjs";
import {
  titleHeadSha256,
  serializeTitleHeadContract,
} from "./contract.mjs";
import {
  buildTitleHeadFootprintTrianglePlan,
} from "./trianglePlan.mjs";

// motionProducer
const MAGIC = "CSMOTN02";
const HEADER_BYTES = 208;
const FRAME_COUNT = 820;
const AFFINE_STATE_BYTES = 32;
const DEGENERATE_AFFINE = -0x8000;

function buildPreparedTitleHeadTimeline(animator) {
  let state = animator.createRegularTitleHeadAnimatorState();
  const frames = [];
  const seen = new Map();
  let repeatFrom = -1;
  while (frames.length < 10_000) {
    const key = `${state.state}:${state.frame}:${state.nods}:${state.stillTimer}`;
    const retained = seen.get(key);
    if (retained !== undefined) {
      repeatFrom = retained;
      break;
    }
    seen.set(key, frames.length);
    frames.push(state.frame);
    state = animator.stepRegularTitleHeadAnimatorState(state, { dragging: false });
  }
  if (repeatFrom !== 661 || frames.length !== 1711) {
    throw new Error("Prepared regular-head timeline closure drifted.");
  }
  return Object.freeze({
    introTicks: 661,
    loopTicks: 1050,
    frames: Object.freeze(frames),
  });
}

function align(value, bytes) {
  return Math.ceil(value / bytes) * bytes;
}

function hashBytes(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} content hash is invalid.`);
  return Buffer.from(value, "hex");
}

function sameRange(left, leftOffset, right, rightOffset, count) {
  for (let index = 0; index < count; index += 1) {
    if (left[leftOffset + index] !== right[rightOffset + index]) return false;
  }
  return true;
}

function channelMask(sample, previous) {
  if (previous === null) return sample.channels.length === 32 ? 0xffff_ffff : (2 ** sample.channels.length - 1) >>> 0;
  let mask = 0;
  for (let index = 0; index < sample.channels.length; index += 1) {
    const current = sample.channels[index].localMatrix;
    const prior = previous.channels[index].localMatrix;
    if (!sameRange(current, 0, prior, 0, 16)) mask |= (1 << index) >>> 0;
  }
  return mask >>> 0;
}

function flattenDraw(draw, shapeVertexCounts) {
  const floatsPerProfile = (1 + draw.shapeMatrices.length) * 16
    + shapeVertexCounts.reduce((total, count) => total + count * 3, 0);
  const values = new Float32Array(floatsPerProfile);
  values.set(draw.modelMatrix, 0);
  let offset = 16;
  for (const matrix of draw.shapeMatrices) {
    values.set(matrix, offset);
    offset += 16;
  }
  for (let shapeIndex = 0; shapeIndex < draw.shapes.length; shapeIndex += 1) {
    const shape = draw.shapes[shapeIndex];
    if (shape.positions.length !== shapeVertexCounts[shapeIndex]) throw new Error(`Shape ${shape.id} vertex count drifted.`);
    for (const position of shape.positions) {
      values[offset] = position[0];
      values[offset + 1] = position[1];
      values[offset + 2] = position[2];
      offset += 3;
    }
  }
  if (offset !== floatsPerProfile) throw new Error("Prepared motion float closure drifted.");
  return values;
}

function shapeMask(current, previous, shapeCount) {
  if (previous === null) return (2 ** shapeCount - 1) >>> 0;
  let mask = 0;
  for (let shapeIndex = 0; shapeIndex < shapeCount; shapeIndex += 1) {
    const offset = 16 + shapeIndex * 16;
    if (!sameRange(current, offset, previous, offset, 16)) mask |= 1 << shapeIndex;
  }
  return mask >>> 0;
}

function buildTriangleOptionsByEdgeMask(repair) {
  return Object.freeze(Array.from({ length: 8 }, (_, mask) => {
    const seamEdges = new Set();
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      if ((mask & (1 << edgeIndex)) !== 0) seamEdges.add(edgeIndex);
    }
    return Object.freeze({
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: mask === 0 ? repair.fallbackAmount : repair.sharedEdgeAmount,
      ...(mask === 0 ? {} : { seamEdges }),
    });
  }));
}

function exactFaceTransform(
  values,
  positionsOffset,
  shapeVertexOffsets,
  leaf,
  optionsByEdgeMask,
) {
  const update = leaf.polycss.update;
  const shapeOffset = shapeVertexOffsets[update.shapeStateIndex];
  const offsets = update.vertexIndices.map((vertexIndex) => (
    positionsOffset + (shapeOffset + vertexIndex) * 3
  ));
  const p0 = offsets[0];
  const p1 = offsets[1];
  const p2 = offsets[2];
  const affine = computeSolidTrianglePlanFromCssPoints(
    leaf.polycss,
    leaf.sourceOrder,
    optionsByEdgeMask[update.seamEdgeMask],
    Object.freeze({
      basis: leaf.polycss.basis,
      matrixDecimals: update.matrixDecimals,
      primitive: "corner-bevel",
      includeColor: false,
    }),
    values[p0 + 2], values[p0], values[p0 + 1],
    values[p1 + 2], values[p1], values[p1 + 1],
    values[p2 + 2], values[p2], values[p2 + 1],
  );
  return affine?.transformText ?? "";
}

function faceCoordinatesChanged(
  current,
  previous,
  positionsOffset,
  shapeVertexOffsets,
  leaf,
) {
  if (previous === null) return true;
  const update = leaf.polycss.update;
  const shapeOffset = shapeVertexOffsets[update.shapeStateIndex];
  for (const vertexIndex of update.vertexIndices) {
    const offset = positionsOffset + (shapeOffset + vertexIndex) * 3;
    if (current[offset] !== previous[offset]
      || current[offset + 1] !== previous[offset + 1]
      || current[offset + 2] !== previous[offset + 2]) {
      return true;
    }
  }
  return false;
}

function milliCss(value) {
  if (value === 0) return "0";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 1000);
  const remainder = absolute % 1000;
  const sign = negative ? "-" : "";
  if (remainder === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(remainder).padStart(3, "0").replace(/0+$/u, "")}`;
}

function affineMilliValues(transform, label) {
  if (transform === "") return null;
  const match = /^matrix3d\((.+)\)$/u.exec(transform);
  const tokens = match?.[1].split(",");
  if (!tokens || tokens.length !== 16
    || tokens[3] !== "0" || tokens[7] !== "0" || tokens[11] !== "0" || tokens[15] !== "1") {
    throw new Error(`${label} is not an exact affine matrix3d transform.`);
  }
  const selected = [
    tokens[0], tokens[1], tokens[2],
    tokens[4], tokens[5], tokens[6],
    tokens[8], tokens[9], tokens[10],
    tokens[12], tokens[13], tokens[14],
  ];
  const values = selected.map((token) => {
    const value = Number(token);
    const milli = Math.round(value * 1000);
    if (!Number.isFinite(value) || !Number.isSafeInteger(milli) || milliCss(milli) !== token) {
      throw new Error(`${label} cannot be represented losslessly at PolyCSS's prepared precision.`);
    }
    return milli;
  });
  for (const value of values.slice(0, 9)) {
    if (value <= DEGENERATE_AFFINE || value > 0x7fff) {
      throw new Error(`${label} has a basis value outside the compact exact range.`);
    }
  }
  for (const value of values.slice(9)) {
    if (value < -0x8000_0000 || value > 0x7fff_ffff) {
      throw new Error(`${label} has a translation outside the compact exact range.`);
    }
  }
  return values;
}

function writeAffineState(view, stateIndex, transform, label) {
  const offset = stateIndex * AFFINE_STATE_BYTES;
  const values = affineMilliValues(transform, label);
  if (values === null) {
    view.setInt16(offset, DEGENERATE_AFFINE, true);
    return;
  }
  for (let index = 0; index < 9; index += 1) {
    view.setInt16(offset + index * 2, values[index], true);
  }
  for (let index = 0; index < 3; index += 1) {
    view.setInt32(offset + 20 + index * 4, values[index + 9], true);
  }
}

function readAffineState(view, stateIndex) {
  const offset = stateIndex * AFFINE_STATE_BYTES;
  if (view.getInt16(offset, true) === DEGENERATE_AFFINE) return "";
  const basis = Array.from(
    { length: 9 },
    (_, index) => milliCss(view.getInt16(offset + index * 2, true)),
  );
  const translation = Array.from(
    { length: 3 },
    (_, index) => milliCss(view.getInt32(offset + 20 + index * 4, true)),
  );
  return `matrix3d(${basis[0]},${basis[1]},${basis[2]},0,`
    + `${basis[3]},${basis[4]},${basis[5]},0,`
    + `${basis[6]},${basis[7]},${basis[8]},0,`
    + `${translation[0]},${translation[1]},${translation[2]},1)`;
}

function encode({
  animation,
  deformation,
  trianglePlan,
  shapeVertexCounts,
  profiles,
  faceStateTransforms,
  profileFaceStateIndices,
}) {
  const profileCount = profiles.length;
  const shapeCount = shapeVertexCounts.length;
  const vertexCount = shapeVertexCounts.reduce((total, count) => total + count, 0);
  const faceCount = trianglePlan.leaves.length;
  const channelCount = animation.channels.length;
  const floatsPerProfile = profiles[0].values.length;
  const dirtyIndexCount = profiles.reduce((total, profile) => total + profile.dirtyFaces.length, 0);
  const transformStateCount = faceStateTransforms.reduce((total, states) => total + states.length, 0);
  const transformStateBytes = transformStateCount * AFFINE_STATE_BYTES;
  const profileFaceStateIndexCount = profileCount * faceCount;

  let offset = HEADER_BYTES;
  const shapeVertexCountsOffset = offset;
  offset += shapeCount * 4;
  const dirtyOffsetsOffset = offset;
  offset += (profileCount + 1) * 4;
  const channelMasksOffset = offset;
  offset += profileCount * 4;
  const shapeMasksOffset = offset;
  offset += profileCount * 4;
  const dirtyFacesOffset = align(offset, 2);
  offset = dirtyFacesOffset + dirtyIndexCount * 2;
  const transformStateIndicesOffset = align(offset, 2);
  offset = transformStateIndicesOffset + dirtyIndexCount * 2;
  const profileFaceStateIndicesOffset = align(offset, 2);
  offset = profileFaceStateIndicesOffset + profileFaceStateIndexCount * 2;
  const faceTransformStateOffsetsOffset = align(offset, 4);
  offset = faceTransformStateOffsetsOffset + (faceCount + 1) * 4;
  const transformStatesOffset = align(offset, 4);
  offset = transformStatesOffset + transformStateBytes;
  const frameFloatsOffset = align(offset, 4);
  const fileBytes = frameFloatsOffset + profileCount * floatsPerProfile * 4;

  const output = Buffer.alloc(fileBytes);
  output.write(MAGIC, 0, "ascii");
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const fields = [
    HEADER_BYTES,
    FRAME_COUNT,
    profileCount,
    shapeCount,
    vertexCount,
    faceCount,
    channelCount,
    floatsPerProfile,
    dirtyIndexCount,
    shapeVertexCountsOffset,
    dirtyOffsetsOffset,
    channelMasksOffset,
    shapeMasksOffset,
    dirtyFacesOffset,
    frameFloatsOffset,
    fileBytes,
    FRAME_COUNT,
    0,
  ];
  for (let index = 0; index < fields.length; index += 1) view.setUint32(8 + index * 4, fields[index], true);
  output.set(hashBytes(animation.contentHash, "animation"), 80);
  output.set(hashBytes(deformation.contentHash, "deformation"), 112);
  output.set(hashBytes(trianglePlan.contentHash, "triangle plan"), 144);
  const transformFields = [
    transformStateIndicesOffset,
    profileFaceStateIndicesOffset,
    faceTransformStateOffsetsOffset,
    transformStatesOffset,
    transformStateBytes,
    transformStateCount,
    profileFaceStateIndexCount,
    0,
  ];
  for (let index = 0; index < transformFields.length; index += 1) {
    view.setUint32(176 + index * 4, transformFields[index], true);
  }

  const shapeCounts = new Uint32Array(output.buffer, output.byteOffset + shapeVertexCountsOffset, shapeCount);
  shapeCounts.set(shapeVertexCounts);
  const dirtyOffsets = new Uint32Array(output.buffer, output.byteOffset + dirtyOffsetsOffset, profileCount + 1);
  const channelMasks = new Uint32Array(output.buffer, output.byteOffset + channelMasksOffset, profileCount);
  const shapeMasks = new Uint32Array(output.buffer, output.byteOffset + shapeMasksOffset, profileCount);
  const faceIndices = new Uint16Array(output.buffer, output.byteOffset + dirtyFacesOffset, dirtyIndexCount);
  const stateIndices = new Uint16Array(
    output.buffer,
    output.byteOffset + transformStateIndicesOffset,
    dirtyIndexCount,
  );
  const allProfileStateIndices = new Uint16Array(
    output.buffer,
    output.byteOffset + profileFaceStateIndicesOffset,
    profileFaceStateIndexCount,
  );
  allProfileStateIndices.set(profileFaceStateIndices);
  const faceStateOffsets = new Uint32Array(
    output.buffer,
    output.byteOffset + faceTransformStateOffsetsOffset,
    faceCount + 1,
  );
  const transformStateView = new DataView(
    output.buffer,
    output.byteOffset + transformStatesOffset,
    transformStateBytes,
  );
  const frameValues = new Float32Array(
    output.buffer,
    output.byteOffset + frameFloatsOffset,
    profileCount * floatsPerProfile,
  );
  let dirtyOffset = 0;
  for (let profileIndex = 0; profileIndex < profileCount; profileIndex += 1) {
    const profile = profiles[profileIndex];
    dirtyOffsets[profileIndex] = dirtyOffset;
    faceIndices.set(profile.dirtyFaces, dirtyOffset);
    stateIndices.set(profile.dirtyStateIndices, dirtyOffset);
    dirtyOffset += profile.dirtyFaces.length;
    channelMasks[profileIndex] = profile.channelMask;
    shapeMasks[profileIndex] = profile.shapeMask;
    frameValues.set(profile.values, profileIndex * floatsPerProfile);
  }
  dirtyOffsets[profileCount] = dirtyOffset;
  let globalStateIndex = 0;
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    faceStateOffsets[faceIndex] = globalStateIndex;
    const states = faceStateTransforms[faceIndex];
    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      writeAffineState(
        transformStateView,
        globalStateIndex,
        states[stateIndex],
        `face ${faceIndex} state ${stateIndex}`,
      );
      const decoded = readAffineState(transformStateView, globalStateIndex);
      if (decoded !== states[stateIndex]) {
        throw new Error(`Face ${faceIndex} state ${stateIndex} changed during exact encoding.`);
      }
      globalStateIndex += 1;
    }
  }
  faceStateOffsets[faceCount] = globalStateIndex;
  return {
    output,
    layout: Object.freeze({
      dirtyOffsetsOffset,
      dirtyFacesOffset,
      transformStateIndicesOffset,
      profileFaceStateIndicesOffset,
      faceTransformStateOffsetsOffset,
      transformStatesOffset,
      transformStateBytes,
      transformStateCount,
    }),
  };
}

function verifyEncodedParity({
  output,
  layout,
  profiles,
  trianglePlan,
  positionsOffset,
  shapeVertexOffsets,
  optionsByEdgeMask,
}) {
  const faceCount = trianglePlan.leaves.length;
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const dirtyOffsets = new Uint32Array(
    output.buffer,
    output.byteOffset + layout.dirtyOffsetsOffset,
    profiles.length + 1,
  );
  const dirtyFaces = new Uint16Array(
    output.buffer,
    output.byteOffset + layout.dirtyFacesOffset,
    dirtyOffsets[profiles.length],
  );
  const dirtyStateIndices = new Uint16Array(
    output.buffer,
    output.byteOffset + layout.transformStateIndicesOffset,
    dirtyOffsets[profiles.length],
  );
  const profileFaceStateIndices = new Uint16Array(
    output.buffer,
    output.byteOffset + layout.profileFaceStateIndicesOffset,
    profiles.length * faceCount,
  );
  const faceStateOffsets = new Uint32Array(
    output.buffer,
    output.byteOffset + layout.faceTransformStateOffsetsOffset,
    faceCount + 1,
  );
  const transformStateView = new DataView(
    output.buffer,
    output.byteOffset + layout.transformStatesOffset,
    layout.transformStateBytes,
  );
  let previousTransforms = null;
  let comparisons = 0;
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
    const currentTransforms = new Array(faceCount);
    const dirtyStart = dirtyOffsets[profileIndex];
    const dirtyEnd = dirtyOffsets[profileIndex + 1];
    let dirtyCursor = dirtyStart;
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const exact = exactFaceTransform(
        profiles[profileIndex].sourceValues,
        positionsOffset,
        shapeVertexOffsets,
        trianglePlan.leaves[faceIndex],
        optionsByEdgeMask,
      );
      currentTransforms[faceIndex] = exact;
      const localStateIndex = profileFaceStateIndices[profileIndex * faceCount + faceIndex];
      const globalStateIndex = faceStateOffsets[faceIndex] + localStateIndex;
      if (globalStateIndex >= faceStateOffsets[faceIndex + 1]) {
        throw new Error(`Profile ${profileIndex} face ${faceIndex} selects an out-of-range transform state.`);
      }
      const decoded = readAffineState(transformStateView, globalStateIndex);
      if (decoded !== exact) {
        throw new Error(
          `Exact transform parity failed at profile ${profileIndex}, face ${faceIndex}: `
          + `${JSON.stringify(decoded)} !== ${JSON.stringify(exact)}.`,
        );
      }
      const shouldBeDirty = profileIndex === FRAME_COUNT
        || previousTransforms === null
        || previousTransforms[faceIndex] !== exact;
      if (shouldBeDirty) {
        if (dirtyCursor >= dirtyEnd
          || dirtyFaces[dirtyCursor] !== faceIndex
          || dirtyStateIndices[dirtyCursor] !== localStateIndex) {
          throw new Error(`Profile ${profileIndex} dirty transform mapping drifted at face ${faceIndex}.`);
        }
        dirtyCursor += 1;
      }
      comparisons += 1;
    }
    if (dirtyCursor !== dirtyEnd) {
      throw new Error(`Profile ${profileIndex} retained a false-positive dirty transform.`);
    }
    previousTransforms = currentTransforms;
  }
  if (layout.transformStateCount !== faceStateOffsets[faceCount]
    || view.getUint32(68, true) !== output.length) {
    throw new Error("Exact transform binary closure drifted.");
  }
  return comparisons;
}

async function prepareTitleHeadMotion({
  animation,
  deformation,
  geometry,
  materials,
  trianglePlan,
  output: outputPath,
}) {
const OUTPUT = resolve(outputPath);
if (animation.totals?.channels !== 25 || trianglePlan.totals?.sourceFaces !== 1213) {
  throw new Error("Prepared regular-head motion closure drifted.");
}

{
  const modules = await Promise.all([
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/animator.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/appearanceFit.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/deformationRuntime.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/drawRuntime.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/eyeFollow.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/runtime/polycssRoot.ts")),
  ]);
  const [
    animatorModule,
    appearanceModule,
    deformationModule,
    drawModule,
    eyeModule,
    rootModule,
  ] = modules;

  const animatorRuntime = animatorModule.createPreparedTitleHeadAnimatorRuntime({ animation, deformation });
  const deformationRuntime = deformationModule.createPreparedTitleHeadDeformationRuntime({ geometry, deformation, materials });
  const drawRuntime = drawModule.createTitleHeadDrawRuntime(deformationRuntime);
  const eyeRuntime = eyeModule.createPreparedTitleHeadEyeFollowRuntime(deformation);
  const shapeVertexCounts = deformationRuntime.shapes.map((shape) => shape.vertices.length);
  const shapeVertexOffsets = [];
  let vertexOffset = 0;
  for (const count of shapeVertexCounts) {
    shapeVertexOffsets.push(vertexOffset);
    vertexOffset += count;
  }
  const positionsOffset = (1 + shapeVertexCounts.length) * 16;
  const seamRepair = trianglePlan.mount?.seamRepair;
  if (!seamRepair || seamRepair.runtimeEdgeDiscovery !== false) {
    throw new Error("Prepared triangle seam repair metadata is absent or runtime-owned.");
  }
  const optionsByEdgeMask = buildTriangleOptionsByEdgeMask(seamRepair);
  const faceStateTransforms = trianglePlan.leaves.map(() => []);
  const faceStateIndicesByTransform = trianglePlan.leaves.map(() => new Map());
  const profileFaceStateIndices = new Uint16Array((FRAME_COUNT + 1) * trianglePlan.leaves.length);
  const profiles = [];
  const playbackProfiles = [];
  const playbackTimeline = buildPreparedTitleHeadTimeline(animatorModule);
  const samples = [];
  let playbackAffineEvaluations = 0;
  let previousValues = null;
  let previousSample = null;
  let previousTransforms = null;

  const appendProfile = ({
    sourceValues,
    channelMask: nextChannelMask,
    shapeMask: nextShapeMask,
    dirtyFrom,
  }) => {
    const profileIndex = profiles.length;
    const transforms = new Array(trianglePlan.leaves.length);
    const dirtyFaces = [];
    const dirtyStateIndices = [];
    for (let faceIndex = 0; faceIndex < trianglePlan.leaves.length; faceIndex += 1) {
      if (profileIndex < FRAME_COUNT && faceCoordinatesChanged(
        sourceValues,
        previousValues,
        positionsOffset,
        shapeVertexOffsets,
        trianglePlan.leaves[faceIndex],
      )) {
        playbackAffineEvaluations += 1;
      }
      const transform = exactFaceTransform(
        sourceValues,
        positionsOffset,
        shapeVertexOffsets,
        trianglePlan.leaves[faceIndex],
        optionsByEdgeMask,
      );
      transforms[faceIndex] = transform;
      const states = faceStateTransforms[faceIndex];
      const stateIndices = faceStateIndicesByTransform[faceIndex];
      let stateIndex = stateIndices.get(transform);
      if (stateIndex === undefined) {
        stateIndex = states.length;
        if (stateIndex > 0xffff) {
          throw new Error(`Face ${faceIndex} exceeded the compact transform-state index range.`);
        }
        states.push(transform);
        stateIndices.set(transform, stateIndex);
      }
      profileFaceStateIndices[profileIndex * trianglePlan.leaves.length + faceIndex] = stateIndex;
      if (dirtyFrom === null || dirtyFrom[faceIndex] !== transform) {
        dirtyFaces.push(faceIndex);
        dirtyStateIndices.push(stateIndex);
      }
    }
    profiles.push({
      sourceValues,
      values: sourceValues.slice(0, positionsOffset),
      channelMask: nextChannelMask,
      shapeMask: nextShapeMask,
      dirtyFaces: Uint16Array.from(dirtyFaces),
      dirtyStateIndices: Uint16Array.from(dirtyStateIndices),
    });
    return transforms;
  };

  for (let frame = 1; frame <= FRAME_COUNT; frame += 1) {
    const sample = animatorModule.sampleTitleHeadAnimator(animatorRuntime, frame);
    const snapshot = deformationModule.evaluateTitleHeadDeformation(deformationRuntime, {
      tick: frame - 1,
      localMatrixOverrides: sample.objectMatrixOverrides,
    });
    const draw = drawModule.evaluateTitleHeadDrawRuntime(drawRuntime, snapshot);
    const values = flattenDraw(draw, shapeVertexCounts);
    const shapeTransforms = draw.shapes.map((shape, shapeIndex) => {
      if (shape.id !== trianglePlan.topology.shapes[shapeIndex]?.id) {
        throw new Error(`Prepared motion shape ${shape.id} escaped source order.`);
      }
      return rootModule.sourceMatrixToPolyCssTransform(
        draw.shapeMatrices[shapeIndex],
      );
    });
    playbackProfiles.push(Object.freeze({
      appearance: appearanceModule.titleHeadAppearanceFit(frame),
      modelTransform: rootModule.sourceMatrixToPolyCssTransform(
        draw.modelMatrix,
      ),
      shapeTransforms: Object.freeze(shapeTransforms),
    }));
    previousTransforms = appendProfile({
      sourceValues: values,
      channelMask: channelMask(sample, previousSample),
      shapeMask: shapeMask(values, previousValues, shapeVertexCounts.length),
      dirtyFrom: previousTransforms,
    });
    samples.push(sample);
    previousValues = values;
    previousSample = sample;
  }

  const frame660 = samples[659];
  const baseMatrices = new Map([
    ...deformationRuntime.nets.map(({ id, localMatrix }) => [id, localMatrix]),
    ...deformationRuntime.joints.map(({ id, localMatrix }) => [id, localMatrix]),
  ]);
  const eyeBases = Object.fromEntries(eyeRuntime.attachmentIds.map((id) => {
    const matrix = frame660.objectMatrixOverrides[id] ?? baseMatrices.get(id);
    if (!matrix) throw new Error(`Eye attachment ${id} is absent from the prepared base pose.`);
    return [id, matrix];
  }));
  const idleEye = eyeModule.stepTitleHeadEyeFollow(eyeRuntime, {
    animatorState: Object.freeze({
      schema: animatorModule.TITLE_HEAD_ANIMATOR_STATE_SCHEMA,
      tick: 0,
      state: 7,
      frame: 660,
      animSeqNum: 0,
      nods: 5,
      stillTimer: 150,
    }),
    control: eyeModule.createGoddardControlState(),
    attachmentRotationBaseMatrices: eyeBases,
  });
  const idleEyeSnapshot = deformationModule.evaluateTitleHeadDeformation(deformationRuntime, {
    tick: FRAME_COUNT,
    localMatrixOverrides: Object.freeze({
      ...frame660.objectMatrixOverrides,
      ...idleEye.attachmentRotationMatrixOverrides,
    }),
  });
  const idleEyeValues = flattenDraw(
    drawModule.evaluateTitleHeadDrawRuntime(drawRuntime, idleEyeSnapshot),
    shapeVertexCounts,
  );
  appendProfile({
    sourceValues: idleEyeValues,
    channelMask: profiles[659].channelMask,
    shapeMask: (2 ** shapeVertexCounts.length - 1) >>> 0,
    dirtyFrom: null,
  });

  const { output, layout } = encode({
    animation,
    deformation,
    trianglePlan,
    shapeVertexCounts,
    profiles,
    faceStateTransforms,
    profileFaceStateIndices,
  });
  const faceStateOffsets = new Uint32Array(
    output.buffer,
    output.byteOffset + layout.faceTransformStateOffsetsOffset,
    trianglePlan.leaves.length + 1,
  );
  const parityComparisons = verifyEncodedParity({
    output,
    layout,
    profiles,
    trianglePlan,
    positionsOffset,
    shapeVertexOffsets,
    optionsByEdgeMask,
  });
  const temporaryOutput = `${OUTPUT}.next-${process.pid}`;
  writeFileSync(temporaryOutput, output);
  renameSync(temporaryOutput, OUTPUT);
  const frame500Changes = profiles[499].channelMask.toString(2).replaceAll("0", "").length;
  const averageDirtyFaces = Math.round(
    profiles.slice(0, FRAME_COUNT).reduce((total, profile) => total + profile.dirtyFaces.length, 0) / FRAME_COUNT,
  );
  console.log(
    `Prepared title-head motion: ${FRAME_COUNT} frames + idle eyes, ${Math.round(output.length / 1024)} KiB, `
    + `${layout.transformStateCount} exact face states, ${averageDirtyFaces} average dirty faces, `
    + `${parityComparisons} byte-identical transform checks, frame 500 ${frame500Changes} changed channels.`,
  );
  return Object.freeze({
    output: OUTPUT,
    bytes: output,
    layout,
    sampling: Object.freeze({
      positionsOffset,
      shapeVertexCounts: Object.freeze([...shapeVertexCounts]),
      shapeVertexOffsets: Object.freeze([...shapeVertexOffsets]),
      profiles: Object.freeze(profiles.map((profile) => Object.freeze({
        sourceValues: profile.sourceValues,
        channelMask: profile.channelMask,
        shapeMask: profile.shapeMask,
      }))),
    }),
    playback: Object.freeze({
      affineEvaluations: playbackAffineEvaluations,
      timeline: playbackTimeline,
      profiles: Object.freeze(playbackProfiles),
      profileFaceStateIndices,
      faceStateOffsets,
    }),
  });
}
}

// footprintMotion
const FOOTPRINT_MAGIC = "CSMOTN01";
const FOOTPRINT_HEADER_BYTES = 176;

function dirtyFaces(
  current,
  previous,
  leaves,
  shapeVertexOffsets,
  positionsOffset,
) {
  if (previous === null) {
    return Uint16Array.from(leaves.map((_, index) => index));
  }
  const dirty = [];
  for (let faceIndex = 0; faceIndex < leaves.length; faceIndex += 1) {
    const update = leaves[faceIndex].polycss.update;
    const shapeOffset = shapeVertexOffsets[update.shapeStateIndex];
    let changed = false;
    for (const vertexIndex of update.vertexIndices) {
      const offset = positionsOffset + (shapeOffset + vertexIndex) * 3;
      if (!sameRange(current, offset, previous, offset, 3)) {
        changed = true;
        break;
      }
    }
    if (changed) {
      dirty.push(faceIndex);
    }
  }
  return Uint16Array.from(dirty);
}

function encodeFootprintMotion({
  animation,
  deformation,
  trianglePlan,
  shapeVertexCounts,
  profiles,
}) {
  const profileCount = profiles.length;
  const shapeCount = shapeVertexCounts.length;
  const vertexCount = shapeVertexCounts.reduce(
    (total, count) => total + count,
    0,
  );
  const faceCount = trianglePlan.leaves.length;
  const channelCount = animation.channels.length;
  const floatsPerProfile = profiles[0].values.length;
  const dirtyIndexCount = profiles.reduce(
    (total, profile) => total + profile.dirtyFaces.length,
    0,
  );

  let offset = FOOTPRINT_HEADER_BYTES;
  const shapeVertexCountsOffset = offset;
  offset += shapeCount * 4;
  const dirtyOffsetsOffset = offset;
  offset += (profileCount + 1) * 4;
  const channelMasksOffset = offset;
  offset += profileCount * 4;
  const shapeMasksOffset = offset;
  offset += profileCount * 4;
  const dirtyFacesOffset = align(offset, 2);
  offset = dirtyFacesOffset + dirtyIndexCount * 2;
  const frameFloatsOffset = align(offset, 4);
  const fileBytes = frameFloatsOffset + profileCount * floatsPerProfile * 4;

  const output = Buffer.alloc(fileBytes);
  output.write(FOOTPRINT_MAGIC, 0, "ascii");
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  const fields = [
    FOOTPRINT_HEADER_BYTES,
    FRAME_COUNT,
    profileCount,
    shapeCount,
    vertexCount,
    faceCount,
    channelCount,
    floatsPerProfile,
    dirtyIndexCount,
    shapeVertexCountsOffset,
    dirtyOffsetsOffset,
    channelMasksOffset,
    shapeMasksOffset,
    dirtyFacesOffset,
    frameFloatsOffset,
    fileBytes,
    FRAME_COUNT,
    0,
  ];
  for (let index = 0; index < fields.length; index += 1) {
    view.setUint32(8 + index * 4, fields[index], true);
  }
  output.set(hashBytes(animation.contentHash, "animation"), 80);
  output.set(hashBytes(deformation.contentHash, "deformation"), 112);
  output.set(hashBytes(trianglePlan.contentHash, "triangle plan"), 144);

  const shapeCounts = new Uint32Array(
    output.buffer,
    output.byteOffset + shapeVertexCountsOffset,
    shapeCount,
  );
  shapeCounts.set(shapeVertexCounts);
  const dirtyOffsets = new Uint32Array(
    output.buffer,
    output.byteOffset + dirtyOffsetsOffset,
    profileCount + 1,
  );
  const channelMasks = new Uint32Array(
    output.buffer,
    output.byteOffset + channelMasksOffset,
    profileCount,
  );
  const shapeMasks = new Uint32Array(
    output.buffer,
    output.byteOffset + shapeMasksOffset,
    profileCount,
  );
  const faceIndices = new Uint16Array(
    output.buffer,
    output.byteOffset + dirtyFacesOffset,
    dirtyIndexCount,
  );
  const frameValues = new Float32Array(
    output.buffer,
    output.byteOffset + frameFloatsOffset,
    profileCount * floatsPerProfile,
  );
  let dirtyOffset = 0;
  for (let profileIndex = 0; profileIndex < profileCount; profileIndex += 1) {
    const profile = profiles[profileIndex];
    dirtyOffsets[profileIndex] = dirtyOffset;
    faceIndices.set(profile.dirtyFaces, dirtyOffset);
    dirtyOffset += profile.dirtyFaces.length;
    channelMasks[profileIndex] = profile.channelMask;
    shapeMasks[profileIndex] = profile.shapeMask;
    frameValues.set(profile.values, profileIndex * floatsPerProfile);
  }
  dirtyOffsets[profileCount] = dirtyOffset;
  return output;
}

function buildTitleHeadFootprintMotion({
  animation,
  deformation,
  sampling,
  trianglePlan,
} = {}) {
  if (
    animation?.totals?.channels !== 25
    || trianglePlan?.totals?.sourceFaces !== 1213
    || sampling?.profiles?.length !== FRAME_COUNT + 1
  ) {
    throw new Error("Prepared regular-head footprint motion closure drifted.");
  }
  const {
    positionsOffset,
    profiles: sampledProfiles,
    shapeVertexCounts,
    shapeVertexOffsets,
  } = sampling;
  let previousValues = null;
  const profiles = sampledProfiles.map((sampled, profileIndex) => {
    const values = sampled.sourceValues;
    const profile = {
      values,
      channelMask: sampled.channelMask,
      shapeMask: sampled.shapeMask,
      dirtyFaces: dirtyFaces(
        values,
        profileIndex === FRAME_COUNT ? null : previousValues,
        trianglePlan.leaves,
        shapeVertexOffsets,
        positionsOffset,
      ),
    };
    previousValues = values;
    return profile;
  });
  const bytes = encodeFootprintMotion({
    animation,
    deformation,
    trianglePlan,
    shapeVertexCounts,
    profiles,
  });
  return Object.freeze({
    bytes,
    frameCount: FRAME_COUNT,
    profileCount: profiles.length,
    faceCount: trianglePlan.leaves.length,
    workspace: Object.freeze({
      shapeVertexCounts: Object.freeze([...shapeVertexCounts]),
      profiles: Object.freeze(profiles.map(({ values }) => values)),
    }),
  });
}

// surfaceFootprintsProducer
const CONTRACT = Object.freeze({
  reportSha256: "4e84294af8a448f2d63bc6b1c541ff8c5316a3dde85af01965620140261dbb86",
  rawVisibilitySha256: "c4ba58ad0c40e11145f37c3bbc96c235ed9b028138e79d98cbd8f9c0e39b6b59",
  retainedVisibilitySha256: "1f183f7b8219ce7454524e95ab9bfd14cc4ea8188844f5d9d4ee63c9f8a88c56",
  frameCount: 820,
  profileCount: 821,
  shapeCount: 6,
  vertexCount: 644,
  faceCount: 1213,
  floatsPerProfile: 2044,
  sourceViewport: Object.freeze({ width: 320, height: 240 }),
  measurementViewport: Object.freeze({ width: 1280, height: 960 }),
  sourceScale: 4,
  firstPlaybackTick: 1563,
});

const VISIBILITY_MINIMUM_HIDDEN_RUN = 3;
const VISIBILITY_TRANSITION_WINDOW = 16;
const VISIBILITY_TRANSITION_CAP = 32;

function fail(message) {
  throw new Error(message);
}

function requireSurfaceHash(label, bytes, expected) {
  const actual = titleHeadSha256(bytes);
  if (actual !== expected) {
    fail(`${label} SHA-256 drifted: expected ${expected}, received ${actual}`);
  }
}

function multiply(left, right) {
  const output = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += left[inner * 4 + row] * right[column * 4 + inner];
      }
      output[column * 4 + row] = value;
    }
  }
  return output;
}

function translation(x, y, z) {
  return Float64Array.from([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function rotateX(radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return Float64Array.from([
    1, 0, 0, 0,
    0, cosine, sine, 0,
    0, -sine, cosine, 0,
    0, 0, 0, 1,
  ]);
}

function rotateZ(radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return Float64Array.from([
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function transformPoint(matrix, x, y, z = 0) {
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  };
}

function sourceMatrix(values, offset) {
  const order = [2, 0, 1, 3];
  return Float64Array.from(order.flatMap((row) => (
    order.map((column) => values[offset + row * 4 + column])
  )));
}

function cssMatrix(text) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(text);
  if (match === null) {
    fail(`Invalid PolyCSS matrix: ${text}`);
  }
  const values = match[1].split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    fail(`Invalid PolyCSS matrix values: ${text}`);
  }
  return Float64Array.from(values);
}

function triangleOptions(plan) {
  const repair = plan.mount.seamRepair;
  return Array.from({ length: 8 }, (_, mask) => {
    const seamEdges = new Set();
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      if ((mask & (1 << edgeIndex)) !== 0) {
        seamEdges.add(edgeIndex);
      }
    }
    return {
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: mask === 0 ? repair.fallbackAmount : repair.sharedEdgeAmount,
      ...(mask === 0 ? {} : { seamEdges }),
    };
  });
}

function playbackFrames(count) {
  const frames = new Uint16Array(count);
  let state = 0;
  let frame = 1;
  let nods = 0;
  for (let tick = 0; tick < count; tick += 1) {
    frames[tick] = frame;
    if (state === 0) {
      frame = 1;
      state = 2;
      nods = 5;
    } else if (state === 2) {
      frame += 1;
      if (frame === 810) {
        frame = 750;
        nods -= 1;
        if (nods === 0) {
          state = 3;
        }
      }
    } else if (state === 3) {
      frame += 1;
      if (frame === 820) {
        frame = 69;
        state = 4;
      }
    } else if (state === 4) {
      frame += 1;
      if (frame === 660) {
        frame = 661;
        state = 2;
        nods = 5;
      }
    } else {
      fail(`Unexpected playback state: ${state}`);
    }
  }
  return frames;
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.floor((sortedValues.length - 1) * fraction)];
}

function rawVisibleByFace(rawReport) {
  const output = Array.from(
    { length: CONTRACT.faceCount },
    () => new Uint8Array(CONTRACT.frameCount),
  );
  for (const frame of rawReport.frames) {
    for (const faceIndex of frame.visibleIds) {
      output[faceIndex][frame.frame - 1] = 1;
    }
  }
  return output;
}

function retainedVisibilityRows(rawReport) {
  const visibleByFace = rawVisibleByFace(rawReport);
  const runs = [];
  const permanentlyHidden = [];
  for (let faceIndex = 0;
    faceIndex < CONTRACT.faceCount;
    faceIndex += 1) {
    const visible = visibleByFace[faceIndex];
    const firstVisible = visible.findIndex(Boolean);
    if (firstVisible === -1) {
      permanentlyHidden.push(faceIndex);
      continue;
    }
    let distance = 1;
    while (distance <= CONTRACT.frameCount) {
      const frameIndex = (firstVisible + distance) % CONTRACT.frameCount;
      if (visible[frameIndex]) {
        distance += 1;
        continue;
      }
      let length = 0;
      while (length < CONTRACT.frameCount
        && !visible[(frameIndex + length) % CONTRACT.frameCount]) {
        length += 1;
      }
      if (length >= VISIBILITY_MINIMUM_HIDDEN_RUN) {
        runs.push({ faceIndex, start: frameIndex, length });
      }
      distance += length;
    }
  }
  runs.sort((left, right) => (
    right.length - left.length
    || left.faceIndex - right.faceIndex
    || left.start - right.start
  ));
  const transitionsPerFrame = new Uint16Array(CONTRACT.frameCount);
  const selections = [];
  for (const run of runs) {
    const boundaryWindow = Math.min(
      VISIBILITY_TRANSITION_WINDOW,
      run.length,
    );
    let hideOffset = -1;
    let showRetreat = -1;
    for (let offset = 0; offset < boundaryWindow; offset += 1) {
      const frameIndex = (run.start + offset) % CONTRACT.frameCount;
      if (transitionsPerFrame[frameIndex] < VISIBILITY_TRANSITION_CAP) {
        hideOffset = offset;
        break;
      }
    }
    for (let retreat = 0; retreat < boundaryWindow; retreat += 1) {
      const frameIndex = (
        run.start + run.length - retreat
      ) % CONTRACT.frameCount;
      if (transitionsPerFrame[frameIndex] < VISIBILITY_TRANSITION_CAP) {
        showRetreat = retreat;
        break;
      }
    }
    const showDistance = run.length - showRetreat;
    if (hideOffset < 0
      || showRetreat < 0
      || hideOffset >= showDistance) {
      continue;
    }
    const hideFrame = (run.start + hideOffset) % CONTRACT.frameCount;
    const showFrame = (run.start + showDistance) % CONTRACT.frameCount;
    transitionsPerFrame[hideFrame] += 1;
    transitionsPerFrame[showFrame] += 1;
    selections.push({ run, hideFrame, showFrame });
  }
  const rows = Array.from({ length: CONTRACT.frameCount }, () => {
    const row = new Uint8Array(CONTRACT.faceCount);
    row.fill(1);
    return row;
  });
  for (const faceIndex of permanentlyHidden) {
    for (const row of rows) row[faceIndex] = 0;
  }
  for (const selection of selections) {
    for (let frameIndex = selection.hideFrame;
      frameIndex !== selection.showFrame;
      frameIndex = (frameIndex + 1) % CONTRACT.frameCount) {
      rows[frameIndex][selection.run.faceIndex] = 0;
    }
  }
  for (let frameIndex = 0;
    frameIndex < CONTRACT.frameCount;
    frameIndex += 1) {
    for (let faceIndex = 0;
      faceIndex < CONTRACT.faceCount;
      faceIndex += 1) {
      if (!rows[frameIndex][faceIndex]
        && visibleByFace[faceIndex][frameIndex]) {
        fail(
          `Retained visibility hides visible face ${faceIndex} `
          + `at frame ${frameIndex + 1}`,
        );
      }
    }
  }
  return rows;
}

function buildRetainedVisibilityReport(rawReport) {
  const rows = retainedVisibilityRows(rawReport);
  return {
    schema: "cssgraphics-mathematical-visibility-audit@1-conservative-union",
    atlasAlphaConsulted: false,
    criterion: "positive-area frontmost ideal projected triangle inside viewport",
    summary: {
      faces: CONTRACT.faceCount,
      frames: CONTRACT.frameCount,
    },
    frames: rows.map((row, frameIndex) => ({
      frame: frameIndex + 1,
      visibleIds: [...row].flatMap(
        (visible, faceIndex) => visible ? [faceIndex] : [],
      ),
    })),
  };
}

function prepareFootprintReport(trianglePlan, motion) {
  if (
    trianglePlan.leaves?.length !== CONTRACT.faceCount
    || trianglePlan.mount?.faceLeaves !== CONTRACT.faceCount
    || trianglePlan.mount?.shapeRoots !== CONTRACT.shapeCount
  ) {
    fail("Triangle-plan topology drifted");
  }

  const shapeVertexCounts = motion?.workspace?.shapeVertexCounts;
  const profiles = motion?.workspace?.profiles;
  const frameCount = motion?.frameCount;
  const faceCount = motion?.faceCount;
  const shapeCount = shapeVertexCounts?.length;
  if (frameCount !== CONTRACT.frameCount
    || motion?.profileCount !== CONTRACT.profileCount
    || faceCount !== CONTRACT.faceCount
    || shapeCount !== CONTRACT.shapeCount
    || !Array.isArray(profiles)
    || profiles.length !== CONTRACT.profileCount
    || profiles.some((values) => (
      !(values instanceof Float32Array)
      || values.length !== CONTRACT.floatsPerProfile
    ))) {
    fail("Motion closure drifted");
  }

  const shapeVertexOffsets = [];
  let accumulatedVertices = 0;
  for (const count of shapeVertexCounts) {
    shapeVertexOffsets.push(accumulatedVertices);
    accumulatedVertices += count;
  }
  if (accumulatedVertices !== CONTRACT.vertexCount) {
    fail("Motion vertex closure drifted");
  }

  const perspective = 120 / Math.tan(Math.PI / 8);
  const cameraTargetDepth = Math.round(((2000 - perspective) / 50) * 100) / 100;
  const camera = multiply(
    multiply(rotateX(Math.PI / 2), rotateZ(Math.PI / 2)),
    translation(-cameraTargetDepth * 50, 0, -200),
  );
  const frameWidths = new Float32Array(frameCount * faceCount);
  const frameHeights = new Float32Array(frameCount * faceCount);
  const corners = [[0, 0], [32, 0], [0, 32], [32, 32]];
  const options = triangleOptions(trianglePlan);
  const leafMatrices = trianglePlan.leaves.map((leaf) => (
    cssMatrix(leaf.polycss.transform)
  ));
  const positionsStart = (1 + shapeCount) * 16;
  const viewportCenterX = CONTRACT.measurementViewport.width / 2;
  const viewportCenterY = CONTRACT.measurementViewport.height / 2;

  for (let profileIndex = 0; profileIndex < frameCount; profileIndex += 1) {
    const values = profiles[profileIndex];
    const sourceScene = sourceMatrix(values, 0);
    const scene = multiply(camera, sourceScene);
    const shapes = Array.from({ length: shapeCount }, (_, shapeIndex) => (
      multiply(
        scene,
        sourceMatrix(values, 16 + shapeIndex * 16),
      )
    ));

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const leaf = trianglePlan.leaves[faceIndex];
      const update = leaf.polycss.update;
      const shapePositionOffset = positionsStart
        + shapeVertexOffsets[update.shapeStateIndex] * 3;
      const points = update.vertexIndices.map((index) => (
        shapePositionOffset + index * 3
      ));
      const affine = computeSolidTrianglePlanFromCssPoints(
        leaf.polycss,
        leaf.sourceOrder,
        options[update.seamEdgeMask],
        {
          basis: leaf.polycss.basis,
          matrixDecimals: update.matrixDecimals,
          primitive: "corner-bevel",
          includeColor: false,
        },
        values[points[0] + 2],
        values[points[0]],
        values[points[0] + 1],
        values[points[1] + 2],
        values[points[1]],
        values[points[1] + 1],
        values[points[2] + 2],
        values[points[2]],
        values[points[2] + 1],
      );
      if (affine !== null) {
        const affineMatrix = cssMatrix(affine.transformText);
        leafMatrices[faceIndex] = affineMatrix;
      }

      const combined = multiply(
        shapes[update.shapeStateIndex],
        leafMatrices[faceIndex],
      );
      let minimumX = Infinity;
      let maximumX = -Infinity;
      let minimumY = Infinity;
      let maximumY = -Infinity;
      for (const [x, y] of corners) {
        const point = transformPoint(combined, x, y);
        const projectionScale = perspective / (perspective - point.z);
        const screenX = Math.fround(
          viewportCenterX + point.x * projectionScale * CONTRACT.sourceScale,
        );
        const screenY = Math.fround(
          viewportCenterY + point.y * projectionScale * CONTRACT.sourceScale,
        );
        minimumX = Math.min(minimumX, screenX);
        maximumX = Math.max(maximumX, screenX);
        minimumY = Math.min(minimumY, screenY);
        maximumY = Math.max(maximumY, screenY);
      }
      const frameOffset = profileIndex * faceCount + faceIndex;
      frameWidths[frameOffset] = (maximumX - minimumX) / CONTRACT.sourceScale;
      frameHeights[frameOffset] = (maximumY - minimumY) / CONTRACT.sourceScale;
    }
  }

  const playback = playbackFrames(
    CONTRACT.firstPlaybackTick + CONTRACT.frameCount,
  );
  const maxWidths = new Float32Array(faceCount);
  const maxHeights = new Float32Array(faceCount);
  for (let sample = 0; sample < frameCount; sample += 1) {
    const frame = playback[CONTRACT.firstPlaybackTick + sample];
    const frameOffset = (frame - 1) * faceCount;
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const width = frameWidths[frameOffset + faceIndex];
      const height = frameHeights[frameOffset + faceIndex];
      if (width > maxWidths[faceIndex]) {
        maxWidths[faceIndex] = width;
      }
      if (height > maxHeights[faceIndex]) {
        maxHeights[faceIndex] = height;
      }
    }
  }

  const widths = Uint8Array.from(
    maxWidths,
    (value) => Math.min(255, Math.ceil(value)),
  );
  const heights = Uint8Array.from(
    maxHeights,
    (value) => Math.min(255, Math.ceil(value)),
  );
  const sortedWidths = [...maxWidths].sort((left, right) => left - right);
  const sortedHeights = [...maxHeights].sort((left, right) => left - right);
  const sortedAreas = [
    ...maxWidths.map((width, index) => width * maxHeights[index]),
  ].sort((left, right) => left - right);

  const report = {
    schema: "cssgraphics-title-head-surface-footprints@1",
    sourceViewport: CONTRACT.sourceViewport,
    samples: frameCount,
    faceCount,
    widthsBase64: Buffer.from(widths).toString("base64"),
    heightsBase64: Buffer.from(heights).toString("base64"),
    stats: {
      width: {
        p50: percentile(sortedWidths, 0.5),
        p95: percentile(sortedWidths, 0.95),
        max: sortedWidths.at(-1),
      },
      height: {
        p50: percentile(sortedHeights, 0.5),
        p95: percentile(sortedHeights, 0.95),
        max: sortedHeights.at(-1),
      },
      area: {
        p50: percentile(sortedAreas, 0.5),
        p95: percentile(sortedAreas, 0.95),
        max: sortedAreas.at(-1),
      },
    },
  };
  return Object.freeze({
    report,
    faces: Object.freeze(Array.from(
      { length: faceCount },
      (_, faceIndex) => Object.freeze({
        width: Math.max(4, widths[faceIndex]),
        height: Math.max(4, heights[faceIndex]),
      }),
    )),
  });
}

function prepareTitleHeadSurfaceFootprints({
  trianglePlan,
  motion,
  output: outputOption,
}) {
  const outputPath = resolve(outputOption);
  const prepared = prepareFootprintReport(trianglePlan, motion);
  const reportBytes = Buffer.from(
    `${JSON.stringify(prepared.report, null, 2)}\n`,
  );
  requireSurfaceHash("Generated report", reportBytes, CONTRACT.reportSha256);

  mkdirSync(dirname(outputPath), { recursive: true });
  const nextPath = `${outputPath}.next-${process.pid}`;
  writeFileSync(nextPath, reportBytes);
  renameSync(nextPath, outputPath);

  console.log(JSON.stringify({
    output: outputPath,
    bytes: reportBytes.length,
    sha256: titleHeadSha256(reportBytes),
  }, null, 2));
  return Object.freeze({
    output: outputPath,
    bytes: reportBytes,
    report: prepared.report,
    faces: prepared.faces,
  });
}

function prepareTitleHeadRetainedVisibility({
  rawVisibility,
  rawVisibilityBytes,
  output,
}) {
  requireSurfaceHash(
    "Recovered raw visibility",
    rawVisibilityBytes,
    CONTRACT.rawVisibilitySha256,
  );
  const report = buildRetainedVisibilityReport(rawVisibility);
  const bytes = Buffer.from(JSON.stringify(report));
  requireSurfaceHash(
    "Generated retained visibility",
    bytes,
    CONTRACT.retainedVisibilitySha256,
  );
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  const nextPath = `${outputPath}.next-${process.pid}`;
  writeFileSync(nextPath, bytes);
  renameSync(nextPath, outputPath);
  const result = Object.freeze({
    output: outputPath,
    bytes,
    report,
    sha256: titleHeadSha256(bytes),
    rawSha256: titleHeadSha256(rawVisibilityBytes),
  });
  console.log(JSON.stringify({
    visibility: {
      output: result.output,
      bytes: bytes.length,
      sha256: result.sha256,
      rawSha256: result.rawSha256,
    },
  }, null, 2));
  return result;
}

// footprintReportProducer
async function prepareTitleHeadFootprintReport({
  deformation,
  animation,
  geometry,
  materials,
  motionSampling,
  reportPath: reportPathOption,
}) {
  const trianglePlan = buildTitleHeadFootprintTrianglePlan({
    geometry,
    deformation,
    animation,
    materials,
  });
  const motion = buildTitleHeadFootprintMotion({
    deformation,
    animation,
    sampling: motionSampling,
    trianglePlan,
  });
  const trianglePlanBytes = Buffer.from(
    serializeTitleHeadContract(trianglePlan),
  );

  const reportPath = resolve(reportPathOption);
  const footprint = prepareTitleHeadSurfaceFootprints({
    trianglePlan,
    motion,
    output: reportPath,
  });

  return Object.freeze({
    reportPath,
    reportBytes: footprint.bytes,
    report: footprint.report,
    faces: footprint.faces,
    trianglePlanBytes,
    motionBytes: motion.bytes,
    motion,
  });
}
export {
  prepareTitleHeadFootprintReport,
  prepareTitleHeadMotion,
  prepareTitleHeadRetainedVisibility,
};
