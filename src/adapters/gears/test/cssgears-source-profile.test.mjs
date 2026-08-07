import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourceBoundSceneProfile,
  preparePresentationRotation,
  sourcePolygonToPolyCss,
} from "../src/prepare/cssgears/sourceProfile.mjs";

const nativeState = Object.freeze({
  schema: "cssgears-native-state@1",
  seed: 26080601,
  sourceConfig: Object.freeze({ count: 0, speed: 1, spin: false, wander: false, wireframe: false }),
  viewport: Object.freeze({ width: 720, height: 720 }),
  planetary: false,
  bbox: Object.freeze({ minX: -0.2, minY: -0.3, maxX: 0.7, maxY: 0.4, fitScale: 10 / 0.9 }),
  scene: Object.freeze({
    translation: Object.freeze([0, 0, 0]),
    rotationDegrees: Object.freeze([10.25, 205.5, 210.75]),
    positionFractions: Object.freeze([0.5, 0.5, 0.5]),
    rotationFractions: Object.freeze([0.168, 0.631, 0.585]),
    trackball: "identity",
  }),
  gears: Object.freeze([
    fixtureGear({ index: 0, id: 1, parentIndex: -1, position: [0, 0, 0], theta: 1, ratio: 1.0232096698654838, nteeth: 13 }),
    fixtureGear({ index: 1, id: 2, parentIndex: 0, position: [0.2, -0.15, 0], theta: -441.93333333333334, ratio: 0.8867817138834193, nteeth: 15 }),
    fixtureGear({ index: 2, id: 4, parentIndex: 1, position: [0.51, -0.2, 0], theta: 675.7, ratio: 0.6650862854125645, nteeth: 20 }),
  ]),
});

const prepared = buildSourceBoundSceneProfile({
  state: nativeState,
  stateSha256: "state-hash",
  frameSha256: "frame-hash",
});

test("native assembly values are consumed without synthetic replacement", () => {
  assert.equal(prepared.sourceProfile.seed, nativeState.seed);
  assert.equal(prepared.sourceProfile.nativeStateSha256, "state-hash");
  assert.deepEqual(prepared.assembly.gears.map((gear) => gear.id), [1, 2, 4]);
  assert.deepEqual(prepared.assembly.gears.map((gear) => gear.ratio), nativeState.gears.map((gear) => gear.ratio));
  assert.deepEqual(prepared.assembly.gears.map((gear) => [gear.x, gear.y, gear.z]), nativeState.gears.map((gear) => gear.position));
  assert.deepEqual(prepared.sourceProfile.sceneRotationDegrees, nativeState.scene.rotationDegrees);
  assert.deepEqual(prepared.sourceProfile.presentation.rotationDegrees, [17.822222222222223, 26.53333333333333, 210.75]);
  assert.equal(prepared.sourceProfile.presentation.runtimeCameraCalculation, false);
});

test("prepared camera framing stays right-facing with narrow yaw variance and source roll", () => {
  assert.deepEqual(preparePresentationRotation([52.00375323742715, 97.47185526543107, 40.82035661694137]), [
    25.245111686653722,
    36.671670175034485,
    40.82035661694137,
  ]);
  const folded = preparePresentationRotation([179.46706360938657, 282.32219688369014, 233.5356667250245]);
  assert.deepEqual(folded, [16.094744247220174, 35.80938722067731, 233.5356667250245]);
});

test("prepared playback follows source draw-then-add semantics", () => {
  const playback = prepared.playback;
  assert.equal(playback.schema, "cssgears-prepared-playback@3");
  assert.equal(playback.stateCount, 720);
  assert.equal(playback.loop, false);
  assert.equal(playback.closes, false);
  assert.equal(playback.sourceFrameDelayMilliseconds, 30);
  assert.equal(playback.sourceScheduler, "xscreensaver-post-draw-delay-no-catch-up");
  assert.equal(playback.sourceCatchUp, false);
  assert.deepEqual(prepared.sourceProfile.sourceScheduler, {
    driver: "hacks/screenhack.c#run_screenhack_table",
    order: "draw-then-sleep-returned-delay",
    catchesUpMissedDraws: false,
  });
  assert.equal(playback.precedent.format, "domformat@0");
  assert.match(playback.initial.assemblyTransform, /^translate3d\(.+\) rotateX\(.+\) rotateY\(.+\) rotateZ\(.+\)$/);
  for (let index = 0; index < nativeState.gears.length; index += 1) {
    const source = nativeState.gears[index];
    const tick0 = transformTheta(transformFor(playback, 0, index));
    const tick1 = transformTheta(transformFor(playback, 1, index));
    const offset = source.ratio * 5;
    assert.equal(tick0, source.theta);
    assert.equal(tick1, source.theta + (source.theta > 0 ? offset : -offset));
  }
});

test("prepared showreel enters, spins for 15 seconds, and exits without runtime interpolation", () => {
  const showreel = prepared.showreel;
  assert.equal(showreel.schema, "cssgears-prepared-showreel@1");
  assert.equal(showreel.stateCount, 580);
  assert.deepEqual(showreel.phases, {
    entry: { startState: 0, stateCount: 40 },
    spin: { startState: 40, stateCount: 500, durationMilliseconds: 15_000 },
    exit: { startState: 540, stateCount: 40 },
  });
  assert.equal(showreel.sourceStateIndices[0], 0);
  assert.equal(showreel.sourceStateIndices[39], 0);
  assert.equal(showreel.sourceStateIndices[40], 0);
  assert.equal(showreel.sourceStateIndices[539], 499);
  assert.equal(showreel.sourceStateIndices[540], 499);
  assert.equal(showreel.sourceStateIndices[579], 499);
  assert.deepEqual(showreel.entryEdges, ["right", "top", "left"]);
  assert.deepEqual(showreel.exitEdges, showreel.entryEdges);
  assert.deepEqual(showreel.entryOffsets, [[1200, 0, 0], [0, -1200, 0], [-1200, 0, 0]]);
  assert.deepEqual(showreel.exitOffsets, showreel.entryOffsets);
  assert.deepEqual(showreel.edgeSelection.edges, showreel.entryEdges);
  assert.equal(new Set(showreel.entryEdges).size, 3);
  assert.equal(showreel.edgeSelection.seed, nativeState.seed);
  assert.equal(showreel.edgeSelection.candidatesEvaluated, 24);
  assert.equal(showreel.edgeSelection.crossingPairCount, 0);
  assert.equal(showreel.edgeSelection.continuousPathQualification, true);
  assert.equal(showreel.edgeSelection.exitRetracesEntry, true);
  assert.equal(showreel.edgeSelection.runtimeCalculation, false);
  assert.equal(showreel.runtimeInterpolation, false);
  assert.equal(showreel.runtimeEasingCalculation, false);
  assert.equal(showreel.runtimeEdgeSelection, false);
  assert.equal(showreel.responsivePresentation.schema, "cssgears-responsive-presentation@1");
  assert.equal(showreel.responsivePresentation.breakpointPixels, 600);
  assert.equal(showreel.responsivePresentation.mobile.scaleMode, "cover");
  assert.equal(showreel.responsivePresentation.runtimeOrientationCalculation, false);
  assert.equal(showreel.transforms.length, 580 * 3);
  assert.equal(showreel.shapeChanges.length, 579 * 3 * 2);
  assert.match(showreel.transforms[0], /^translate3d\(1200px, 0px, 0px\) /u);
  assert.match(showreel.transforms[1], /^translate3d\(0px, -1200px, 0px\) /u);
  assert.match(showreel.transforms[2], /^translate3d\(-1200px, 0px, 0px\) /u);
  assert.match(showreel.transforms[39 * 3], /^translate3d\(0px, 0px, 0px\) /u);
  assert.match(showreel.transforms[579 * 3], /^translate3d\(1200px, 0px, 0px\) /u);
});

test("prepared playback folds the assembly matrix into the retained gear roots", () => {
  assert.equal(prepared.playback.retainedAssemblyRootCount, 1);
  assert.equal(prepared.playback.retainedGearRootCount, 3);
  assert.equal(prepared.playback.retainedLeafTargetCount, 0);
  assert.equal(prepared.playback.assemblyTransformPublication, "prepared-folded-into-gear-root-transforms");
  assert.equal(prepared.playback.gearThetaPublication, "native-positive-after-polycss-leaf-basis");
  assert.equal(prepared.playback.frameRows.length, 720);
  assert.equal(prepared.playback.shapeChanges.length, 719 * 3 * 2);
  assert.equal(prepared.playback.transforms.length, 720 * 3);
  for (const transform of prepared.playback.transforms) {
    assert.match(transform, /^translate3d\(.+\) rotateZ\(.+deg\)$/);
  }
});

test("prepared playback compiles directly indexed DOMFormat-style publication rows", () => {
  const playback = prepared.playback;
  assert.deepEqual(playback.initial.shapeTransformIndices, [0, 1, 2]);
  assert.deepEqual(playback.frameRows[0], [0, 0, 0]);
  assert.deepEqual(playback.frameRows[1], [1, 0, 3]);
  assert.deepEqual(playback.shapeChanges.slice(0, 6), [0, 3, 1, 4, 2, 5]);
  assert.deepEqual(playback.frameRows[719], [719, 718 * 3, 3]);
  assert.deepEqual(playback.shapeChanges.slice(-6), [0, 2157, 1, 2158, 2, 2159]);
});

test("prepared polygon reflection preserves native GL_CCW front faces", () => {
  const assembly = prepared.assembly;
  const polygon = sourcePolygonToPolyCss({
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    normals: [[0, 0, 1], [0, 1, 0], [1, 0, 0]],
  }, assembly);
  const [a, b, c] = polygon.vertices;
  const crossZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  assert.ok(crossZ > 0, "flip-Y reflection must remain counter-clockwise after preparation");
  assert.deepEqual(polygon.normals, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

function fixtureGear(overrides) {
  return Object.freeze({
    index: 0,
    id: 1,
    parentIndex: -1,
    position: Object.freeze([0, 0, 0]),
    theta: 1,
    radius: 0.1,
    ratio: 1,
    rpm: 0,
    nteeth: 12,
    toothWidth: 0.02,
    toothHeight: 0.03,
    toothSlope: 0,
    innerRadius: 0.05,
    innerRadius2: 0.02,
    innerRadius3: 0,
    thickness: 0.08,
    thickness2: 0.056,
    thickness3: 0.08,
    spokes: 0,
    nubs: 0,
    spokeThickness: 0,
    wobble: 0,
    motionBlur: false,
    inverted: false,
    base: false,
    coax: 0,
    coaxDisplacement: 0,
    coaxThickness: 0,
    size: 2,
    polygons: 100,
    color: Object.freeze([0.8, 0.7, 0.6, 1]),
    color2: Object.freeze([0.68, 0.595, 0.51, 1]),
    ...overrides,
  });
}

function transformTheta(transform) {
  const match = /rotateZ\(([-+0-9.eE]+)deg\)$/.exec(transform);
  assert.ok(match, transform);
  return Number(match[1]);
}

function transformFor(playback, tick, shapeIndex) {
  if (tick === 0) return playback.transforms[playback.initial.shapeTransformIndices[shapeIndex]];
  const row = playback.frameRows[tick];
  for (let index = 0; index < row[2]; index += 1) {
    const offset = (row[1] + index) * 2;
    if (playback.shapeChanges[offset] === shapeIndex) {
      return playback.transforms[playback.shapeChanges[offset + 1]];
    }
  }
  throw new Error(`Missing prepared transform for tick ${tick}, shape ${shapeIndex}`);
}
