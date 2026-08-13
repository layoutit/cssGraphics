export const CSSGRAVITYWELL_VIEWPORT_PROFILES = Object.freeze([
  [430, 960], [960, 430],
  [480, 960], [960, 480],
  [640, 1_024], [1_024, 640],
  [768, 1_024], [1_024, 768],
  [1_024, 1_024],
  [800, 1_280], [1_280, 800],
  [900, 1_440], [1_440, 900],
  [1_024, 1_536], [1_536, 1_024],
  [1_536, 1_536],
  [1_080, 1_920], [1_920, 1_080],
  [1_920, 1_920],
  [1_440, 2_560], [2_560, 1_440],
  [2_560, 2_560],
  [2_160, 3_840], [3_840, 2_160],
  [3_840, 3_840],
].map(([width, height]) => Object.freeze({ width, height })));
export const CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS = 8;
export const CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES = 1;
export const CSSGRAVITYWELL_VISIBILITY_SCHEMA = "cssgravitywell-prepared-viewport-visibility@2";
export const CSSGRAVITYWELL_VISIBILITY_ENCODING = "gzip-cgwv2-rectangular-profile-sparse-visibility-assignments";
export const CSSGRAVITYWELL_VISIBILITY_SELECTION =
  "smallest-area-rectangular-profile-covering-css-viewport-with-contiguous-square-grid-runs-or-disabled";

const MAGIC = "CGWV";
const HEADER_BYTES = 8;
const PROFILE_HEADER_BYTES = 18;
const PERSPECTIVE = 600 / (2 * Math.tan(20 * Math.PI / 180));

export function prepareGravityWellViewportVisibility(quadsByFrame, {
  gridWidth = inferClosedGridWidth(quadsByFrame?.[0]?.length),
  profileDimensions = CSSGRAVITYWELL_VIEWPORT_PROFILES,
  marginPixels = CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS,
  dilationFrames = CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES,
} = {}) {
  const frameCount = quadsByFrame?.length ?? 0;
  const leafCount = quadsByFrame?.[0]?.length ?? 0;
  if (!Array.isArray(quadsByFrame) || frameCount < 2 || leafCount < 1 ||
      quadsByFrame.some((quads) => !Array.isArray(quads) || quads.length !== leafCount) ||
      !Array.isArray(profileDimensions) || profileDimensions.length < 1 ||
      profileDimensions.some((profile) => !Number.isSafeInteger(profile?.width) || profile.width < 1 ||
        !Number.isSafeInteger(profile?.height) || profile.height < 1) ||
      new Set(profileDimensions.map((profile) => `${profile.width}x${profile.height}`)).size !== profileDimensions.length ||
      !Number.isSafeInteger(gridWidth) || gridWidth < 2 || leafCount !== 2 * gridWidth * (gridWidth - 1) ||
      !Number.isSafeInteger(marginPixels) || marginPixels < 0 ||
      !Number.isSafeInteger(dilationFrames) || dilationFrames < 0 || dilationFrames > 4) {
    throw new TypeError("Complete prepared Gravity Well viewport visibility inputs are required");
  }
  const profiles = profileDimensions.map(({ width, height }) => {
    const rawFrames = quadsByFrame.map((quads) => Uint8Array.from(
      quads,
      (quad) => preparedQuadIntersectsViewport(quad, width, height, marginPixels) ? 1 : 0,
    ));
    const frames = rawFrames.map((frame, frameIndex) => {
      const dilated = Uint8Array.from(frame, (selected, leafIndex) => {
        if (selected === 1 || dilationFrames === 0) return selected;
        for (let offset = 1; offset <= dilationFrames; offset += 1) {
          const previous = (frameIndex - offset + frameCount) % frameCount;
          const next = (frameIndex + offset) % frameCount;
          if (rawFrames[previous][leafIndex] === 1 || rawFrames[next][leafIndex] === 1) return 1;
        }
        return 0;
      });
      return width === height ? closeVisibleGridRuns(dilated, gridWidth) : dilated;
    });
    const initialVisibleIndices = [];
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      if (frames[0][leafIndex] === 1) initialVisibleIndices.push(leafIndex);
    }
    const changeOffsets = new Uint32Array(frameCount + 1);
    const assignments = [];
    let totalVisibleCount = 0;
    let minimumVisibleCount = leafCount;
    let maximumVisibleCount = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      changeOffsets[frameIndex] = assignments.length;
      let visibleCount = 0;
      for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
        const selected = frames[frameIndex][leafIndex];
        visibleCount += selected;
        if (frameIndex > 0 && selected !== frames[frameIndex - 1][leafIndex]) {
          assignments.push((leafIndex << 1) | selected);
        }
      }
      totalVisibleCount += visibleCount;
      minimumVisibleCount = Math.min(minimumVisibleCount, visibleCount);
      maximumVisibleCount = Math.max(maximumVisibleCount, visibleCount);
    }
    changeOffsets[frameCount] = assignments.length;
    return Object.freeze({
      width,
      height,
      frameCount,
      leafCount,
      initialVisibleIndices: Uint16Array.from(initialVisibleIndices),
      changeOffsets,
      assignments: Uint16Array.from(assignments),
      meanVisibleCount: totalVisibleCount / frameCount,
      minimumVisibleCount,
      maximumVisibleCount,
    });
  });
  return Object.freeze({
    schema: CSSGRAVITYWELL_VISIBILITY_SCHEMA,
    encoding: CSSGRAVITYWELL_VISIBILITY_ENCODING,
    selection: CSSGRAVITYWELL_VISIBILITY_SELECTION,
    frameCount,
    leafCount,
    marginPixels,
    dilationFrames,
    profiles: Object.freeze(profiles),
  });
}

export function closeVisibleGridRuns(selected, gridWidth) {
  const segmentsPerLine = gridWidth - 1;
  const sourceSegmentsPerAxis = segmentsPerLine ** 2;
  const closingSegmentsStart = sourceSegmentsPerAxis * 2;
  if (!(selected instanceof Uint8Array) || selected.length !== 2 * gridWidth * segmentsPerLine ||
      !Number.isSafeInteger(gridWidth) || gridWidth < 2) {
    throw new TypeError("Complete Gravity Well grid-run visibility inputs are required");
  }
  const closed = Uint8Array.from(selected);
  for (let axisIndex = 0; axisIndex < 2; axisIndex += 1) {
    for (let lineIndex = 0; lineIndex < gridWidth; lineIndex += 1) {
      const lineStart = lineIndex < segmentsPerLine
        ? axisIndex * sourceSegmentsPerAxis + lineIndex * segmentsPerLine
        : closingSegmentsStart + axisIndex * segmentsPerLine;
      let first = -1;
      let last = -1;
      for (let segmentIndex = 0; segmentIndex < segmentsPerLine; segmentIndex += 1) {
        if (closed[lineStart + segmentIndex] !== 1) continue;
        if (first === -1) first = segmentIndex;
        last = segmentIndex;
      }
      if (first === -1) continue;
      closed.fill(1, lineStart + first, lineStart + last + 1);
    }
  }
  return closed;
}

function inferClosedGridWidth(leafCount) {
  if (!Number.isSafeInteger(leafCount) || leafCount < 4) return null;
  const gridWidth = (1 + Math.sqrt(1 + 2 * leafCount)) / 2;
  return Number.isSafeInteger(gridWidth) ? gridWidth : null;
}

export function encodeGravityWellViewportVisibility(schedule) {
  if (schedule?.schema !== CSSGRAVITYWELL_VISIBILITY_SCHEMA ||
      schedule.encoding !== CSSGRAVITYWELL_VISIBILITY_ENCODING ||
      !Array.isArray(schedule.profiles) || schedule.profiles.length < 1 || schedule.profiles.length > 255) {
    throw new TypeError("Prepared Gravity Well viewport visibility schedule is incomplete");
  }
  const byteLength = HEADER_BYTES + schedule.profiles.reduce((sum, profile) => sum +
    PROFILE_HEADER_BYTES +
    profile.initialVisibleIndices.byteLength +
    profile.changeOffsets.byteLength +
    profile.assignments.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = 2;
  bytes[5] = schedule.profiles.length;
  let offset = HEADER_BYTES;
  for (const profile of schedule.profiles) {
    view.setUint16(offset, profile.width, true);
    view.setUint16(offset + 2, profile.height, true);
    view.setUint16(offset + 4, schedule.marginPixels, true);
    bytes[offset + 6] = schedule.dilationFrames;
    bytes[offset + 7] = 0;
    view.setUint16(offset + 8, profile.frameCount, true);
    view.setUint16(offset + 10, profile.leafCount, true);
    view.setUint16(offset + 12, profile.initialVisibleIndices.length, true);
    view.setUint32(offset + 14, profile.assignments.length, true);
    offset += PROFILE_HEADER_BYTES;
    offset = writeUint16Rows(bytes, offset, profile.initialVisibleIndices);
    for (const value of profile.changeOffsets) {
      view.setUint32(offset, value, true);
      offset += Uint32Array.BYTES_PER_ELEMENT;
    }
    offset = writeUint16Rows(bytes, offset, profile.assignments);
  }
  if (offset !== bytes.byteLength) throw new Error("Prepared viewport visibility byte count drifted");
  return bytes;
}

function preparedQuadIntersectsViewport(quad, width, height, marginPixels) {
  if (!Array.isArray(quad?.points) || quad.points.length !== 4) {
    throw new TypeError("Prepared Gravity Well line quad is incomplete");
  }
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const point of quad.points) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
      throw new TypeError("Prepared Gravity Well line quad is incomplete");
    }
    if (point[2] >= 0) return true;
    const divisor = -point[2];
    const x = PERSPECTIVE * point[0] / divisor;
    const y = PERSPECTIVE * point[1] / divisor;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
  }
  const halfWidth = width / 2 + marginPixels;
  const halfHeight = height / 2 + marginPixels;
  return maximumX >= -halfWidth && minimumX <= halfWidth &&
    maximumY >= -halfHeight && minimumY <= halfHeight;
}

function writeUint16Rows(target, offset, values) {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  for (const value of values) {
    view.setUint16(offset, value, true);
    offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  return offset;
}
