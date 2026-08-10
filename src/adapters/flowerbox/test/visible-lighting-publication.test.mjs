import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

const productRoot = resolve(
  process.env.CSSFLOWER_PRODUCT_ROOT ?? "build/generated/public/cssflower",
);

test("visible lighting publication is exact for every visible face and representative skips", async () => {
  const scene = JSON.parse(gunzipSync(await readFile(
    resolve(productRoot, "scenes/default-cube.json.gz"),
  )));
  const exact = scene.lighting.addressSchedule;
  const publication = scene.lighting.visiblePublicationSchedule;
  const visibility = scene.playback.frontFacingSchedule;
  const exactFaces = decodeUint16Le(exact.faceIndicesBase64);
  const visibleChangeFaces = decodeUint16Le(
    publication.visibleAddressChangeFaceIndicesBase64,
  );
  const catchupFaces = decodeUint16Le(publication.newlyVisibleCatchupFaceIndicesBase64);
  const catchupStates = decodeUint16Le(
    publication.newlyVisibleCatchupAddressStateIndicesBase64,
  );
  const selectedFaces = decodeUint16Le(visibility.selectedFaceIndicesBase64);
  const exactStateByFace = new Uint16Array(exact.faceCount);
  const publishedStateByFace = new Uint16Array(exact.faceCount);
  const exactSnapshots = new Array(exact.stateCount);
  const publishedSnapshots = new Array(exact.stateCount);
  exactSnapshots[0] = exactStateByFace.slice();
  publishedSnapshots[0] = publishedStateByFace.slice();

  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (let stateIndex = cycle === 0 ? 1 : 0; stateIndex < exact.stateCount; stateIndex += 1) {
      applyExactState(stateIndex, exactStateByFace, exact, exactFaces);
      applyPublicationState(
        stateIndex,
        publishedStateByFace,
        publication,
        visibleChangeFaces,
        catchupFaces,
        catchupStates,
      );
      assertPublicationFacesAreVisible(
        stateIndex,
        publication,
        visibility,
        selectedFaces,
        visibleChangeFaces,
        catchupFaces,
      );
      assertVisibleStatesMatch(
        stateIndex,
        exactStateByFace,
        publishedStateByFace,
        visibility,
        selectedFaces,
      );
      if (cycle === 0) {
        exactSnapshots[stateIndex] = exactStateByFace.slice();
        publishedSnapshots[stateIndex] = publishedStateByFace.slice();
      }
    }
  }

  for (const startState of [0, 1, 31, 49, 50, 99, 149, 180, 359]) {
    for (const advance of [2, 7, 31, 89, 180, 359]) {
      assertSkippedPublicationMatches({
        startState,
        advance,
        exact,
        publication,
        visibility,
        exactFaces,
        visibleChangeFaces,
        catchupFaces,
        catchupStates,
        selectedFaces,
        exactStart: exactSnapshots[startState],
        publishedStart: publishedSnapshots[startState],
      });
    }
  }

  assert.equal(publication.publicationCount, 164_713);
  assert.equal(publication.suppressedHiddenAddressWriteCount, 98_845);
});

function applyExactState(stateIndex, states, schedule, faces) {
  for (let update = schedule.offsets[stateIndex]; update < schedule.offsets[stateIndex + 1]; update += 1) {
    states[faces[update]] = stateIndex;
  }
}

function applyPublicationState(stateIndex, states, schedule, visibleFaces, catchupFaces, catchupStates) {
  for (let update = schedule.visibleAddressChangeOffsets[stateIndex];
    update < schedule.visibleAddressChangeOffsets[stateIndex + 1]; update += 1) {
    states[visibleFaces[update]] = stateIndex;
  }
  for (let update = schedule.newlyVisibleCatchupOffsets[stateIndex];
    update < schedule.newlyVisibleCatchupOffsets[stateIndex + 1]; update += 1) {
    states[catchupFaces[update]] = catchupStates[update];
  }
}

function assertPublicationFacesAreVisible(
  stateIndex,
  schedule,
  visibility,
  selectedFaces,
  visibleFaces,
  catchupFaces,
) {
  const selected = new Uint8Array(visibility.faceCount);
  for (let index = visibility.selectedFaceOffsets[stateIndex];
    index < visibility.selectedFaceOffsets[stateIndex + 1]; index += 1) {
    selected[selectedFaces[index]] = 1;
  }
  const published = new Uint8Array(visibility.faceCount);
  for (let update = schedule.visibleAddressChangeOffsets[stateIndex];
    update < schedule.visibleAddressChangeOffsets[stateIndex + 1]; update += 1) {
    const faceIndex = visibleFaces[update];
    assert.equal(selected[faceIndex], 1, `state ${stateIndex} changed hidden face ${faceIndex}`);
    assert.equal(published[faceIndex], 0, `state ${stateIndex} duplicated face ${faceIndex}`);
    published[faceIndex] = 1;
  }
  for (let update = schedule.newlyVisibleCatchupOffsets[stateIndex];
    update < schedule.newlyVisibleCatchupOffsets[stateIndex + 1]; update += 1) {
    const faceIndex = catchupFaces[update];
    assert.equal(selected[faceIndex], 1, `state ${stateIndex} caught up hidden face ${faceIndex}`);
    assert.equal(published[faceIndex], 0, `state ${stateIndex} duplicated catch-up face ${faceIndex}`);
    published[faceIndex] = 1;
  }
}

function assertVisibleStatesMatch(stateIndex, exact, published, visibility, selectedFaces) {
  for (let index = visibility.selectedFaceOffsets[stateIndex];
    index < visibility.selectedFaceOffsets[stateIndex + 1]; index += 1) {
    const faceIndex = selectedFaces[index];
    assert.equal(published[faceIndex], exact[faceIndex],
      `state ${stateIndex} visible face ${faceIndex} address drifted`);
  }
}

function assertSkippedPublicationMatches(options) {
  const {
    startState,
    advance,
    exact,
    publication,
    visibility,
    exactFaces,
    visibleChangeFaces,
    catchupFaces,
    catchupStates,
    selectedFaces,
  } = options;
  const exactStateByFace = options.exactStart.slice();
  const publishedStateByFace = options.publishedStart.slice();
  const pendingStates = new Int16Array(exact.faceCount);
  pendingStates.fill(-1);
  const pendingFaces = [];
  for (let offset = 1; offset <= advance; offset += 1) {
    const stateIndex = (startState + offset) % exact.stateCount;
    applyExactState(stateIndex, exactStateByFace, exact, exactFaces);
    for (let update = publication.visibleAddressChangeOffsets[stateIndex];
      update < publication.visibleAddressChangeOffsets[stateIndex + 1]; update += 1) {
      const faceIndex = visibleChangeFaces[update];
      if (pendingStates[faceIndex] < 0) pendingFaces.push(faceIndex);
      pendingStates[faceIndex] = stateIndex;
    }
    for (let update = publication.newlyVisibleCatchupOffsets[stateIndex];
      update < publication.newlyVisibleCatchupOffsets[stateIndex + 1]; update += 1) {
      const faceIndex = catchupFaces[update];
      if (pendingStates[faceIndex] < 0) pendingFaces.push(faceIndex);
      pendingStates[faceIndex] = catchupStates[update];
    }
  }
  const finalState = (startState + advance) % exact.stateCount;
  const selected = new Uint8Array(exact.faceCount);
  for (let index = visibility.selectedFaceOffsets[finalState];
    index < visibility.selectedFaceOffsets[finalState + 1]; index += 1) {
    selected[selectedFaces[index]] = 1;
  }
  for (const faceIndex of pendingFaces) {
    if (selected[faceIndex] === 1) publishedStateByFace[faceIndex] = pendingStates[faceIndex];
  }
  assertVisibleStatesMatch(
    finalState,
    exactStateByFace,
    publishedStateByFace,
    visibility,
    selectedFaces,
  );
}

function decodeUint16Le(base64) {
  const bytes = Buffer.from(base64, "base64");
  const values = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = bytes.readUInt16LE(index * 2);
  }
  return values;
}
