const SOURCE_FOV_DEGREES = 30;
const SOURCE_EYE_Z = 30;
const POLYCSS_SOURCE_UNIT_PIXELS = 50;
const PREPARED_STATE_COUNT = 720;
const SHOWREEL_ENTRY_STATE_COUNT = 40;
const SHOWREEL_SPIN_STATE_COUNT = 500;
const SHOWREEL_EXIT_STATE_COUNT = 40;
const SHOWREEL_OFFSCREEN_PIXELS = 1200;
const SHOWREEL_EDGE_DIRECTIONS = Object.freeze([
  Object.freeze({ id: "left", vector: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ id: "right", vector: Object.freeze([1, 0, 0]) }),
  Object.freeze({ id: "top", vector: Object.freeze([0, -1, 0]) }),
  Object.freeze({ id: "bottom", vector: Object.freeze([0, 1, 0]) }),
]);
const PRESENTATION_X_TILT_DEGREES = Object.freeze([16, 32]);
const PRESENTATION_Y_TILT_DEGREES = Object.freeze([22, 38]);
const MOBILE_BREAKPOINT_PIXELS = 600;

export function buildSourceBoundSceneProfile(nativeCapture) {
  const nativeState = nativeCapture?.state ?? nativeCapture;
  validateNativeState(nativeState);
  const assembly = buildNativeAssembly(nativeState);
  const presentationRotationDegrees = preparePresentationRotation(nativeState.scene.rotationDegrees);
  const sourceProfile = deepFreeze({
    schema: "cssgears-source-profile@3",
    id: `xscreensaver-gears-native-seed-${nativeState.seed}-v1`,
    sourceRevision: "Zygo/xscreensaver@906693799e4fb7581436590cf84ecb2d3c9186ba",
    assembly: "seeded native non-planetary train",
    seed: nativeState.seed,
    nativeStateSha256: nativeCapture?.stateSha256 ?? null,
    nativeFrameSha256: nativeCapture?.frameSha256 ?? null,
    planetary: nativeState.planetary,
    wireframe: nativeState.sourceConfig.wireframe,
    sourceSpeed: nativeState.sourceConfig.speed,
    sourceTickMicroseconds: 30_000,
    presentationTicksPerSecond: 1_000_000 / 30_000,
    sourceScheduler: {
      driver: "hacks/screenhack.c#run_screenhack_table",
      order: "draw-then-sleep-returned-delay",
      catchesUpMissedDraws: false,
    },
    animation: {
      sourceIncrementFormula: "off = ratio * 5 * speed; add when th > 0, subtract otherwise",
      preparedStateCount: PREPARED_STATE_COUNT,
      segmentStartState: 0,
      segmentEndState: PREPARED_STATE_COUNT - 1,
      closes: false,
      loop: false,
    },
    sceneTranslation: [...nativeState.scene.translation],
    sceneRotationDegrees: [...nativeState.scene.rotationDegrees],
    presentation: {
      schema: "cssgears-prepared-camera-framing@1",
      policy: "map-native-tilt-to-right-facing-source-lit-three-quarter-variance-preserve-roll",
      rotationDegrees: presentationRotationDegrees,
      tiltEnvelopeDegrees: {
        x: [...PRESENTATION_X_TILT_DEGREES],
        y: [...PRESENTATION_Y_TILT_DEGREES],
      },
      sourceRotationAdjusted: presentationRotationDegrees.some(
        (value, index) => value !== nativeState.scene.rotationDegrees[index],
      ),
      runtimeCameraCalculation: false,
    },
    scenePositionFractions: [...nativeState.scene.positionFractions],
    sceneRotationFractions: [...nativeState.scene.rotationFractions],
    trackball: nativeState.scene.trackball,
    camera: {
      fovDegrees: SOURCE_FOV_DEGREES,
      eye: [0, 0, SOURCE_EYE_Z],
      target: [0, 0, 0],
      up: [0, 1, 0],
      near: 1,
      far: 100,
      viewport: { ...nativeState.viewport },
    },
    light: {
      position: [1, 1, 1, 0],
      ambient: [0, 0, 0, 1],
      diffuse: [1, 1, 1, 1],
      specular: [0, 1, 1, 1],
      globalAmbient: [0.2, 0.2, 0.2, 1],
      shininess: 128,
    },
    lightingQualification: "native-fixed-eye-space-product-view-fixed-function-tick-zero-bake-visual-oracle-unqualified",
  });
  const playback = buildPreparedPlayback(assembly, sourceProfile);
  return deepFreeze({
    sourceProfile,
    assembly,
    playback,
    showreel: buildPreparedShowreel(playback, assembly, sourceProfile),
    camera: buildPolyCssCamera(sourceProfile.camera.viewport),
  });
}

export function buildNativeAssembly(nativeState) {
  validateNativeState(nativeState);
  const gears = nativeState.gears.map((sourceGear) => {
    const parent = sourceGear.parentIndex >= 0 ? nativeState.gears[sourceGear.parentIndex] : null;
    const angle = parent
      ? Math.atan2(sourceGear.position[1] - parent.position[1], sourceGear.position[0] - parent.position[0]) * 180 / Math.PI
      : 0;
    return deepFreeze({
      id: sourceGear.id,
      parent: sourceGear.parentIndex >= 0 ? sourceGear.parentIndex : null,
      angle,
      nteeth: sourceGear.nteeth,
      radius: sourceGear.radius,
      toothW: sourceGear.toothWidth,
      toothH: sourceGear.toothHeight,
      toothSlope: sourceGear.toothSlope,
      innerR: sourceGear.innerRadius,
      innerR2: sourceGear.innerRadius2,
      innerR3: sourceGear.innerRadius3,
      thickness: sourceGear.thickness,
      thickness2: sourceGear.thickness2,
      thickness3: sourceGear.thickness3,
      spokes: sourceGear.spokes,
      nubs: sourceGear.nubs,
      spokeThickness: sourceGear.spokeThickness,
      wobble: sourceGear.wobble,
      motionBlur: sourceGear.motionBlur,
      inverted: sourceGear.inverted,
      base: sourceGear.base,
      coax: sourceGear.coax,
      coaxDisplacement: sourceGear.coaxDisplacement,
      coaxThickness: sourceGear.coaxThickness,
      size: sourceGear.size,
      color: [...sourceGear.color],
      color2: [...sourceGear.color2],
      x: sourceGear.position[0],
      y: sourceGear.position[1],
      z: sourceGear.position[2],
      ratio: sourceGear.ratio,
      rpm: sourceGear.rpm,
      initialTheta: sourceGear.theta,
      sourcePolygonCount: sourceGear.polygons,
    });
  });
  const bbox = nativeState.bbox;
  return deepFreeze({
    schema: "cssgears-native-assembly@1",
    seed: nativeState.seed,
    gears,
    sourceBounds: {
      minX: bbox.minX,
      minY: bbox.minY,
      maxX: bbox.maxX,
      maxY: bbox.maxY,
      width: bbox.maxX - bbox.minX,
      height: bbox.maxY - bbox.minY,
    },
    sourceCenter: [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2, 0],
    sourceFitScale: bbox.fitScale,
  });
}

export function buildPreparedPlayback(assembly, sourceProfile) {
  const theta = assembly.gears.map((gear) => gear.initialTheta);
  const assemblyTransform = sourceSceneTransformToPolyCss(sourceProfile, assembly);
  const transforms = [];
  const frameRows = [];
  const shapeChanges = [];
  for (let tick = 0; tick < sourceProfile.animation.preparedStateCount; tick += 1) {
    const shapeOffset = shapeChanges.length / 2;
    for (let index = 0; index < assembly.gears.length; index += 1) {
      const gear = assembly.gears[index];
      const position = sourcePositionToPolyCss(gear, assembly);
      const transformIndex = transforms.length;
      transforms.push(`translate3d(${number(position[0])}px, ${number(position[1])}px, ${number(position[2])}px) rotateZ(${number(theta[index])}deg)`);
      if (tick > 0) shapeChanges.push(index, transformIndex);
    }
    frameRows.push(deepFreeze([tick, shapeOffset, tick === 0 ? 0 : assembly.gears.length]));
    for (let index = 0; index < assembly.gears.length; index += 1) {
      const gear = assembly.gears[index];
      const offset = gear.ratio * 5 * sourceProfile.sourceSpeed;
      theta[index] += theta[index] > 0 ? offset : -offset;
    }
  }
  return deepFreeze({
    schema: "cssgears-prepared-playback@3",
    layout: "directly-indexed-shape-change-stream@1",
    precedent: {
      format: "domformat@0",
      codec: "polycss-playback@0",
      commit: "7b853099ec089e43aefd547f237385b99fe746aa",
      semantics: "fixed-retained-tree-logical-row-evaluation-final-state-physical-publication",
    },
    sourceTicksPerSecond: sourceProfile.presentationTicksPerSecond,
    sourceFrameDelayMilliseconds: sourceProfile.sourceTickMicroseconds / 1_000,
    sourceScheduler: "xscreensaver-post-draw-delay-no-catch-up",
    sourceCatchUp: false,
    stateCount: frameRows.length,
    segmentStartState: 0,
    segmentEndState: frameRows.length - 1,
    loop: false,
    closes: false,
    retainedAssemblyRootCount: 1,
    retainedGearRootCount: assembly.gears.length,
    retainedLeafTargetCount: 0,
    assemblyTransformPublication: "prepared-folded-into-gear-root-transforms",
    gearThetaPublication: "native-positive-after-polycss-leaf-basis",
    sourceStepSemantics: "draw-current-theta-then-apply-signed-ratio-offset",
    initial: {
      stateIndex: 0,
      assemblyTransform,
      shapeTransformIndices: assembly.gears.map((_, index) => index),
    },
    frameRows,
    shapeChanges,
    transforms,
  });
}

export function buildPreparedShowreel(playback, assembly, sourceProfile) {
  if (playback?.schema !== "cssgears-prepared-playback@3" || playback.retainedGearRootCount !== 3) {
    throw new TypeError("Prepared cssGears source playback is required for the showreel");
  }
  const edgeSelection = prepareShowreelEdgeSelection(assembly, sourceProfile);
  const responsivePresentation = prepareResponsivePresentation(edgeSelection);
  const entryOffsets = edgeSelection.offsets;
  const exitOffsets = edgeSelection.offsets;
  const stateCount = SHOWREEL_ENTRY_STATE_COUNT + SHOWREEL_SPIN_STATE_COUNT + SHOWREEL_EXIT_STATE_COUNT;
  const transforms = [];
  const frameRows = [];
  const shapeChanges = [];
  const sourceStateIndices = [];
  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const phase = showreelPhaseForState(stateIndex);
    sourceStateIndices.push(phase.sourceStateIndex);
    const shapeOffset = shapeChanges.length / 2;
    for (let gearIndex = 0; gearIndex < playback.retainedGearRootCount; gearIndex += 1) {
      const sourceTransform = playback.transforms[
        phase.sourceStateIndex * playback.retainedGearRootCount + gearIndex
      ];
      const offset = phase.name === "entry"
        ? scaleVector(entryOffsets[gearIndex], 1 - easeOutCubic(phase.progress))
        : phase.name === "exit"
          ? scaleVector(exitOffsets[gearIndex], easeInCubic(phase.progress))
          : [0, 0, 0];
      transforms.push(
        `translate3d(${number(offset[0])}px, ${number(offset[1])}px, ${number(offset[2])}px) ` +
        `${playback.initial.assemblyTransform} ${sourceTransform}`,
      );
      if (stateIndex > 0) shapeChanges.push(gearIndex, transforms.length - 1);
    }
    frameRows.push(deepFreeze([stateIndex, shapeOffset, stateIndex === 0 ? 0 : playback.retainedGearRootCount]));
  }
  return deepFreeze({
    schema: "cssgears-prepared-showreel@1",
    layout: "directly-indexed-shape-change-stream@1",
    sourceFrameDelayMilliseconds: playback.sourceFrameDelayMilliseconds,
    sourceTicksPerSecond: playback.sourceTicksPerSecond,
    sourceScheduler: playback.sourceScheduler,
    sourceCatchUp: false,
    stateCount,
    segmentStartState: 0,
    segmentEndState: stateCount - 1,
    loop: false,
    closes: false,
    switchPreparedBankAtEnd: true,
    retainedAssemblyRootCount: 1,
    retainedGearRootCount: 3,
    retainedLeafTargetCount: 0,
    entryOffsets,
    exitOffsets,
    entryEdges: edgeSelection.edges,
    exitEdges: edgeSelection.edges,
    edgeSelection,
    responsivePresentation,
    phases: {
      entry: { startState: 0, stateCount: SHOWREEL_ENTRY_STATE_COUNT },
      spin: {
        startState: SHOWREEL_ENTRY_STATE_COUNT,
        stateCount: SHOWREEL_SPIN_STATE_COUNT,
        durationMilliseconds: SHOWREEL_SPIN_STATE_COUNT * playback.sourceFrameDelayMilliseconds,
      },
      exit: {
        startState: SHOWREEL_ENTRY_STATE_COUNT + SHOWREEL_SPIN_STATE_COUNT,
        stateCount: SHOWREEL_EXIT_STATE_COUNT,
      },
    },
    initial: {
      stateIndex: 0,
      shapeTransformIndices: [0, 1, 2],
    },
    sourceStateIndices,
    frameRows,
    shapeChanges,
    transforms,
    runtimeInterpolation: false,
    runtimeEasingCalculation: false,
    runtimeEdgeSelection: false,
  });
}

function prepareResponsivePresentation(edgeSelection) {
  const xs = edgeSelection.projectedCenters.map(([x]) => x);
  const ys = edgeSelection.projectedCenters.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const quarterTurns = width >= height ? 1 : 0;
  return deepFreeze({
    schema: "cssgears-responsive-presentation@1",
    selection: "under-600px-selects-prepared-portrait-orientation",
    breakpointPixels: MOBILE_BREAKPOINT_PIXELS,
    desktop: { id: "desktop", quarterTurns: 0, rotationDegrees: 0, scaleMode: "contain" },
    mobile: {
      id: "mobile",
      quarterTurns,
      rotationDegrees: quarterTurns * 90,
      scaleMode: "cover",
      preparedProjectedCenterWidth: width,
      preparedProjectedCenterHeight: height,
    },
    runtimeOrientationCalculation: false,
  });
}

export function sourceVertexToPolyCss(vertex, assembly) {
  const scale = assembly.sourceFitScale;
  return [vertex[0] * scale, -vertex[1] * scale, vertex[2] * scale];
}

export function sourcePolygonToPolyCss(polygon, assembly) {
  if (!Array.isArray(polygon?.vertices) || !Array.isArray(polygon?.normals) ||
      polygon.vertices.length !== polygon.normals.length ||
      (polygon.vertices.length !== 3 && polygon.vertices.length !== 4)) {
    throw new TypeError("Complete native triangle or quad winding is required");
  }
  const sourceOrder = Array.from(
    { length: polygon.vertices.length },
    (_, index) => polygon.vertices.length - index - 1,
  );
  return deepFreeze({
    vertices: sourceOrder.map((index) => sourceVertexToPolyCss(polygon.vertices[index], assembly)),
    normals: sourceOrder.map((index) => [...polygon.normals[index]]),
  });
}

export function sourceNormalToPolyCss(normal) {
  return [normal[0], -normal[1], normal[2]];
}

export function preparePresentationRotation(rotationDegrees) {
  if (!Array.isArray(rotationDegrees) || rotationDegrees.length !== 3 ||
      rotationDegrees.some((value) => !Number.isFinite(value))) {
    throw new TypeError("A complete native cssGears scene rotation is required");
  }
  const pitchFraction = Math.abs(foldViewTilt(rotationDegrees[0])) / 90;
  const yawFraction = Math.abs(foldViewTilt(rotationDegrees[1])) / 90;
  return deepFreeze([
    PRESENTATION_X_TILT_DEGREES[0] +
      pitchFraction * (PRESENTATION_X_TILT_DEGREES[1] - PRESENTATION_X_TILT_DEGREES[0]),
    PRESENTATION_Y_TILT_DEGREES[0] +
      yawFraction * (PRESENTATION_Y_TILT_DEGREES[1] - PRESENTATION_Y_TILT_DEGREES[0]),
    rotationDegrees[2],
  ]);
}

function buildPolyCssCamera(sourceViewport) {
  const perspective = sourceViewport.height / 2 / Math.tan(SOURCE_FOV_DEGREES * Math.PI / 360);
  return deepFreeze({
    projection: "perspective",
    perspective,
    zoom: POLYCSS_SOURCE_UNIT_PIXELS,
    rotX: 0,
    rotY: 0,
    target: [0, 0, 0],
    distance: POLYCSS_SOURCE_UNIT_PIXELS * SOURCE_EYE_Z - perspective,
    sourceViewport: { ...sourceViewport },
  });
}

function sourcePositionToPolyCss(gear, assembly) {
  const scale = assembly.sourceFitScale * POLYCSS_SOURCE_UNIT_PIXELS;
  const centeredX = gear.x - assembly.sourceCenter[0];
  const centeredY = gear.y - assembly.sourceCenter[1];
  return [centeredX * scale, -centeredY * scale, gear.z * scale];
}

function sourceSceneTransformToPolyCss(profile, assembly) {
  const scale = assembly.sourceFitScale * POLYCSS_SOURCE_UNIT_PIXELS;
  const [tx, ty, tz] = profile.sceneTranslation;
  const [rx, ry, rz] = profile.presentation.rotationDegrees;
  return `translate3d(${number(tx * scale)}px, ${number(-ty * scale)}px, ${number(tz * scale)}px) rotateX(${number(-rx)}deg) rotateY(${number(ry)}deg) rotateZ(${number(-rz)}deg)`;
}

function prepareShowreelEdgeSelection(assembly, sourceProfile) {
  if (assembly?.schema !== "cssgears-native-assembly@1" || assembly.gears.length !== 3 ||
      sourceProfile?.seed !== assembly.seed) {
    throw new TypeError("Prepared cssGears assembly and source profile are required for edge selection");
  }
  const projected = assembly.gears.map((gear) => projectPreparedGearCenter(gear, assembly, sourceProfile));
  const centroid = projected.reduce(
    (sum, point) => [sum[0] + point.x / projected.length, sum[1] + point.y / projected.length],
    [0, 0],
  );
  const candidates = distinctEdgeAssignments().map((directions) => {
    let crossingPairCount = 0;
    let minimumClearancePixels = Number.POSITIVE_INFINITY;
    for (let left = 0; left < projected.length; left += 1) {
      for (let right = left + 1; right < projected.length; right += 1) {
        const finalDelta = [projected[left].x - projected[right].x, projected[left].y - projected[right].y];
        const travelDelta = [
          SHOWREEL_OFFSCREEN_PIXELS * (
            projected[left].perspectiveScale * directions[left].vector[0] -
            projected[right].perspectiveScale * directions[right].vector[0]
          ),
          SHOWREEL_OFFSCREEN_PIXELS * (
            projected[left].perspectiveScale * directions[left].vector[1] -
            projected[right].perspectiveScale * directions[right].vector[1]
          ),
        ];
        const finalDistance = Math.hypot(...finalDelta);
        const travelLengthSquared = travelDelta[0] ** 2 + travelDelta[1] ** 2;
        const closestProgress = travelLengthSquared === 0 ? 0 : clamp(
          -dot2(finalDelta, travelDelta) / travelLengthSquared,
          0,
          1,
        );
        const closestDistance = Math.hypot(
          finalDelta[0] + closestProgress * travelDelta[0],
          finalDelta[1] + closestProgress * travelDelta[1],
        );
        const clearance = closestDistance - finalDistance;
        minimumClearancePixels = Math.min(minimumClearancePixels, clearance);
        if (clearance < -1e-7) crossingPairCount += 1;
      }
    }
    const outwardAlignment = projected.reduce((score, point, index) => score +
      (point.x - centroid[0]) * directions[index].vector[0] +
      (point.y - centroid[1]) * directions[index].vector[1], 0);
    return { directions, crossingPairCount, minimumClearancePixels, outwardAlignment };
  }).sort(compareShowreelEdgeCandidates);
  const selected = candidates[0];
  if (!selected || selected.crossingPairCount !== 0) {
    throw new Error(`Seed ${sourceProfile.seed} has no crossing-free prepared showreel edge assignment`);
  }
  const edges = selected.directions.map((direction) => direction.id);
  return deepFreeze({
    schema: "cssgears-prepared-edge-selection@1",
    seed: sourceProfile.seed,
    policy: "three-distinct-viewport-edges-no-pair-closer-than-locked-spacing",
    edges,
    offsets: selected.directions.map((direction) =>
      direction.vector.map((value) => value * SHOWREEL_OFFSCREEN_PIXELS)),
    projectedCenters: projected.map(({ x, y }) => [x, y]),
    candidatesEvaluated: candidates.length,
    crossingPairCount: selected.crossingPairCount,
    minimumClearancePixels: Math.max(0, selected.minimumClearancePixels),
    continuousPathQualification: true,
    exitRetracesEntry: true,
    runtimeCalculation: false,
  });
}

function projectPreparedGearCenter(gear, assembly, sourceProfile) {
  const [rx, ry, rz] = sourceProfile.presentation.rotationDegrees;
  let point = sourcePositionToPolyCss(gear, assembly);
  point = rotateZ(point, -rz);
  point = rotateY(point, ry);
  point = rotateX(point, -rx);
  const scale = assembly.sourceFitScale * POLYCSS_SOURCE_UNIT_PIXELS;
  point = [
    point[0] + sourceProfile.sceneTranslation[0] * scale,
    point[1] - sourceProfile.sceneTranslation[1] * scale,
    point[2] + sourceProfile.sceneTranslation[2] * scale,
  ];
  const perspective = sourceProfile.camera.viewport.height / 2 /
    Math.tan(sourceProfile.camera.fovDegrees * Math.PI / 360);
  const cameraDistance = POLYCSS_SOURCE_UNIT_PIXELS * SOURCE_EYE_Z - perspective;
  const perspectiveScale = perspective / (perspective - (point[2] - cameraDistance));
  return deepFreeze({
    x: point[0] * perspectiveScale,
    y: point[1] * perspectiveScale,
    perspectiveScale,
  });
}

function distinctEdgeAssignments() {
  const assignments = [];
  for (const first of SHOWREEL_EDGE_DIRECTIONS) {
    for (const second of SHOWREEL_EDGE_DIRECTIONS) {
      for (const third of SHOWREEL_EDGE_DIRECTIONS) {
        if (new Set([first.id, second.id, third.id]).size === 3) {
          assignments.push([first, second, third]);
        }
      }
    }
  }
  return assignments;
}

function compareShowreelEdgeCandidates(left, right) {
  if (left.crossingPairCount !== right.crossingPairCount) {
    return left.crossingPairCount - right.crossingPairCount;
  }
  if (Math.abs(left.minimumClearancePixels - right.minimumClearancePixels) > 1e-7) {
    return right.minimumClearancePixels - left.minimumClearancePixels;
  }
  if (left.outwardAlignment !== right.outwardAlignment) {
    return right.outwardAlignment - left.outwardAlignment;
  }
  return left.directions.map((direction) => direction.id).join(",").localeCompare(
    right.directions.map((direction) => direction.id).join(","),
  );
}

function rotateX([x, y, z], degrees) {
  const radians = degrees * Math.PI / 180;
  return [x, y * Math.cos(radians) - z * Math.sin(radians), y * Math.sin(radians) + z * Math.cos(radians)];
}

function rotateY([x, y, z], degrees) {
  const radians = degrees * Math.PI / 180;
  return [x * Math.cos(radians) + z * Math.sin(radians), y, -x * Math.sin(radians) + z * Math.cos(radians)];
}

function rotateZ([x, y, z], degrees) {
  const radians = degrees * Math.PI / 180;
  return [x * Math.cos(radians) - y * Math.sin(radians), x * Math.sin(radians) + y * Math.cos(radians), z];
}

function dot2(left, right) {
  return left[0] * right[0] + left[1] * right[1];
}

function foldViewTilt(degrees) {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  if (normalized > 90) return normalized - 180;
  if (normalized < -90) return normalized + 180;
  return normalized;
}

function showreelPhaseForState(stateIndex) {
  if (stateIndex < SHOWREEL_ENTRY_STATE_COUNT) {
    return {
      name: "entry",
      progress: stateIndex / (SHOWREEL_ENTRY_STATE_COUNT - 1),
      sourceStateIndex: 0,
    };
  }
  const spinStateIndex = stateIndex - SHOWREEL_ENTRY_STATE_COUNT;
  if (spinStateIndex < SHOWREEL_SPIN_STATE_COUNT) {
    return { name: "spin", progress: spinStateIndex / (SHOWREEL_SPIN_STATE_COUNT - 1), sourceStateIndex: spinStateIndex };
  }
  const exitStateIndex = spinStateIndex - SHOWREEL_SPIN_STATE_COUNT;
  return {
    name: "exit",
    progress: exitStateIndex / (SHOWREEL_EXIT_STATE_COUNT - 1),
    sourceStateIndex: SHOWREEL_SPIN_STATE_COUNT - 1,
  };
}

function scaleVector(vector, scale) {
  return vector.map((value) => value * scale);
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeInCubic(value) {
  return value ** 3;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateNativeState(state) {
  if (state?.schema !== "cssgears-native-state@1" || state.planetary !== false ||
      !Array.isArray(state.gears) || state.gears.length < 3 ||
      !Array.isArray(state.scene?.rotationDegrees) || !Array.isArray(state.scene?.translation) ||
      !state.bbox || !state.viewport) {
    throw new Error("Cannot build a cssGears profile without a qualified non-planetary native state.");
  }
}

function number(value) {
  return Object.is(value, -0) || value === 0 ? "0" : String(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
