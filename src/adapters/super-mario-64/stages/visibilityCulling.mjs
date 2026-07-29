import {
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";
import {
  TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE,
  TITLE_HEAD_LIGHTING_NODE_BYTES,
  TITLE_HEAD_LIGHTING_STATE_FIELD_SCHEMA,
  optimizeTitleHeadSpatialResolution,
  selectTitleHeadLeafRasterSize,
} from "./spatialResolution.mjs";

// motionTransformTable
const TITLE_HEAD_MOTION_TRANSFORM_TABLE_SCHEMA =
  "cssgraphics-title-head-motion-transform-table@1";
const TITLE_HEAD_MOTION_TRANSFORM_TABLE_PATH =
  "motion-transform-strings.bin";

const MOTION_MAGIC = "CSMOTN02";
const TABLE_MAGIC = "CSMTRN01";
const TABLE_HEADER_BYTES = 136;
const AFFINE_STATE_BYTES = 32;
const DEGENERATE_AFFINE = -0x8000;

function motionTableFail(message) {
  throw new Error(`Title-head motion transform preparation: ${message}`);
}

function hashBytes(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    motionTableFail(`${label} is not a SHA-256 hash`);
  }
  return Buffer.from(value, "hex");
}

function uint(view, offset, label) {
  if (offset < 0 || offset + 4 > view.byteLength) {
    motionTableFail(`${label} is outside the motion header`);
  }
  return view.getUint32(offset, true);
}

function exactMagic(bytes, expected) {
  if (bytes.byteLength < expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function motionTableCssNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
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

function leafSizing(trianglePlan, lighting) {
  if (trianglePlan?.contentHash !== lighting?.trianglePlanHash
    || !Array.isArray(trianglePlan?.leaves)
    || !Array.isArray(lighting?.surface?.faces)
    || trianglePlan.leaves.length !== lighting.surface.faces.length) {
    motionTableFail("triangle plan and final lighting topology do not match");
  }
  const faces = trianglePlan.leaves.map((leaf, faceIndex) => {
    const lightingFace = lighting.surface.faces[faceIndex];
    const canonicalSize = leaf?.polycss?.update?.canonicalSize;
    if (leaf?.sourceOrder !== faceIndex
      || lightingFace?.faceId !== leaf.faceId
      || !Number.isFinite(canonicalSize) || canonicalSize <= 0
      || !Number.isSafeInteger(lightingFace.leafWidth) || lightingFace.leafWidth <= 0
      || !Number.isSafeInteger(lightingFace.leafHeight) || lightingFace.leafHeight <= 0) {
      motionTableFail(`face ${faceIndex} has incomplete final leaf sizing`);
    }
    return Object.freeze({
      faceId: leaf.faceId,
      width: lightingFace.leafWidth,
      height: lightingFace.leafHeight,
      canonicalSize,
    });
  });
  const payload = Object.freeze({
    schema: "cssgraphics-title-head-motion-leaf-sizing@1",
    trianglePlanHash: trianglePlan.contentHash,
    faces: Object.freeze(faces),
  });
  return Object.freeze({
    faces: payload.faces,
    contentHash: titleHeadContentHash(payload),
  });
}

function readMotionLayout(bytes, expectedFaceCount) {
  if (!(bytes instanceof Uint8Array) || !exactMagic(bytes, MOTION_MAGIC)) {
    motionTableFail("motion packet magic does not match");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const faceCount = uint(view, 28, "faceCount");
  const faceStateOffsetsOffset = uint(view, 184, "faceTransformStateOffsetsOffset");
  const transformStatesOffset = uint(view, 188, "transformStatesOffset");
  const transformStateBytes = uint(view, 192, "transformStateBytes");
  const stateCount = uint(view, 196, "transformStateCount");
  if (faceCount !== expectedFaceCount
    || stateCount === 0
    || transformStateBytes !== stateCount * AFFINE_STATE_BYTES
    || faceStateOffsetsOffset % 4 !== 0
    || faceStateOffsetsOffset + (faceCount + 1) * 4 > bytes.byteLength
    || transformStatesOffset + transformStateBytes > bytes.byteLength) {
    motionTableFail("motion packet transform layout is invalid");
  }
  const faceStateOffsets = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset + faceStateOffsetsOffset,
    faceCount + 1,
  );
  if (faceStateOffsets[0] !== 0 || faceStateOffsets[faceCount] !== stateCount) {
    motionTableFail("motion packet face state offsets do not close");
  }
  return Object.freeze({
    faceCount,
    stateCount,
    faceStateOffsets,
    stateView: new DataView(
      bytes.buffer,
      bytes.byteOffset + transformStatesOffset,
      transformStateBytes,
    ),
  });
}

function finalTransform(stateView, globalStateIndex, sizing) {
  const offset = globalStateIndex * AFFINE_STATE_BYTES;
  if (stateView.getInt16(offset, true) === DEGENERATE_AFFINE) return "";
  const basis = Array.from(
    { length: 9 },
    (_, index) => stateView.getInt16(offset + index * 2, true) / 1000,
  );
  const xScale = sizing.canonicalSize / sizing.width;
  const yScale = sizing.canonicalSize / sizing.height;
  for (const index of [0, 1, 2]) basis[index] *= xScale;
  for (const index of [3, 4, 5]) basis[index] *= yScale;
  const values = basis.map((value, index) => (
    index < 6 ? motionTableCssNumber(value) : milliCss(Math.round(value * 1000))
  ));
  const translation = Array.from(
    { length: 3 },
    (_, index) => milliCss(stateView.getInt32(offset + 20 + index * 4, true)),
  );
  return `matrix3d(${values[0]},${values[1]},${values[2]},0,`
    + `${values[3]},${values[4]},${values[5]},0,`
    + `${values[6]},${values[7]},${values[8]},0,`
    + `${translation[0]},${translation[1]},${translation[2]},1)`;
}

function buildTitleHeadMotionTransformTable({
  motionBytes,
  trianglePlan,
  lighting,
} = {}) {
  const motion = motionBytes instanceof Uint8Array
    ? motionBytes
    : new Uint8Array(motionBytes ?? 0);
  const sizing = leafSizing(trianglePlan, lighting);
  const layout = readMotionLayout(motion, sizing.faces.length);
  const strings = new Array(layout.stateCount);
  for (let faceIndex = 0; faceIndex < layout.faceCount; faceIndex += 1) {
    const start = layout.faceStateOffsets[faceIndex];
    const end = layout.faceStateOffsets[faceIndex + 1];
    for (let globalStateIndex = start; globalStateIndex < end; globalStateIndex += 1) {
      strings[globalStateIndex] = finalTransform(
        layout.stateView,
        globalStateIndex,
        sizing.faces[faceIndex],
      );
    }
  }

  const stringChunks = strings.map((value) => Buffer.from(value, "utf8"));
  const stringsBytes = stringChunks.reduce((total, bytes) => total + bytes.length, 0);
  const offsetCount = layout.stateCount + 1;
  const offsetsOffset = TABLE_HEADER_BYTES;
  const stringsOffset = offsetsOffset + offsetCount * 4;
  const fileBytes = stringsOffset + stringsBytes;
  const output = Buffer.allocUnsafe(fileBytes);
  output.fill(0, 0, TABLE_HEADER_BYTES);
  output.write(TABLE_MAGIC, 0, "ascii");
  const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
  for (const [offset, value] of [
    [8, TABLE_HEADER_BYTES],
    [12, layout.faceCount],
    [16, layout.stateCount],
    [20, offsetCount],
    [24, offsetsOffset],
    [28, stringsOffset],
    [32, stringsBytes],
    [36, fileBytes],
  ]) {
    outputView.setUint32(offset, value, true);
  }
  const motionSha256 = titleHeadSha256(motion);
  output.set(hashBytes(motionSha256, "motion packet hash"), 40);
  output.set(hashBytes(trianglePlan.contentHash, "triangle plan hash"), 72);
  output.set(hashBytes(sizing.contentHash, "leaf sizing hash"), 104);

  const offsets = new Uint32Array(
    output.buffer,
    output.byteOffset + offsetsOffset,
    offsetCount,
  );
  let stringOffset = 0;
  for (let index = 0; index < strings.length; index += 1) {
    offsets[index] = stringOffset;
    stringChunks[index].copy(output, stringsOffset + stringOffset);
    stringOffset += stringChunks[index].length;
  }
  offsets[strings.length] = stringOffset;
  if (stringOffset !== stringsBytes) motionTableFail("string table byte closure drifted");
  const decoded = output.subarray(stringsOffset).toString("utf8");
  if (decoded.length !== stringsBytes
    || strings.some((value, index) => (
      decoded.slice(offsets[index], offsets[index + 1]) !== value
    ))) {
    motionTableFail("encoded final transform strings changed during table construction");
  }

  return Object.freeze({
    bytes: output,
    strings: Object.freeze(strings),
    contract: Object.freeze({
      schema: TITLE_HEAD_MOTION_TRANSFORM_TABLE_SCHEMA,
      path: TITLE_HEAD_MOTION_TRANSFORM_TABLE_PATH,
      encoding: "uint32le-offset-indexed-utf8-final-css-matrix3d",
      faceCount: layout.faceCount,
      stateCount: layout.stateCount,
      offsetCount,
      stringsBytes,
      bytes: output.length,
      sha256: titleHeadSha256(output),
      motionSha256,
      trianglePlanHash: trianglePlan.contentHash,
      leafSizingHash: sizing.contentHash,
      runtimeFormatting: false,
    }),
  });
}

function attachTitleHeadMotionTransformTable(lighting, table) {
  if (!lighting || typeof lighting !== "object"
    || !table?.contract || !(table.bytes instanceof Uint8Array)) {
    motionTableFail("lighting contract and transform table are required");
  }
  const {
    contentHash: _contentHash,
    motionTransforms: _motionTransforms,
    ...stable
  } = lighting;
  const payload = Object.freeze({
    ...stable,
    motionTransforms: table.contract,
  });
  return Object.freeze({
    ...payload,
    contentHash: titleHeadContentHash(payload),
  });
}

// visibilityCullingProducer
const FRAME_COUNT = 820;
const FACE_COUNT = 1213;
const PAGE_LIMIT = 4096;
const TILE_GUTTER = 1;
const MAX_STATE_COLUMNS = 41;
const MAXIMUM_LEAF_TRANSFORM_STRETCH = 1;
const BASE_LIGHTING_SCHEMA = "cssgraphics-title-head-lighting-atlases@7";
const COMPACT_LIGHTING_SCHEMA = "cssgraphics-title-head-lighting-atlases@9";
const MINIMUM_HIDDEN_RUN = 3;
const TRANSITION_WINDOW = 16;
const TRANSITION_CAP = 64;
const CANONICAL_BASELINE_TRANSITION_CAP = 32;
const VISIBILITY_MUTATIONS_PER_HIDDEN_RUN = 2;
const REVEAL_LIGHTING_MUTATIONS_PER_HIDDEN_RUN = 1;
const STEADY_LOOP_TICK_COUNT = 1050;
const NON_INTERACTIVE_JUMPS = Object.freeze([
  Object.freeze([809, 750]),
  Object.freeze([819, 69]),
  Object.freeze([659, 661]),
]);
const MUSTACHE_SHAPE_ID = "mario-mustache";

function fail(message) {
  throw new Error(`Title-head visibility culling: ${message}`);
}

function transformSamplingSignature(report) {
  return titleHeadSha256(Buffer.from(JSON.stringify({
    sourceViewport: report.sourceViewport,
    sourceFrames: report.sourceFrames,
    sampledFrameMinimum: report.sampledFrameMinimum,
    sampledFrameMaximum: report.sampledFrameMaximum,
    trianglePlanHash: report.trianglePlanHash,
    method: report.method,
    interpretation: report.interpretation,
    summary: report.summary,
    byShape: report.byShape,
    byMaterial: report.byMaterial,
    offenders: report.offenders,
    faces: report.faces,
  })));
}

function uint16LeBase64(values) {
  const bytes = Buffer.allocUnsafe(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    bytes.writeUInt16LE(values[index], index * 2);
  }
  return bytes.toString("base64");
}

function uint32LeBase64(values) {
  const bytes = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    bytes.writeUInt32LE(values[index], index * 4);
  }
  return bytes.toString("base64");
}

function bitsetBase64(values) {
  const bytes = Buffer.alloc(Math.ceil(values.length / 8));
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]) bytes[index >> 3] |= 1 << (index & 7);
  }
  return bytes.toString("base64");
}

function cssNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pagePath(index) {
  return index === 0
    ? "model/title-head-lit-surface.png"
    : `model/title-head-lit-surface-${String(index).padStart(2, "0")}.png`;
}

function nativePagePath(index) {
  return index === 0
    ? "model/title-head-lit-native.png"
    : `model/title-head-lit-native-${String(index).padStart(2, "0")}.png`;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function visibilityRows(audit) {
  if (audit?.schema !== "cssgraphics-mathematical-visibility-audit@1-conservative-union"
    || audit.atlasAlphaConsulted !== false
    || audit.criterion !== "positive-area frontmost ideal projected triangle inside viewport"
    || audit.summary?.faces !== FACE_COUNT
    || audit.summary?.frames !== FRAME_COUNT
    || !Array.isArray(audit.frames)
    || audit.frames.length !== FRAME_COUNT) {
    fail("the conservative mathematical 820-frame audit is required");
  }
  const visibleByFace = Array.from({ length: FACE_COUNT }, () => new Uint8Array(FRAME_COUNT));
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const frame = audit.frames[frameIndex];
    if (frame?.frame !== frameIndex + 1 || !Array.isArray(frame.visibleIds)) {
      fail(`audit frame ${frameIndex + 1} is incomplete`);
    }
    let previous = -1;
    for (const faceIndex of frame.visibleIds) {
      if (!Number.isSafeInteger(faceIndex) || faceIndex <= previous || faceIndex >= FACE_COUNT) {
        fail(`audit frame ${frameIndex + 1} has invalid face order`);
      }
      visibleByFace[faceIndex][frameIndex] = 1;
      previous = faceIndex;
    }
  }
  return visibleByFace;
}

function hiddenRuns(visibleByFace) {
  const runs = [];
  const permanentlyHidden = [];
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    const visible = visibleByFace[faceIndex];
    const firstVisible = visible.findIndex(Boolean);
    if (firstVisible === -1) {
      permanentlyHidden.push(faceIndex);
      continue;
    }
    let distance = 1;
    while (distance <= FRAME_COUNT) {
      const frameIndex = (firstVisible + distance) % FRAME_COUNT;
      if (visible[frameIndex]) {
        distance += 1;
        continue;
      }
      let length = 0;
      while (length < FRAME_COUNT && !visible[(frameIndex + length) % FRAME_COUNT]) length += 1;
      if (length >= MINIMUM_HIDDEN_RUN) {
        runs.push(Object.freeze({ faceIndex, start: frameIndex, length }));
      }
      distance += length;
    }
  }
  runs.sort((left, right) => (
    right.length - left.length
    || left.faceIndex - right.faceIndex
    || left.start - right.start
  ));
  return Object.freeze({ runs: Object.freeze(runs), permanentlyHidden: Object.freeze(permanentlyHidden) });
}

function circularPrefix(changes) {
  const prefix = new Uint16Array(FRAME_COUNT * 2 + 1);
  for (let index = 0; index < FRAME_COUNT * 2; index += 1) {
    prefix[index + 1] = prefix[index] + changes[index % FRAME_COUNT];
  }
  return prefix;
}

function appendFrameRange(output, firstFrame, lastFrame) {
  for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
    output.push(frame - 1);
  }
}

function steadyLoopSourceFrames() {
  const frames = [];
  appendFrameRange(frames, 661, 809);
  for (let nod = 0; nod < 4; nod += 1) {
    appendFrameRange(frames, 750, 809);
  }
  appendFrameRange(frames, 750, 819);
  appendFrameRange(frames, 69, 659);
  if (frames.length !== STEADY_LOOP_TICK_COUNT) {
    fail("the exact non-interactive steady loop drifted");
  }
  return Object.freeze(frames);
}

function frameInsideRun(frameIndex, run) {
  return (frameIndex - run.start + FRAME_COUNT) % FRAME_COUNT < run.length;
}

function loopWeightedLightingAreaScore(
  run,
  stateIndicesByFace,
  rasterAreaByFace,
  sourceFrames,
) {
  const states = stateIndicesByFace[run.faceIndex];
  let allVisibleLightingWrites = 0;
  let scheduledLightingWrites = 0;
  for (let tick = 0; tick < sourceFrames.length; tick += 1) {
    const previousFrame = sourceFrames[
      (tick + sourceFrames.length - 1) % sourceFrames.length
    ];
    const targetFrame = sourceFrames[tick];
    const changed = states[previousFrame] !== states[targetFrame];
    if (changed) allVisibleLightingWrites += 1;
    const previousVisible = !frameInsideRun(previousFrame, run);
    const targetVisible = !frameInsideRun(targetFrame, run);
    if (targetVisible && (!previousVisible || changed)) {
      scheduledLightingWrites += 1;
    }
  }
  return (allVisibleLightingWrites - scheduledLightingWrites)
    * rasterAreaByFace[run.faceIndex];
}

function rankHiddenRunsForLightingRaster(
  runs,
  stateIndicesByFace,
  transformSampling,
) {
  const rasterAreaByFace = transformSampling.map((face, faceIndex) => {
    if (!Number.isSafeInteger(face?.referenceLeafWidth)
      || !Number.isSafeInteger(face?.referenceLeafHeight)
      || face.referenceLeafWidth < 1
      || face.referenceLeafHeight < 1) {
      fail(`final transform sampling face ${faceIndex} cannot rank visibility`);
    }
    return face.referenceLeafWidth * face.referenceLeafHeight;
  });
  const sourceFrames = steadyLoopSourceFrames();
  return Object.freeze(runs.map((run) => Object.freeze({
    ...run,
    loopWeightedLightingAreaScore: loopWeightedLightingAreaScore(
      run,
      stateIndicesByFace,
      rasterAreaByFace,
      sourceFrames,
    ),
  })).sort((left, right) => (
    right.loopWeightedLightingAreaScore - left.loopWeightedLightingAreaScore
    || right.length - left.length
    || left.faceIndex - right.faceIndex
    || left.start - right.start
  )));
}

function scheduledMutationCost(visible, changesByFace) {
  let lightingWrites = 0;
  let visibilityWrites = 0;
  let allVisibleLightingWrites = 0;
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const previousFrameIndex = (frameIndex + FRAME_COUNT - 1) % FRAME_COUNT;
    for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
      const changed = changesByFace[faceIndex][frameIndex] === 1;
      if (changed) allVisibleLightingWrites += 1;
      const targetVisible = visible[frameIndex][faceIndex] === 1;
      const previousVisible = visible[previousFrameIndex][faceIndex] === 1;
      if (targetVisible !== previousVisible) visibilityWrites += 1;
      if (targetVisible && (!previousVisible || changed)) lightingWrites += 1;
    }
  }
  const scheduledWrites = lightingWrites + visibilityWrites;
  return Object.freeze({
    objective: "exact 820-frame sequential background-position plus visibility mutations",
    allVisibleLightingWrites,
    lightingWrites,
    visibilityWrites,
    scheduledWrites,
    guaranteedWritesRemoved: allVisibleLightingWrites - scheduledWrites,
  });
}

function runCandidate(run, hideOffset, showRetreat, prefix) {
  const showDistance = run.length - showRetreat;
  if (hideOffset >= showDistance) return null;
  const hideFrame = (run.start + hideOffset) % FRAME_COUNT;
  const showFrame = (run.start + showDistance) % FRAME_COUNT;
  const hiddenFrames = showDistance - hideOffset;
  const baselineLightingWrites = prefix[hideFrame + hiddenFrames + 1] - prefix[hideFrame];
  return {
    hideFrame,
    showFrame,
    hideOffset,
    showRetreat,
    hiddenFrames,
    baselineLightingWrites,
    guaranteedWritesRemoved: baselineLightingWrites
      - VISIBILITY_MUTATIONS_PER_HIDDEN_RUN
      - REVEAL_LIGHTING_MUTATIONS_PER_HIDDEN_RUN,
  };
}

function materializeVisibility(permanentlyHidden, selections) {
  const visible = Array.from({ length: FRAME_COUNT }, () => {
    const row = new Uint8Array(FACE_COUNT);
    row.fill(1);
    return row;
  });
  for (const faceIndex of permanentlyHidden) {
    for (const row of visible) row[faceIndex] = 0;
  }
  for (const selection of selections) {
    for (let frameIndex = selection.hideFrame; frameIndex !== selection.showFrame;
      frameIndex = (frameIndex + 1) % FRAME_COUNT) {
      visible[frameIndex][selection.run.faceIndex] = 0;
    }
  }
  return visible;
}

function optimizeSelectionBoundaries(
  selections,
  transitionsPerFrame,
  prefixes,
  transitionCap,
) {
  let moves = 0;
  let passes = 0;
  for (; passes < 6; passes += 1) {
    let passMoves = 0;
    for (const selection of selections) {
      const boundaryWindow = Math.min(TRANSITION_WINDOW, selection.run.length);
      const retreatTotal = selection.run.length - selection.hiddenFrames;
      transitionsPerFrame[selection.hideFrame] -= 1;
      transitionsPerFrame[selection.showFrame] -= 1;
      let best = selection;
      for (let hideOffset = 0; hideOffset < boundaryWindow; hideOffset += 1) {
        const showRetreat = retreatTotal - hideOffset;
        if (showRetreat < 0 || showRetreat >= boundaryWindow) continue;
        const candidate = runCandidate(
          selection.run,
          hideOffset,
          showRetreat,
          prefixes[selection.run.faceIndex],
        );
        if (!candidate
          || candidate.hiddenFrames !== selection.hiddenFrames
          || transitionsPerFrame[candidate.hideFrame] >= transitionCap
          || transitionsPerFrame[candidate.showFrame] >= transitionCap) {
          continue;
        }
        if (candidate.baselineLightingWrites > best.baselineLightingWrites
          || (candidate.baselineLightingWrites === best.baselineLightingWrites
            && Math.max(
              transitionsPerFrame[candidate.hideFrame],
              transitionsPerFrame[candidate.showFrame],
            ) < Math.max(
              transitionsPerFrame[best.hideFrame],
              transitionsPerFrame[best.showFrame],
            ))) {
          best = candidate;
        }
      }
      if (best.baselineLightingWrites > selection.baselineLightingWrites) {
        Object.assign(selection, best);
        passMoves += 1;
      }
      transitionsPerFrame[selection.hideFrame] += 1;
      transitionsPerFrame[selection.showFrame] += 1;
    }
    moves += passMoves;
    if (passMoves === 0) break;
  }
  return Object.freeze({ moves, passes: passes + 1 });
}

function scheduleVisibility(
  visibleByFace,
  changesByFace,
  stateIndicesByFace,
  transformSampling,
  canonicalBaseline = false,
) {
  const { runs, permanentlyHidden } = hiddenRuns(visibleByFace);
  const transitionCap = canonicalBaseline
    ? CANONICAL_BASELINE_TRANSITION_CAP
    : TRANSITION_CAP;
  const rankedRuns = canonicalBaseline
    ? runs
    : rankHiddenRunsForLightingRaster(
      runs,
      stateIndicesByFace,
      transformSampling,
    );
  const transitionsPerFrame = new Uint16Array(FRAME_COUNT);
  const prefixes = changesByFace.map(circularPrefix);
  const selections = [];
  for (const run of rankedRuns) {
    const boundaryWindow = Math.min(TRANSITION_WINDOW, run.length);
    let hideOffset = -1;
    let showRetreat = -1;
    for (let offset = 0; offset < boundaryWindow; offset += 1) {
      const frameIndex = (run.start + offset) % FRAME_COUNT;
      if (transitionsPerFrame[frameIndex] < transitionCap) {
        hideOffset = offset;
        break;
      }
    }
    for (let retreat = 0; retreat < boundaryWindow; retreat += 1) {
      const frameIndex = (run.start + run.length - retreat) % FRAME_COUNT;
      if (transitionsPerFrame[frameIndex] < transitionCap) {
        showRetreat = retreat;
        break;
      }
    }
    if (hideOffset < 0 || showRetreat < 0) continue;
    const selection = runCandidate(
      run,
      hideOffset,
      showRetreat,
      prefixes[run.faceIndex],
    );
    if (!selection) continue;
    transitionsPerFrame[selection.hideFrame] += 1;
    transitionsPerFrame[selection.showFrame] += 1;
    selections.push({ run, ...selection });
  }
  const legacyVisible = materializeVisibility(permanentlyHidden, selections);
  const legacyMutationCost = scheduledMutationCost(legacyVisible, changesByFace);
  const optimization = optimizeSelectionBoundaries(
    selections,
    transitionsPerFrame,
    prefixes,
    transitionCap,
  );
  const visible = materializeVisibility(permanentlyHidden, selections);
  const mutationCost = scheduledMutationCost(visible, changesByFace);
  if (mutationCost.scheduledWrites > legacyMutationCost.scheduledWrites) {
    fail("area-preserving boundary optimization increased sequential CSS mutations");
  }
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
      if (!visible[frameIndex][faceIndex] && visibleByFace[faceIndex][frameIndex]) {
        fail(`scheduled frame ${frameIndex + 1} hides mathematically visible face ${faceIndex}`);
      }
    }
  }
  return Object.freeze({
    visible: Object.freeze(visible),
    permanentlyHidden,
    selectedRuns: selections.length,
    skippedRuns: runs.length - selections.length,
    capacitySkippedRuns: runs.length - selections.length,
    mutationCost,
    legacyMutationCost,
    boundaryMoves: optimization.moves,
    optimizationPasses: optimization.passes,
  });
}

function changedFaces(left, right) {
  const output = [];
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    if (left[faceIndex] !== right[faceIndex]) output.push(faceIndex);
  }
  return output;
}

function encodeSchedule(scheduled) {
  const offsets = new Uint32Array(FRAME_COUNT + 1);
  const faceIndices = [];
  const transitionCounts = [];
  for (let targetIndex = 0; targetIndex < FRAME_COUNT; targetIndex += 1) {
    offsets[targetIndex] = faceIndices.length;
    const previousIndex = (targetIndex + FRAME_COUNT - 1) % FRAME_COUNT;
    const changed = changedFaces(scheduled.visible[previousIndex], scheduled.visible[targetIndex]);
    transitionCounts.push(changed.length);
    faceIndices.push(...changed);
  }
  offsets[FRAME_COUNT] = faceIndices.length;
  const jumps = NON_INTERACTIVE_JUMPS.map(([fromFrame, toFrame]) => {
    const changed = changedFaces(scheduled.visible[fromFrame - 1], scheduled.visible[toFrame - 1]);
    return Object.freeze({
      fromFrame,
      toFrame,
      faceIndexCount: changed.length,
      faceIndicesBase64: uint16LeBase64(changed),
    });
  });
  const hiddenCounts = scheduled.visible.map(
    (row) => FACE_COUNT - row.reduce((total, entry) => total + entry, 0),
  );
  return Object.freeze({
    initialFrame: 1,
    faceBitOrder: "source-order-lsb0",
    initialVisibleBitsBase64: bitsetBase64(scheduled.visible[0]),
    sequential: Object.freeze({
      encoding: "csr-uint32le-offsets-uint16le-toggle-face-indices-base64",
      offsetCount: offsets.length,
      faceIndexCount: faceIndices.length,
      offsetsBase64: uint32LeBase64(offsets),
      faceIndicesBase64: uint16LeBase64(faceIndices),
    }),
    nonInteractiveJumps: Object.freeze(jumps),
    totals: Object.freeze({
      permanentlyHiddenFaces: scheduled.permanentlyHidden.length,
      selectedHiddenRuns: scheduled.selectedRuns,
      skippedHiddenRuns: scheduled.skippedRuns,
      capacitySkippedHiddenRuns: scheduled.capacitySkippedRuns,
      boundaryMoves: scheduled.boundaryMoves,
      optimizationPasses: scheduled.optimizationPasses,
      legacySequentialCssMutations: scheduled.legacyMutationCost,
      sequentialCssMutations: scheduled.mutationCost,
      hiddenLeaves: Object.freeze({
        mean: hiddenCounts.reduce((total, value) => total + value, 0) / FRAME_COUNT,
        p50: percentile(hiddenCounts, 0.5),
        p95: percentile(hiddenCounts, 0.95),
        max: Math.max(...hiddenCounts),
      }),
      sequentialTransitions: Object.freeze({
        mean: transitionCounts.reduce((total, value) => total + value, 0) / FRAME_COUNT,
        p50: percentile(transitionCounts, 0.5),
        p95: percentile(transitionCounts, 0.95),
        max: Math.max(...transitionCounts),
        total: transitionCounts.reduce((total, value) => total + value, 0),
      }),
    }),
  });
}

function retainedStateIndex(sourceFrames, frameIndex) {
  let lower = 0;
  let upper = sourceFrames.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (sourceFrames[middle] <= frameIndex) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

function chooseBlockLayout(plan) {
  const stateCount = plan.states.length;
  const slotWidth = plan.tileWidth + TILE_GUTTER;
  const slotHeight = plan.tileHeight + TILE_GUTTER;
  for (let columns = Math.min(MAX_STATE_COLUMNS, stateCount);
    columns >= 1;
    columns -= 1) {
    const rows = Math.ceil(stateCount / columns);
    const width = columns * slotWidth + TILE_GUTTER;
    const height = rows * slotHeight + TILE_GUTTER;
    if (width > PAGE_LIMIT || height > PAGE_LIMIT) continue;
    return {
      ...plan,
      columns,
      rows,
      slotWidth,
      slotHeight,
      width,
      height,
      pageIndex: -1,
      x: -1,
      y: -1,
    };
  }
  fail(`${plan.faceId} cannot fit its visibility-compacted state matrix`);
}

function packBlocks(plans) {
  const blocks = plans.map(chooseBlockLayout).sort((left, right) => (
    right.height - left.height
    || right.width - left.width
    || left.sourceOrder - right.sourceOrder
  ));
  const pages = [];
  const createPage = () => {
    const page = { shelves: [], blocks: [], width: 0, height: 0 };
    pages.push(page);
    return page;
  };
  const placeOnPage = (page, block) => {
    for (const shelf of page.shelves) {
      if (block.height <= shelf.height && shelf.x + block.width <= PAGE_LIMIT) {
        block.x = shelf.x;
        block.y = shelf.y;
        block.pageIndex = pages.indexOf(page);
        shelf.x += block.width;
        page.width = Math.max(page.width, shelf.x);
        page.blocks.push(block);
        return true;
      }
    }
    if (page.height + block.height > PAGE_LIMIT) return false;
    page.shelves.push({ x: block.width, y: page.height, height: block.height });
    block.x = 0;
    block.y = page.height;
    block.pageIndex = pages.indexOf(page);
    page.height += block.height;
    page.width = Math.max(page.width, block.width);
    page.blocks.push(block);
    return true;
  };
  for (const block of blocks) {
    let placed = pages.some((page) => placeOnPage(page, block));
    if (!placed) placed = placeOnPage(createPage(), block);
    if (!placed) fail(`${block.faceId} cannot be assigned to a compact lighting page`);
  }
  const bySourceOrder = Array.from({ length: blocks.length });
  for (const block of blocks) bySourceOrder[block.sourceOrder] = block;
  if (bySourceOrder.some((entry) => !entry)) fail("compacted lighting blocks lost source order");
  return Object.freeze({
    pages: Object.freeze(pages.map((page) => Object.freeze({
      blocks: Object.freeze(page.blocks),
      width: page.width,
      height: page.height,
    }))),
    blocks: Object.freeze(bySourceOrder),
  });
}

function compactFacePlans(
  sourceFaces,
  sizingFaces,
  scheduled,
) {
  if (!Array.isArray(sourceFaces)
    || !Array.isArray(sizingFaces)
    || sourceFaces.length !== FACE_COUNT
    || sizingFaces.length !== FACE_COUNT) {
    fail("the in-memory lighting face plans are incomplete");
  }
  return Object.freeze(sourceFaces.map((face, faceIndex) => {
    const sizingFace = sizingFaces[faceIndex];
    const sourceFrames = face.sourceFrames;
    if (face.sourceOrder !== faceIndex
      || face.states.length < 1
      || sourceFrames.length !== face.states.length
      || sizingFace?.sourceOrder !== faceIndex
      || sizingFace.faceId !== face.faceId) {
      fail(`source face ${faceIndex} has an invalid compact-state range`);
    }
    if (sourceFrames[0] !== 0) fail(`source face ${faceIndex} does not begin at frame 1`);
    const retained = new Set([0]);
    const visiblyUsed = new Set();
    let stateIndex = 0;
    for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
      while (stateIndex + 1 < sourceFrames.length
        && sourceFrames[stateIndex + 1] <= frameIndex) {
        stateIndex += 1;
      }
      if (scheduled.visible[frameIndex][faceIndex] === 1) {
        retained.add(stateIndex);
        visiblyUsed.add(stateIndex);
      }
    }
    if (!Number.isSafeInteger(sizingFace.tileWidth) || sizingFace.tileWidth < 1
      || !Number.isSafeInteger(sizingFace.tileHeight)
      || sizingFace.tileHeight < 1) {
      fail(`source face ${faceIndex} has invalid intermediate tile dimensions`);
    }
    const states = [...retained].sort((left, right) => left - right).map((oldStateIndex) => {
      return Object.freeze({
        ...face.states[oldStateIndex],
        visiblyUsed: visiblyUsed.has(oldStateIndex),
      });
    });
    return Object.freeze({
      faceId: face.faceId,
      sourceOrder: faceIndex,
      tileWidth: sizingFace.tileWidth,
      tileHeight: sizingFace.tileHeight,
      temporalMaxRgbDelta: face.temporalMaxRgbDelta,
      states: Object.freeze(states),
      sourceFrames: Uint16Array.from(states.map((state) => state.sourceFrame)),
    });
  }));
}

function lightingCommands(plans, scheduled, fromFrameIndex, toFrameIndex) {
  const commands = [];
  for (let faceIndex = 0; faceIndex < plans.length; faceIndex += 1) {
    if (scheduled.visible[toFrameIndex][faceIndex] === 0) continue;
    const plan = plans[faceIndex];
    const targetStateIndex = retainedStateIndex(plan.sourceFrames, toFrameIndex);
    if (scheduled.visible[fromFrameIndex][faceIndex] === 0
      || retainedStateIndex(plan.sourceFrames, fromFrameIndex) !== targetStateIndex) {
      commands.push(Object.freeze({ faceIndex, stateIndex: targetStateIndex }));
    }
  }
  return Object.freeze(commands);
}

function buildVisibilityCompactedLighting(
  lighting,
  sourceLighting,
  sourceFaces,
  sizingFaces,
  scheduled,
  visibilityCulling,
  stateField,
  footprintBuild,
  transformSampling,
  transformSamplingHash,
  decodedBudgetBytes,
  maximumTransformStretchTarget,
  alphaPolicy,
  canonicalSeamEdgeMasks,
  canonicalBoundaryEdgeMasks,
  boundaryCoverageThreshold,
  exactResolutionFaces,
  canonicalBaseline = false,
) {
  if (!lighting?.surface || !lighting?.transitions || !lighting?.totals
    || !lighting?.runtime || !Array.isArray(lighting.surface.pages)
    || !Array.isArray(lighting.surface.faces)) {
    fail("the source compact lighting contract is incomplete");
  }
  const plans = compactFacePlans(
    sourceFaces,
    sizingFaces,
    scheduled,
  );
  const footprints = footprintBuild?.faces;
  if (footprintBuild?.report?.schema
      !== "cssgraphics-title-head-surface-footprints@1"
    || !Array.isArray(footprints)
    || footprints.length !== plans.length) {
    fail("the in-memory source-pixel footprints are incomplete");
  }
  const visibleFrameCounts = plans.map((_, faceIndex) => (
    scheduled.visible.reduce((total, row) => total + row[faceIndex], 0)
  ));
  const spatial = optimizeTitleHeadSpatialResolution({
    plans,
    footprints,
    visibleFrameCounts,
    stateNodes: stateField.bytes,
    stateFieldHash: stateField.contract.contentHash,
    sourceLightingHash: sourceLighting.contentHash,
    visibilityHash: titleHeadContentHash(visibilityCulling),
    footprintHash: titleHeadContentHash(footprintBuild.report),
    transformSampling,
    canonicalBaseline,
    transformSamplingHash,
    decodedBudgetBytes,
    maximumTransformStretchTarget,
    alphaPolicy,
    canonicalSeamEdgeMasks,
    canonicalBoundaryEdgeMasks,
    boundaryCoverageThreshold,
    exactResolutionFaces,
  });
  const sizedPlans = Object.freeze(plans.map((plan, faceIndex) => {
    const tileWidth = spatial.sizes[faceIndex].width;
    const tileHeight = spatial.sizes[faceIndex].height;
    const leaf = canonicalBaseline
      ? Object.freeze({
        width: tileWidth,
        height: tileHeight,
        maximumTransformStretch: 1,
      })
      : selectTitleHeadLeafRasterSize({
        minimumWidth: transformSampling[faceIndex].referenceLeafWidth,
        minimumHeight: transformSampling[faceIndex].referenceLeafHeight,
        preferredMaximumWidth: Math.max(
          tileWidth,
          transformSampling[faceIndex].referenceLeafWidth,
        ),
        preferredMaximumHeight: Math.max(
          tileHeight,
          transformSampling[faceIndex].referenceLeafHeight,
        ),
        sampling: transformSampling[faceIndex],
        maximumTransformStretch: MAXIMUM_LEAF_TRANSFORM_STRETCH,
      });
    return Object.freeze({
      ...plan,
      tileWidth,
      tileHeight,
      // The leaf raster size is solved from the complete prepared transform
      // audit. The inverse prepared matrix preserves exact final geometry.
      leafWidth: leaf.width,
      leafHeight: leaf.height,
      leafMaximumTransformStretch: leaf.maximumTransformStretch,
      canonicalSeamEdgeMask: canonicalSeamEdgeMasks[faceIndex],
      canonicalBoundaryEdgeMask: canonicalBoundaryEdgeMasks[faceIndex],
    });
  }));
  const packed = packBlocks(sizedPlans);
  const pageOutputs = packed.pages.map((page, pageIndex) => {
    const decodedBytes = page.width * page.height * 4;
    return Object.freeze({
      fallback: Object.freeze({
        path: pagePath(pageIndex),
        role: "title-head-prepared-visibility-compacted-static-rgba-polygon-flipbook-page",
        encoding: "PNG-RGBA8",
        width: page.width,
        height: page.height,
        decodedBytes,
      }),
      native: Object.freeze({
        path: nativePagePath(pageIndex),
        role: "title-head-prepared-visibility-compacted-static-opaque-rgb-native-shape-flipbook-page",
        encoding: "PNG-RGB8",
        opaque: true,
        width: page.width,
        height: page.height,
        sourceBytes: page.width * page.height * 3,
        decodedBytes,
      }),
    });
  });

  let stateOffset = 0;
  const stateSourceFrames = [];
  const stateBackgroundPositions = [];
  const faceMetadata = packed.blocks.map((block) => {
    const page = packed.pages[block.pageIndex];
    const scaleX = block.leafWidth / block.tileWidth;
    const scaleY = block.leafHeight / block.tileHeight;
    const initialX = Number(cssNumber(-(block.x + TILE_GUTTER) * scaleX));
    const initialY = Number(cssNumber(-(block.y + TILE_GUTTER) * scaleY));
    const columnStep = Number(cssNumber(-block.slotWidth * scaleX));
    const rowStep = Number(cssNumber(-block.slotHeight * scaleY));
    const backgroundPositions = block.states.map((_, stateIndex) => {
      const column = stateIndex % block.columns;
      const row = Math.floor(stateIndex / block.columns);
      return `${cssNumber(initialX + column * columnStep)}px `
        + `${cssNumber(initialY + row * rowStep)}px`;
    });
    stateSourceFrames.push(...block.sourceFrames);
    stateBackgroundPositions.push(...backgroundPositions);
    const output = Object.freeze({
      faceId: block.faceId,
      sourceOrder: block.sourceOrder,
      pageIndex: block.pageIndex,
      path: pagePath(block.pageIndex),
      tileWidth: block.tileWidth,
      tileHeight: block.tileHeight,
      leafWidth: block.leafWidth,
      leafHeight: block.leafHeight,
      maximumLeafTransformStretch: block.leafMaximumTransformStretch,
      stateOffset,
      stateCount: block.states.length,
      sourceFrameCount: FRAME_COUNT,
      columns: block.columns,
      rows: block.rows,
      temporalMaxRgbDelta: block.temporalMaxRgbDelta,
      backgroundSize: `${cssNumber(page.width * scaleX)}px `
        + `${cssNumber(page.height * scaleY)}px`,
      backgroundPosition: backgroundPositions[0],
    });
    stateOffset += block.states.length;
    return output;
  });
  const maximumLeafTransformStretch = Math.max(
    ...faceMetadata.map((face) => face.maximumLeafTransformStretch),
  );
  const textureUpscaleFaceCount = faceMetadata.filter((face) => (
    face.leafWidth > face.tileWidth || face.leafHeight > face.tileHeight
  )).length;

  const commandsByFrame = Array.from({ length: FRAME_COUNT }, (_, targetFrameIndex) => (
    lightingCommands(
      packed.blocks,
      scheduled,
      (targetFrameIndex + FRAME_COUNT - 1) % FRAME_COUNT,
      targetFrameIndex,
    )
  ));
  const sequentialOffsets = new Uint32Array(FRAME_COUNT + 1);
  const sequentialFaceIndices = [];
  const sequentialStateIndices = [];
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    sequentialOffsets[frameIndex] = sequentialFaceIndices.length;
    for (const command of commandsByFrame[frameIndex]) {
      sequentialFaceIndices.push(command.faceIndex);
      sequentialStateIndices.push(command.stateIndex);
    }
  }
  sequentialOffsets[FRAME_COUNT] = sequentialFaceIndices.length;
  const jumpCommands = NON_INTERACTIVE_JUMPS.map(([fromFrame, toFrame]) => {
    const commands = lightingCommands(
      packed.blocks,
      scheduled,
      fromFrame - 1,
      toFrame - 1,
    );
    return Object.freeze({
      fromFrame,
      toFrame,
      faceIndexCount: commands.length,
      stateIndexCount: commands.length,
      faceIndicesBase64: uint16LeBase64(commands.map((command) => command.faceIndex)),
      stateIndicesBase64: uint16LeBase64(commands.map((command) => command.stateIndex)),
    });
  });
  const sequentialWrites = commandsByFrame.map((commands) => commands.length);
  const decodedBytes = pageOutputs.reduce(
    (total, page) => total + page.fallback.decodedBytes,
    0,
  );
  if (decodedBytes !== spatial.report.optimizer.decodedBytes
    || pageOutputs.some((page, pageIndex) => (
      page.fallback.width !== spatial.report.optimizer.pages[pageIndex]?.width
      || page.fallback.height !== spatial.report.optimizer.pages[pageIndex]?.height
    ))) {
    fail("measured spatial page packing drifted while emitting final pixels");
  }
  const baseStateCount = sourceLighting.totals.preVisibilityStates
    ?? sourceLighting.totals.states;
  const sourceStates = sourceLighting.totals.sourceStates;
  const fileMetadata = pageOutputs.map(({ fallback, native }) => {
    const { bytes: _fallbackBytes, ...fallbackMetadata } = fallback;
    const { bytes: _nativeBytes, ...nativeMetadata } = native;
    return Object.freeze({
      ...fallbackMetadata,
      native: Object.freeze(nativeMetadata),
    });
  });
  const {
    contentHash: _oldContentHash,
    schema: _oldSchema,
    visibilityCulling: _oldVisibility,
    approximation: _oldApproximation,
    surface: _oldSurface,
    transitions: _oldTransitions,
    totals: _oldTotals,
    runtime: _oldRuntime,
    ...stable
  } = lighting;
  const payload = Object.freeze({
    ...stable,
    schema: COMPACT_LIGHTING_SCHEMA,
    topology: "one stable PolyCSS leaf selects a prepared mathematically-visible retained baked state from one fixed static PNG page",
    approximation: Object.freeze({
      ...lighting.approximation,
      policy: spatial.report.policy,
      spatialOptimization: Object.freeze({
        schema: spatial.report.schema,
        reportHash: spatial.report.contentHash,
        decodedPageBudgetBytes: spatial.report.policy.decodedPageBudgetBytes,
        decodedBytes: spatial.report.optimizer.decodedBytes,
        candidateCount: spatial.report.optimizer.candidateCount,
        selectedUpgradeCount: spatial.report.optimizer.selectedUpgradeCount,
        audit: spatial.report.audit,
        runtimeWork: false,
      }),
    }),
    surface: Object.freeze({
      ...lighting.surface,
      storage: "visibility-compacted-fixed-page-static-rgba-polygon-state-matrix",
      nativeShape: Object.freeze({
        storage: "visibility-compacted-fixed-page-static-opaque-rgb-polygon-state-matrix",
        composition: "fully composited baked lighting over every cell rectangle",
        encoding: "PNG-RGB8",
        alphaChannel: false,
        gutter: "one-pixel edge-extended RGB",
        clipping: "native PolyCSS corner-shape or border-shape",
        mountSelection: "one browser capability decision",
        runtimeWork: false,
        topologyMutation: false,
      }),
      leafSizing: "raster",
      rasterDensity: Object.freeze({
        kind: "per-face-final-transform-conditioned",
        targetMaximumTransformStretch:
          MAXIMUM_LEAF_TRANSFORM_STRETCH,
        measuredMaximumTransformStretch:
          maximumLeafTransformStretch,
        sourceFrameSamples: FRAME_COUNT,
        sampling:
          "maximum 2x2 projection Jacobian singular value at four triangle-domain points",
        selection:
          "minimum integer CSS raster area within the prepared tile when possible",
        textureUpscaleFaceCount,
        runtimeWork: false,
      }),
      statePacking: Object.freeze({
        ...lighting.surface.statePacking,
        selection: "initial state plus every bounded-delta state selected during a mathematically visible frame",
        stateCount: stateSourceFrames.length,
        sourceFramesBase64: uint16LeBase64(stateSourceFrames),
        backgroundPositions: Object.freeze(stateBackgroundPositions),
      }),
      pages: Object.freeze(fileMetadata),
      faces: Object.freeze(faceMetadata),
    }),
    transitions: Object.freeze({
      ...lighting.transitions,
      selection: "prepared visibility-aware ranges assign literal background positions only to visible changed or newly revealed stable leaves",
      sequential: Object.freeze({
        encoding: "csr-uint32le-offsets-parallel-uint16le-visible-face-state-indices-base64",
        offsetCount: sequentialOffsets.length,
        faceIndexCount: sequentialFaceIndices.length,
        stateIndexCount: sequentialStateIndices.length,
        offsetsBase64: uint32LeBase64(sequentialOffsets),
        faceIndicesBase64: uint16LeBase64(sequentialFaceIndices),
        stateIndicesBase64: uint16LeBase64(sequentialStateIndices),
      }),
      nonInteractiveJumps: Object.freeze(jumpCommands),
      nonSequentialFallback: "none; all current non-interactive source jumps are prepared",
    }),
    totals: Object.freeze({
      ...lighting.totals,
      pages: pageOutputs.length,
      preVisibilityStates: baseStateCount,
      states: stateSourceFrames.length,
      discardedStates: sourceStates - stateSourceFrames.length,
      discardedHiddenOnlyStates: baseStateCount - stateSourceFrames.length,
      decodedBytes,
      nativeSourceBytes: pageOutputs.reduce(
        (total, page) => total + page.native.sourceBytes,
        0,
      ),
      nativeDecodedBytes: decodedBytes,
      sequentialWrites: Object.freeze({
        mean: sequentialWrites.reduce((total, value) => total + value, 0)
          / sequentialWrites.length,
        p50: percentile(sequentialWrites, 0.5),
        p95: percentile(sequentialWrites, 0.95),
        max: Math.max(...sequentialWrites),
      }),
    }),
    runtime: Object.freeze({
      ...lighting.runtime,
      leafFrameVariables: "prepared-visible-changed-only",
      frameFaceScans: 0,
      hiddenStateChecks: 0,
      hiddenStateWrites: 0,
      revealStateLookups: 0,
      operation: "prepared visibility-aware literal background-position command ranges",
    }),
    visibilityCulling,
  });
  return Object.freeze({
    contract: Object.freeze({
      ...payload,
      contentHash: titleHeadContentHash(payload),
    }),
    faces: sizedPlans,
    spatial,
  });
}

function prepareTitleHeadVisibilityCulling({
  visibilityBuild,
  sourceLightingBuild,
  sizingBaseline = null,
  finalTrianglePlan,
  footprintBuild,
  transformSamplingReport = null,
  motionBytes,
  canonicalBaseline = false,
}) {
const maximumTransformStretchTarget = canonicalBaseline ? null : 1.75;
const boundaryCoverageThreshold = 4;
const alphaPolicy = TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE;
const decodedBudgetBytes = (canonicalBaseline ? 208 : 384) * 1024 * 1024;
const {
  contract: sourceLighting,
  stateField,
  workspace: sourceWorkspace,
} = sourceLightingBuild ?? {};
const loadedBaselineLighting = canonicalBaseline
  ? sourceLighting
  : sizingBaseline?.contract;
const sizingFaces = canonicalBaseline
  ? sourceWorkspace?.faces
  : sizingBaseline?.workspace?.faces;
const {
  contentHash: finalTrianglePlanContentHash,
  ...finalTrianglePlanPayload
} = finalTrianglePlan;
if (finalTrianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
  || finalTrianglePlanContentHash
    !== titleHeadContentHash(finalTrianglePlanPayload)
  || !Array.isArray(finalTrianglePlan.leaves)
  || finalTrianglePlan.leaves.length !== FACE_COUNT) {
  fail("the fresh final triangle plan is incomplete");
}
const bootstrapBaselineFromSource = canonicalBaseline
    && loadedBaselineLighting?.schema === BASE_LIGHTING_SCHEMA;
const baselineLighting = bootstrapBaselineFromSource
  ? Object.freeze({
      ...loadedBaselineLighting,
      schema: COMPACT_LIGHTING_SCHEMA,
      trianglePlanHash: finalTrianglePlan.contentHash,
    })
  : loadedBaselineLighting;
if (sourceLighting?.schema !== BASE_LIGHTING_SCHEMA
  || sourceLighting.frameCount !== FRAME_COUNT
  || sourceLighting.surface?.faces?.length !== FACE_COUNT
  || baselineLighting?.schema !== COMPACT_LIGHTING_SCHEMA
  || baselineLighting.frameCount !== FRAME_COUNT
  || baselineLighting.surface?.faces?.length !== FACE_COUNT
  || sourceWorkspace?.lightingHash !== sourceLighting.contentHash
  || sourceWorkspace.faces?.length !== FACE_COUNT
  || sourceWorkspace.timeline?.changesByFace?.length !== FACE_COUNT
  || sourceWorkspace.timeline?.stateIndicesByFace?.length !== FACE_COUNT
  || !Array.isArray(sizingFaces)
  || sizingFaces.length !== FACE_COUNT
  || (!canonicalBaseline
    && sizingBaseline?.workspace?.lightingHash
      !== sizingBaseline?.contract?.contentHash)) {
  fail("the in-memory lighting preparation is incomplete or mixed");
}
const stateFieldContract = stateField.contract;
const stateFieldBytes = stateField.bytes;
const {
  contentHash: stateFieldContentHash,
  ...stateFieldPayload
} = stateFieldContract;
if (stateFieldContract?.schema !== TITLE_HEAD_LIGHTING_STATE_FIELD_SCHEMA
  || stateFieldContract.faceCount !== FACE_COUNT
  || stateFieldContract.bytesPerState !== TITLE_HEAD_LIGHTING_NODE_BYTES
  || stateFieldBytes.length
    !== stateFieldContract.stateCount * TITLE_HEAD_LIGHTING_NODE_BYTES
  || stateFieldContract.bytesSha256 !== titleHeadSha256(stateFieldBytes)
  || stateFieldContentHash !== titleHeadContentHash(stateFieldPayload)
  || stateFieldContract.sourceLightingHash !== sourceLighting.contentHash
  || stateFieldContract.stateCount
    !== sourceLighting.surface.statePacking.stateCount
  || sourceWorkspace.stateFieldHash !== stateFieldContract.contentHash) {
  fail("the hash-bound prepare-only lighting state field is incomplete");
}
const transformSamplingContract = canonicalBaseline
  ? null
  : transformSamplingReport;
if (!canonicalBaseline
  && (transformSamplingContract?.schema
      !== "cssgraphics-title-head-final-transform-sampling-audit@1"
    || transformSamplingContract.sourceFrames !== FRAME_COUNT
    || transformSamplingContract.sourceViewport?.width !== 320
    || transformSamplingContract.sourceViewport?.height !== 240
    || transformSamplingContract.trianglePlanHash
      !== sourceLighting.trianglePlanHash
    || !Array.isArray(transformSamplingContract.faces)
    || transformSamplingContract.faces.length !== FACE_COUNT)) {
  fail("the complete hash-bound final transform sampling audit is required");
}
const transformSampling = canonicalBaseline
  ? null
  : Object.freeze(transformSamplingContract.faces.map(
    (face, faceIndex) => {
    const lightingFace = sizingFaces[faceIndex];
    const referenceLeafWidth = lightingFace.leafWidth;
    const referenceLeafHeight = lightingFace.leafHeight;
    if (face?.sourceOrder !== faceIndex
      || face.faceId !== lightingFace.faceId
      || !Number.isSafeInteger(face.selectedSize?.width)
      || face.selectedSize.width < 1
      || !Number.isSafeInteger(face.selectedSize?.height)
      || face.selectedSize.height < 1
      || face.selectedSize.width !== lightingFace.tileWidth
      || face.selectedSize.height !== lightingFace.tileHeight
      || !Number.isSafeInteger(referenceLeafWidth)
      || referenceLeafWidth < 1
      || !Number.isSafeInteger(referenceLeafHeight)
      || referenceLeafHeight < 1
      || !Number.isFinite(face.maximumAxisStretchX)
      || face.maximumAxisStretchX < 0
      || !Number.isFinite(face.maximumAxisStretchY)
      || face.maximumAxisStretchY < 0
      || !Number.isFinite(face.maximumShearCosine)
      || face.maximumShearCosine < 0
      || face.maximumShearCosine > 1.000001
      || !Number.isSafeInteger(face.reconstructionMaximumError)
      || face.reconstructionMaximumError < 0
      || !Number.isSafeInteger(face.edgeMaximumAlphaDeficit)
      || face.edgeMaximumAlphaDeficit < 0) {
      fail(`final transform sampling face ${faceIndex} is incomplete`);
    }
    return Object.freeze({
      referenceWidth: face.selectedSize.width,
      referenceHeight: face.selectedSize.height,
      referenceLeafWidth,
      referenceLeafHeight,
      maximumAxisStretchX: face.maximumAxisStretchX,
      maximumAxisStretchY: face.maximumAxisStretchY,
      maximumShearCosine: face.maximumShearCosine,
      maximumReconstructionError: face.reconstructionMaximumError,
      maximumEdgeAlphaDeficit: face.edgeMaximumAlphaDeficit,
    });
    },
  ));
const transformSamplingHash = canonicalBaseline
  ? null
  : transformSamplingSignature(transformSamplingContract);
const canonicalSeamEdgeMasks = Object.freeze(Array.from(
  { length: FACE_COUNT },
  () => 0,
));
const canonicalBoundaryEdgeMasks = Object.freeze(Array.from(
  { length: FACE_COUNT },
  () => 7,
));
const exactResolutionFaces = Object.freeze(finalTrianglePlan.leaves.map(
  (leaf) => leaf.shapeId === MUSTACHE_SHAPE_ID,
));
if (!Buffer.isBuffer(visibilityBuild?.bytes)) {
  fail("the in-memory visibility audit is incomplete");
}
if (baselineLighting.trianglePlanHash !== finalTrianglePlan.contentHash) {
  fail("the accepted final triangle plan does not match the sizing baseline");
}
for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
  if (finalTrianglePlan.leaves[faceIndex].faceId
    !== sourceWorkspace.faces[faceIndex].faceId) {
    fail(`triangle-plan face ${faceIndex} does not match the lighting matrix`);
  }
}

const scheduled = scheduleVisibility(
  visibilityRows(visibilityBuild.report),
  sourceWorkspace.timeline.changesByFace,
  sourceWorkspace.timeline.stateIndicesByFace,
  transformSampling,
  canonicalBaseline,
);
const schedule = encodeSchedule(scheduled);
const visibilityCulling = Object.freeze({
  schema: "cssgraphics-title-head-prepared-visibility@1",
  trianglePlanHash: baselineLighting.trianglePlanHash,
  frameCount: FRAME_COUNT,
  faceCount: FACE_COUNT,
  criterion: "positive-area frontmost ideal projected triangle; conservative numerical union",
  atlasAlphaConsulted: false,
  safety: "scheduled hidden state is a strict subset of mathematically occluded state",
  policy: Object.freeze({
    kind: canonicalBaseline
      ? "prepare-time-hidden-area-preserving-boundary-optimizer"
      : "prepare-time-loop-weighted-lighting-area-ranked-transition-capped",
    objective: canonicalBaseline
      ? "preserve legacy hidden leaf-frame area, then minimize exact sequential CSS mutations"
      : "maximize avoided steady-loop lighting raster area under the fixed exact visibility transition cap",
    acceptance: canonicalBaseline
      ? "selected hidden runs and durations are immutable; only equal-area boundaries may move"
      : "only mathematically occluded runs may be selected; equal-duration boundaries may move inside the exact hidden interval",
    ...(canonicalBaseline
      ? {}
      : {
        ranking: Object.freeze({
          cadenceHz: 30,
          loopTicks: STEADY_LOOP_TICK_COUNT,
          rasterArea:
            "ceil(final-transform-width/2) * ceil(final-transform-height/2)",
          source: "exact non-interactive animator loop after tick 661",
        }),
      }),
    visibilityMutationsPerHiddenRun: VISIBILITY_MUTATIONS_PER_HIDDEN_RUN,
    revealLightingMutationsPerHiddenRun: REVEAL_LIGHTING_MUTATIONS_PER_HIDDEN_RUN,
    minimumHiddenRun: MINIMUM_HIDDEN_RUN,
    transitionWindow: TRANSITION_WINDOW,
    transitionCap: canonicalBaseline
      ? CANONICAL_BASELINE_TRANSITION_CAP
      : TRANSITION_CAP,
    topologyMutation: false,
    runtimeOcclusionMath: false,
    runtimeFaceScan: false,
  }),
  sourceAuditSha256: titleHeadSha256(visibilityBuild.bytes),
  ...schedule,
});
const compacted = buildVisibilityCompactedLighting(
  baselineLighting,
  sourceLighting,
  sourceWorkspace.faces,
  sizingFaces,
  scheduled,
  visibilityCulling,
  stateField,
  footprintBuild,
  transformSampling,
  transformSamplingHash,
  decodedBudgetBytes,
  maximumTransformStretchTarget,
  alphaPolicy,
  canonicalSeamEdgeMasks,
  canonicalBoundaryEdgeMasks,
  boundaryCoverageThreshold,
  exactResolutionFaces,
  canonicalBaseline,
);
const motionTransformTable = buildTitleHeadMotionTransformTable({
  motionBytes,
  trianglePlan: finalTrianglePlan,
  lighting: compacted.contract,
});
const finalLightingContract = attachTitleHeadMotionTransformTable(
  compacted.contract,
  motionTransformTable,
);

return Object.freeze({
  contract: finalLightingContract,
  visibility: visibilityCulling,
  spatial: compacted.spatial,
  motionTransformTable,
  workspace: Object.freeze({
    lightingHash: finalLightingContract.contentHash,
    sourceLightingHash: sourceLighting.contentHash,
    stateFieldHash: stateFieldContract.contentHash,
    faces: compacted.faces,
  }),
});
}
export {
  prepareTitleHeadVisibilityCulling,
};
