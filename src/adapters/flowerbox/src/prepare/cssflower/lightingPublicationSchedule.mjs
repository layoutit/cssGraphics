import { createHash } from "node:crypto";
import {
  CSSFLOWER_LIGHTING_ADDRESS_SCHEDULE_SCHEMA,
  CSSFLOWER_VISIBLE_LIGHTING_PUBLICATION_SCHEDULE_SCHEMA,
} from "../../cssflower/renderContract.mjs";

export function buildPreparedVisibleLightingPublicationSchedule({ lighting, visibility }) {
  validateSourceSchedules(lighting, visibility);
  const lightingFaceIndices = decodeUint16Le(
    lighting.faceIndicesBase64,
    lighting.faceIndicesByteLength,
    "lighting face indices",
  );
  const selectedFaceIndices = decodeUint16Le(
    visibility.selectedFaceIndicesBase64,
    visibility.selectedFaceIndicesByteLength,
    "selected face indices",
  );
  const stateCount = lighting.stateCount;
  const faceCount = lighting.faceCount;
  const selectedByFace = new Uint8Array(faceCount);
  const latestLightingStateByFace = new Uint16Array(faceCount);
  const visibleAddressChangeFacesByState = Array.from({ length: stateCount }, () => []);
  const newlyVisibleCatchupFacesByState = Array.from({ length: stateCount }, () => []);
  const newlyVisibleCatchupStatesByState = Array.from({ length: stateCount }, () => []);
  let visibleAddressChangeCount = 0;
  let hiddenAddressChangeCount = 0;
  let newlyVisibleCatchupCount = 0;

  const selectedForState = (stateIndex) => {
    selectedByFace.fill(0);
    const start = visibility.selectedFaceOffsets[stateIndex];
    const end = visibility.selectedFaceOffsets[stateIndex + 1];
    for (let index = start; index < end; index += 1) {
      selectedByFace[selectedFaceIndices[index]] = 1;
    }
  };

  selectedForState(0);
  for (const stateIndex of [...Array.from({ length: stateCount - 1 }, (_, index) => index + 1), 0]) {
    const previousSelected = selectedByFace.slice();
    selectedForState(stateIndex);
    const visibleChangeFaces = visibleAddressChangeFacesByState[stateIndex];
    const catchupFaces = newlyVisibleCatchupFacesByState[stateIndex];
    const catchupStates = newlyVisibleCatchupStatesByState[stateIndex];
    const publishedThisState = new Uint8Array(faceCount);
    for (let index = lighting.offsets[stateIndex]; index < lighting.offsets[stateIndex + 1]; index += 1) {
      const faceIndex = lightingFaceIndices[index];
      latestLightingStateByFace[faceIndex] = stateIndex;
      if (selectedByFace[faceIndex] === 0) {
        hiddenAddressChangeCount += 1;
        continue;
      }
      visibleChangeFaces.push(faceIndex);
      publishedThisState[faceIndex] = 1;
      visibleAddressChangeCount += 1;
    }
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      if (selectedByFace[faceIndex] === 0 || previousSelected[faceIndex] === 1 ||
          publishedThisState[faceIndex] === 1) continue;
      catchupFaces.push(faceIndex);
      catchupStates.push(latestLightingStateByFace[faceIndex]);
      newlyVisibleCatchupCount += 1;
    }
  }

  const visibleChanges = flattenStateRows(visibleAddressChangeFacesByState);
  const catchupFaces = flattenStateRows(newlyVisibleCatchupFacesByState);
  const catchupStates = Uint16Array.from(newlyVisibleCatchupStatesByState.flat());
  const visibleFaceBytes = uint16LeBytes(visibleChanges.values);
  const catchupFaceBytes = uint16LeBytes(catchupFaces.values);
  const catchupStateBytes = uint16LeBytes(catchupStates);
  const publicationCounts = visibleAddressChangeFacesByState.map((faces, stateIndex) =>
    faces.length + newlyVisibleCatchupFacesByState[stateIndex].length);
  const sortedCounts = [...publicationCounts].sort((left, right) => left - right);
  const publicationCount = visibleAddressChangeCount + newlyVisibleCatchupCount;
  return Object.freeze({
    schema: CSSFLOWER_VISIBLE_LIGHTING_PUBLICATION_SCHEDULE_SCHEMA,
    stateCount,
    faceCount,
    sourceLightingAddressUpdateCount: lighting.updateCount,
    selection: "prepared-lighting-change-intersect-visible-plus-newly-visible-catchup",
    publicationCount,
    visibleAddressChangeCount,
    newlyVisibleCatchupCount,
    suppressedHiddenAddressWriteCount: hiddenAddressChangeCount,
    meanPublicationsPerState: publicationCount / stateCount,
    p95PublicationsPerState: sortedCounts[Math.ceil(stateCount * 0.95) - 1],
    maximumPublicationsPerState: sortedCounts.at(-1),
    visibleAddressChangeOffsets: visibleChanges.offsets,
    visibleAddressChangeFaceIndicesEncoding:
      "base64-u16le-state-major-visible-address-change-face-indices",
    visibleAddressChangeFaceIndicesByteLength: visibleFaceBytes.length,
    visibleAddressChangeFaceIndicesSha256: sha256(visibleFaceBytes),
    visibleAddressChangeFaceIndicesBase64: visibleFaceBytes.toString("base64"),
    newlyVisibleCatchupOffsets: catchupFaces.offsets,
    newlyVisibleCatchupFaceIndicesEncoding:
      "base64-u16le-state-major-newly-visible-catchup-face-indices",
    newlyVisibleCatchupFaceIndicesByteLength: catchupFaceBytes.length,
    newlyVisibleCatchupFaceIndicesSha256: sha256(catchupFaceBytes),
    newlyVisibleCatchupFaceIndicesBase64: catchupFaceBytes.toString("base64"),
    newlyVisibleCatchupAddressStateIndicesEncoding:
      "base64-u16le-state-major-newly-visible-catchup-address-state-indices",
    newlyVisibleCatchupAddressStateIndicesByteLength: catchupStateBytes.length,
    newlyVisibleCatchupAddressStateIndicesSha256: sha256(catchupStateBytes),
    newlyVisibleCatchupAddressStateIndicesBase64: catchupStateBytes.toString("base64"),
    runtimeSelection: "prepared-state-range-only-no-face-visibility-test-or-hidden-face-style-write",
  });
}

function flattenStateRows(rows) {
  const offsets = new Uint32Array(rows.length + 1);
  for (let stateIndex = 0; stateIndex < rows.length; stateIndex += 1) {
    offsets[stateIndex + 1] = offsets[stateIndex] + rows[stateIndex].length;
  }
  const values = new Uint16Array(offsets.at(-1));
  for (let stateIndex = 0; stateIndex < rows.length; stateIndex += 1) {
    values.set(rows[stateIndex], offsets[stateIndex]);
  }
  return Object.freeze({ offsets: Object.freeze(Array.from(offsets)), values });
}

function validateSourceSchedules(lighting, visibility) {
  if (lighting?.schema !== CSSFLOWER_LIGHTING_ADDRESS_SCHEDULE_SCHEMA ||
      lighting.stateCount !== 360 || lighting.faceCount !== 1_200 ||
      lighting.offsets?.length !== 361 || lighting.offsets[0] !== 0 ||
      lighting.offsets.at(-1) !== lighting.updateCount ||
      lighting.faceIndicesByteLength !== lighting.updateCount * 2 ||
      visibility?.stateCount !== lighting.stateCount || visibility.faceCount !== lighting.faceCount ||
      visibility.selectedFaceOffsets?.length !== 361 || visibility.selectedFaceOffsets[0] !== 0 ||
      visibility.selectedFaceOffsets.at(-1) !== visibility.selectedFaceCount ||
      visibility.selectedFaceIndicesByteLength !== visibility.selectedFaceCount * 2) {
    throw new Error("Prepared cssFlower visible lighting source schedules are incomplete");
  }
}

function decodeUint16Le(base64, expectedByteLength, label) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== expectedByteLength || bytes.length % 2 !== 0) {
    throw new Error(`Prepared cssFlower ${label} byte length drifted`);
  }
  const values = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
  }
  return values;
}

function uint16LeBytes(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
