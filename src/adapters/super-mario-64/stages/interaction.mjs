import {
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";
import {
  closeSync,
  constants as fsConstants,
  openSync,
  readSync,
} from "node:fs";
import {
  encodePngRgba8Paeth,
} from "../../../prepare/shared/png.mjs";
import {
  decodeRgba16,
} from "../n64TextureDecode.mjs";
import {
  SM64_US_ROM,
} from "../romSource.mjs";
import {
  decodeMio0,
} from "../textureExtract.mjs";
import {
  preparationRuntimeCodeUrl,
} from "../codeLayout.mjs";

export const TITLE_HEAD_PACKAGE_BACKGROUND_PATH = "title-background.png";
const TITLE_HEAD_PACKAGE_BACKGROUND_SHA256 =
  "f0552d5925c4ed703674d5ce258407b682f1517296ebd9a417eab0ac4eb3647b";
const TITLE_HEAD_COMPLETED_ARTIFACT_ROLES = Object.freeze({
  "animation-graph.json": "title-head-animation-contract",
  "deformation-graph.json": "title-head-deformation-contract",
  "head-geometry.json": "title-head-geometry-contract",
  "lighting-atlases.json": "title-head-lighting-atlases-contract",
  "materials.json": "title-head-material-contract",
  "model/title-head-leaves.css": "title-head-prepared-leaf-styles",
  "model/title-head-lit-native.webp":
    "title-head-prepared-space-time-static-opaque-rgb-native-shape-frame-matrix-webp",
  "model/title-head-surface-atlas.png": "title-head-polycss-baked-surface-atlas",
  "motion-frames.bin": "title-head-prepared-motion",
  "motion-transform-strings.bin": "title-head-prepared-motion-transform-table",
  "playback-packet.json": "title-head-playback-packet-contract",
  "star-effects-packet.json": "title-head-star-effects-packet-contract",
  "textures.json": "title-head-texture-contract",
  "textures/hand-closed.png": "cursor-closed-png",
  "textures/hand-open.png": "cursor-open-png",
  "textures/mario-face-shine.png": "model-shine-png",
  "textures/star-effects.png": "title-head-star-effects-atlas-png",
  "triangle-plan.json": "title-head-triangle-plan-contract",
});

// interactionPacket
const TITLE_HEAD_INTERACTION_PACKET_SCHEMA =
  "cssgraphics-title-head-interaction-packet@1";
const TITLE_HEAD_INTERACTION_PACKET_LAYOUT =
  "direct-sparse-closures-v1";

function interactionPacketFail(message) {
  throw new TypeError(`Title-head interaction packet prepare failed: ${message}`);
}

function interactionPacketCanonical(value) {
  if (Array.isArray(value)) return value.map(interactionPacketCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, interactionPacketCanonical(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    interactionPacketFail("non-finite values are forbidden");
  }
  return value;
}

function finalizeTitleHeadInteractionPacket(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    interactionPacketFail("payload must be an object");
  }
  if (Object.hasOwn(payload, "contentHash")) {
    interactionPacketFail("contentHash is owned by the finalizer");
  }
  if (payload.schema !== TITLE_HEAD_INTERACTION_PACKET_SCHEMA
    || payload.layout !== TITLE_HEAD_INTERACTION_PACKET_LAYOUT) {
    interactionPacketFail("schema or layout is not the sole final contract");
  }
  const normalized = interactionPacketCanonical(payload);
  return Object.freeze({
    ...normalized,
    contentHash: titleHeadContentHash(normalized),
  });
}

function serializeTitleHeadInteractionPacket(packet) {
  return `${JSON.stringify(interactionPacketCanonical(packet), null, 2)}\n`;
}

// interactionClosures
const TITLE_HEAD_INTERACTION_CLOSURE_INDEX_SCHEMA =
  "cssgraphics-title-head-interaction-closure-index@2";
const SHA256 = /^[0-9a-f]{64}$/u;
const f32 = Math.fround;

function interactionClosuresFail(message) {
  throw new TypeError(`Title-head interaction closure prepare failed: ${message}`);
}

function interactionClosureCanonical(value) {
  if (Array.isArray(value)) return value.map(interactionClosureCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, interactionClosureCanonical(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    interactionClosuresFail("non-finite values are forbidden");
  }
  return value;
}

function f32Word(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, f32(value), false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function f32Words(values) {
  return values.map(f32Word);
}

function multiply(left, right) {
  return f32(f32(left) * f32(right));
}

function add(left, right) {
  return f32(f32(left) + f32(right));
}

function sourceObjects(runtime) {
  return new Map([
    ...runtime.deformation.nets.map((value) => [value.id, value]),
    ...runtime.deformation.joints.map((value) => [value.id, value]),
  ]);
}

function controlDiscovery(contracts, runtime) {
  const graphJoints = new Map(contracts.deformation.joints.map((joint) => [joint.id, joint]));
  const graphNets = new Map(contracts.deformation.nets.map((net) => [net.id, net]));
  const controls = contracts.deformation.controls
    .slice()
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  return controls.map((control) => {
    const attachmentIds = control.attachments.map(({ objectId }) => objectId);
    const activeVertices = new Map();
    if (control.mode === "grab") {
      for (const attachmentId of attachmentIds) {
        const joint = graphJoints.get(attachmentId);
        const net = joint ? graphNets.get(joint.skinNetId) : null;
        if (!joint || !net?.skinShapeId) interactionClosuresFail(`${control.id} has an invalid joint attachment.`);
        const vertices = activeVertices.get(net.skinShapeId) ?? new Set();
        for (const weight of joint.weights) vertices.add(weight.vertexIndex);
        activeVertices.set(net.skinShapeId, vertices);
      }
    } else {
      for (const attachmentId of attachmentIds) {
        const net = graphNets.get(attachmentId);
        if (!net?.displayShapeId) interactionClosuresFail(`${control.id} has an invalid rigid eye attachment.`);
        activeVertices.set(net.displayShapeId, new Set());
      }
    }
    const leaves = contracts.trianglePlan.leaves.filter((leaf) => {
      const vertices = activeVertices.get(leaf.shapeId);
      if (control.mode === "eye-follow") return vertices !== undefined;
      return vertices !== undefined
        && leaf.polycss.update.vertexIndices.some((vertexIndex) => vertices.has(vertexIndex));
    });
    if (leaves.length === 0) interactionClosuresFail(`${control.id} has no affected leaves.`);
    const renderVertices = new Map();
    for (const leaf of leaves) {
      const vertices = renderVertices.get(leaf.shapeId) ?? new Set();
      for (const vertexIndex of leaf.polycss.update.vertexIndices) vertices.add(vertexIndex);
      renderVertices.set(leaf.shapeId, vertices);
    }
    const contributorJointIds = new Set();
    if (control.mode === "grab") {
      for (const [shapeId, vertices] of activeVertices) {
        for (const net of runtime.deformation.nets) {
          if (net.objectType !== 4 || net.skinShapeId !== shapeId) continue;
          for (const jointId of net.jointIds) {
            const joint = runtime.deformation.joints.find(({ id }) => id === jointId);
            if (joint?.weights.some(({ vertexIndex }) => vertices.has(vertexIndex))) {
              contributorJointIds.add(jointId);
            }
          }
        }
      }
    }
    return Object.freeze({
      control,
      attachmentIds: Object.freeze(attachmentIds),
      activeVertices,
      renderVertices,
      leaves: Object.freeze(leaves),
      contributorJointIds,
    });
  });
}

function buildObjectTable(discoveries, runtime, animator, deformation) {
  const requiredIds = new Set();
  for (const discovery of discoveries) {
    for (const id of discovery.attachmentIds) requiredIds.add(id);
    for (const id of discovery.contributorJointIds) requiredIds.add(id);
  }
  const objectsById = sourceObjects(runtime);
  const snapshotById = new Map(deformation.objects.map((value) => [value.id, value]));
  const ids = runtime.deformation.objectOrder.filter((id) => requiredIds.has(id));
  if (ids.length !== requiredIds.size) interactionClosuresFail("required sparse objects escaped the source order.");
  const kinds = [];
  const sourceIndices = [];
  const localMatrices = [];
  const worldMatrices = [];
  const rotationMatrices = [];
  for (const id of ids) {
    const object = objectsById.get(id);
    const snapshot = snapshotById.get(id);
    if (!object || !snapshot) interactionClosuresFail(`sparse object ${id} has no frame-660 state.`);
    kinds.push(object.kind === "joint" ? 1 : 0);
    sourceIndices.push(runtime.deformation.objectOrder.indexOf(id));
    localMatrices.push(...(animator.objectMatrixOverrides[id] ?? object.localMatrix));
    worldMatrices.push(...snapshot.worldMatrix);
    rotationMatrices.push(...snapshot.rotationMatrix);
  }
  return Object.freeze({
    ids: Object.freeze(ids),
    kinds: Object.freeze(kinds),
    sourceIndices: Object.freeze(sourceIndices),
    localMatrices: Object.freeze(localMatrices.map(f32)),
    worldMatrices: Object.freeze(worldMatrices.map(f32)),
    rotationMatrices: Object.freeze(rotationMatrices.map(f32)),
  });
}

function buildShapes(runtime, draw) {
  return Object.freeze({
    ids: Object.freeze(draw.shapes.map(({ id }) => id)),
    sourceIndices: Object.freeze(draw.shapes.map((_, index) => index)),
    baseMatrices: Object.freeze(draw.shapeMatrices.flatMap((matrix) => matrix).map(f32)),
  });
}

function residualPosition(runtime, shapeId, vertexIndex) {
  const shape = runtime.deformation.shapes.find(({ id }) => id === shapeId);
  const residual = runtime.deformation.residualScaleByShape[shapeId];
  if (!shape || !residual) interactionClosuresFail(`shape ${shapeId} has no residual position base.`);
  return Object.freeze([
    multiply(shape.vertices[vertexIndex][0], residual[vertexIndex]),
    multiply(shape.vertices[vertexIndex][1], residual[vertexIndex]),
    multiply(shape.vertices[vertexIndex][2], residual[vertexIndex]),
  ]);
}

function vertexContributions({
  runtime,
  shapeId,
  vertexIndex,
  activeAttachments,
  objectIndexById,
  objectSnapshotById,
}) {
  const rows = [];
  for (const net of runtime.deformation.nets) {
    if (net.objectType !== 4 || net.skinShapeId !== shapeId) continue;
    for (const jointId of net.jointIds) {
      const joint = runtime.deformation.joints.find(({ id }) => id === jointId);
      const object = objectSnapshotById.get(jointId);
      if (!joint || !object) interactionClosuresFail(`joint ${jointId} has no frame-660 contribution base.`);
      for (const weight of joint.weights) {
        if (weight.vertexIndex !== vertexIndex) continue;
        const linear = runtime.math.gdTransformDirection(weight.bindLocal, object.worldMatrix);
        rows.push(Object.freeze({
          jointObjectIndex: objectIndexById.get(jointId),
          active: activeAttachments.has(jointId),
          scalar: weight.scalar,
          linear,
          translation: Object.freeze([
            object.worldMatrix[12],
            object.worldMatrix[13],
            object.worldMatrix[14],
          ]),
        }));
      }
    }
  }
  return Object.freeze(rows);
}

function reconstructVertex(program, offsetByObjectIndex) {
  const position = [...program.initial];
  for (const weight of program.weights) {
    const offset = weight.active
      ? offsetByObjectIndex.get(weight.jointObjectIndex) ?? [0, 0, 0]
      : [0, 0, 0];
    for (let component = 0; component < 3; component += 1) {
      const translation = add(weight.translation[component], offset[component]);
      const contribution = add(weight.linear[component], translation);
      position[component] = add(
        position[component],
        multiply(contribution, weight.scalar),
      );
    }
  }
  return Object.freeze(position.map(f32));
}

function buildControl({
  discovery,
  runtime,
  contracts,
  objectTable,
  shapes,
  draw,
  rootInverse,
}) {
  const { control } = discovery;
  const objectIndexById = new Map(objectTable.ids.map((id, index) => [id, index]));
  const shapeIndexById = new Map(shapes.ids.map((id, index) => [id, index]));
  const objectSnapshotById = new Map(runtime.baseDeformation.objects.map((value) => [value.id, value]));
  const activeAttachments = new Set(discovery.attachmentIds);
  const objectIndices = [...new Set([
    ...discovery.attachmentIds,
    ...discovery.contributorJointIds,
  ].map((id) => objectIndexById.get(id)))].sort((left, right) => left - right);
  if (objectIndices.some((value) => value === undefined)) {
    interactionClosuresFail(`${control.id} object closure is incomplete.`);
  }
  const jointIndices = control.mode === "grab"
    ? objectIndices.filter((index) => objectTable.kinds[index] === 1)
    : [];
  const shapeIndices = [...discovery.activeVertices.keys()]
    .map((id) => shapeIndexById.get(id));
  const vertexShapeIndices = [...discovery.renderVertices.keys()]
    .map((id) => shapeIndexById.get(id))
    .sort((left, right) => left - right);
  const vertexEntries = [];
  for (const shapeIndex of vertexShapeIndices) {
    const shapeId = shapes.ids[shapeIndex];
    const shape = draw.shapes[shapeIndex];
    const active = discovery.activeVertices.get(shapeId) ?? new Set();
    const render = discovery.renderVertices.get(shapeId);
    if (!render || shape.id !== shapeId) interactionClosuresFail(`${control.id} shape ${shapeId} is incomplete.`);
    for (const vertexIndex of [...render].sort((left, right) => left - right)) {
      const weighted = control.mode === "grab" && active.has(vertexIndex);
      const weights = weighted
        ? vertexContributions({
            runtime,
            shapeId,
            vertexIndex,
            activeAttachments,
            objectIndexById,
            objectSnapshotById,
          })
        : Object.freeze([]);
      if (weighted && !weights.some(({ active: isActive }) => isActive)) {
        interactionClosuresFail(`${control.id} vertex ${shapeId}:${vertexIndex} has no active weight.`);
      }
      const entry = Object.freeze({
        id: `${shapeId}:vertex:${vertexIndex}`,
        shapeIndex,
        sourceVertexIndex: vertexIndex,
        initial: weighted
          ? residualPosition(runtime, shapeId, vertexIndex)
          : shape.positions[vertexIndex],
        neutral: shape.positions[vertexIndex],
        normal: shape.normals[vertexIndex],
        weights,
      });
      if (weighted) {
        const reconstructed = reconstructVertex(entry, new Map());
        if (f32Words(reconstructed).join(",") !== f32Words(entry.neutral).join(",")) {
          interactionClosuresFail(`${control.id} ${entry.id} ordered neutral program is not bit exact.`);
        }
      }
      vertexEntries.push(entry);
    }
  }
  const vertexRowById = new Map(vertexEntries.map((entry, index) => [entry.id, index]));
  const vertexRows = [];
  const vertexPositions = [];
  const vertexNormals = [];
  const weightJointIndices = [];
  const weightActiveFlags = [];
  const weightScalars = [];
  const weightLinearContributions = [];
  const weightBaseTranslations = [];
  for (const entry of vertexEntries) {
    const weightOffset = weightScalars.length;
    vertexRows.push(
      entry.shapeIndex,
      entry.sourceVertexIndex,
      weightOffset,
      entry.weights.length,
    );
    vertexPositions.push(...entry.initial);
    vertexNormals.push(...entry.normal);
    for (const weight of entry.weights) {
      weightJointIndices.push(weight.jointObjectIndex);
      weightActiveFlags.push(weight.active ? 1 : 0);
      weightScalars.push(weight.scalar);
      weightLinearContributions.push(...weight.linear);
      weightBaseTranslations.push(...weight.translation);
    }
  }
  const faceIndices = discovery.leaves.map(({ sourceOrder }) => sourceOrder);
  const leafRows = discovery.leaves.flatMap((leaf) => {
    const vertexRowsForLeaf = leaf.polycss.update.vertexIndices.map((vertexIndex) => {
      const index = vertexRowById.get(`${leaf.shapeId}:vertex:${vertexIndex}`);
      if (index === undefined) interactionClosuresFail(`${control.id} leaf ${leaf.id} escaped its vertex closure.`);
      return index;
    });
    return [
      leaf.sourceOrder,
      shapeIndexById.get(leaf.shapeId),
      ...vertexRowsForLeaf,
      leaf.polycss.basis.a,
      leaf.polycss.basis.b,
      leaf.polycss.basis.c,
      leaf.polycss.update.seamEdgeMask,
      leaf.polycss.update.materialStateIndex,
    ];
  });
  let projected;
  if (control.mode === "grab") {
    projected = runtime.picking.projectTitleHeadGrabbers(runtime.pickingRuntime)
      .find(({ id }) => id === control.id);
  } else {
    const sourcePosition = control.sourcePosition.map(f32);
    const projection = runtime.math.gdProjectWorldToScreen(
      sourcePosition,
      runtime.pickingRuntime.camera.viewMatrix,
      runtime.pickingRuntime.viewport,
    );
    const difference = Object.freeze([
      f32(sourcePosition[0] - runtime.pickingRuntime.camera.worldPosition[0]),
      f32(sourcePosition[1] - runtime.pickingRuntime.camera.worldPosition[1]),
      f32(sourcePosition[2] - runtime.pickingRuntime.camera.worldPosition[2]),
    ]);
    projected = Object.freeze({
      screenPosition: projection.position,
      cameraDistance: runtime.math.gdVectorMagnitude(difference),
    });
  }
  if (!projected) interactionClosuresFail(`${control.id} has no source projection.`);
  return Object.freeze({
    packet: Object.freeze({
      id: control.id,
      role: control.role,
      mode: control.mode,
      sourceOrder: control.sourceOrder,
      sourcePosition: Object.freeze(control.sourcePosition.map(f32)),
      screenPosition: Object.freeze(projected.screenPosition.slice(0, 2).map(f32)),
      cameraDistance: f32(projected.cameraDistance),
      attachmentObjectIndices: Object.freeze(
        discovery.attachmentIds.map((id) => objectIndexById.get(id))
          .sort((left, right) => left - right),
      ),
      closure: Object.freeze({
        objectIndices: Object.freeze(objectIndices),
        jointIndices: Object.freeze(jointIndices),
        shapeIndices: Object.freeze(shapeIndices),
        vertexRows: Object.freeze(vertexRows),
        vertexPositions: Object.freeze(vertexPositions.map(f32)),
        vertexNormals: Object.freeze(vertexNormals.map(f32)),
        weightJointIndices: Object.freeze(weightJointIndices),
        weightActiveFlags: Object.freeze(weightActiveFlags),
        weightScalars: Object.freeze(weightScalars.map(f32)),
        weightLinearContributions: Object.freeze(weightLinearContributions.map(f32)),
        weightBaseTranslations: Object.freeze(weightBaseTranslations.map(f32)),
        faceIndices: Object.freeze(faceIndices),
        leafRows: Object.freeze(leafRows),
        safeVisibleLeafIndices: Object.freeze(
          control.mode === "grab" ? faceIndices : [],
        ),
        rigidRootInverseMatrix: Object.freeze(
          control.mode === "eye-follow" ? [...rootInverse] : [],
        ),
      }),
    }),
    vertexEntries: Object.freeze(vertexEntries),
    leaves: discovery.leaves,
  });
}

function buildTitleHeadInteractionPacket({
  runtime: modules,
  contracts,
  protectedFiles,
} = {}) {
  if (!modules?.animator || !modules?.deformation || !modules?.draw
    || !modules?.picking || !modules?.grab
    || !modules?.eyes || !modules?.math) {
    interactionClosuresFail("compiled prepare/test evaluator closure is incomplete.");
  }
  const deformationRuntime = modules.deformation.createPreparedTitleHeadDeformationRuntime({
    geometry: contracts.geometry,
    deformation: contracts.deformation,
    materials: contracts.materials,
  });
  const animatorRuntime = modules.animator.createPreparedTitleHeadAnimatorRuntime({
    animation: contracts.animation,
    deformation: contracts.deformation,
  });
  const animator = modules.animator.sampleTitleHeadAnimator(animatorRuntime, 660);
  const neutralGrabberWorldOffsets = Object.freeze(Object.fromEntries(
    contracts.deformation.controls
      .filter(({ mode }) => mode === "grab")
      .flatMap(({ attachments }) => attachments.map(({ objectId }) => [
        objectId,
        Object.freeze([0, 0, 0]),
      ])),
  ));
  const baseDeformation = modules.deformation.evaluateTitleHeadDeformation(
    deformationRuntime,
    {
      tick: 659,
      localMatrixOverrides: animator.objectMatrixOverrides,
      // move_grabber_joints publishes every grabber attachment on every tick,
      // including exact zero offsets before the first pick. Preserve that f32
      // boundary instead of sampling a deformation-only approximation.
      worldMatrixOffsets: neutralGrabberWorldOffsets,
    },
  );
  const drawRuntime = modules.draw.createTitleHeadDrawRuntime(deformationRuntime);
  const draw = modules.draw.evaluateTitleHeadDrawRuntime(drawRuntime, baseDeformation);
  const pickingRuntime = modules.picking.createPreparedTitleHeadPickingRuntime(
    contracts.deformation,
  );
  const grabRuntime = modules.grab.createTitleHeadGrabRuntime(pickingRuntime);
  const runtime = Object.freeze({
    animator: modules.animator,
    deformation: deformationRuntime,
    draw,
    baseDeformation,
    picking: modules.picking,
    pickingRuntime,
    grabRuntime,
    math: modules.math,
  });
  const discoveries = controlDiscovery(contracts, runtime);
  const objects = buildObjectTable(discoveries, runtime, animator, baseDeformation);
  const shapes = buildShapes(runtime, draw);
  const root = baseDeformation.objects.find(({ id }) => id === deformationRuntime.rootNetId);
  if (!root) interactionClosuresFail("frame-660 root model matrix is absent.");
  const rootInverse = modules.math.gdInverseMatrix(root.rotationMatrix);
  const builtControls = discoveries.map((discovery) => buildControl({
    discovery,
    runtime,
    contracts,
    objectTable: objects,
    shapes,
    draw,
    rootInverse,
  }));
  const descriptor = (path) => {
    const value = protectedFiles.find((entry) => entry.path === path);
    if (!value || !SHA256.test(value.sha256)) interactionClosuresFail(`protected file ${path} is absent.`);
    return value;
  };
  const bindings = Object.freeze({
    animationHash: contracts.animation.contentHash,
    deformationHash: contracts.deformation.contentHash,
    geometryHash: contracts.geometry.contentHash,
    materialsHash: contracts.materials.contentHash,
    trianglePlanHash: contracts.trianglePlan.contentHash,
    lightingHash: contracts.lighting.contentHash,
    playbackHash: contracts.playback.contentHash,
    starEffectsHash: contracts.stars.contentHash,
    motionFramesSha256: descriptor("motion-frames.bin").sha256,
    motionTransformStringsSha256: descriptor("motion-transform-strings.bin").sha256,
    atlasSha256: descriptor("model/title-head-lit-native.webp").sha256,
  });
  const counts = Object.freeze({
    sourceObjectCount: deformationRuntime.objectOrder.length,
    sourceJointCount: deformationRuntime.joints.length,
    packetObjectCount: objects.ids.length,
    packetJointCount: objects.kinds.filter((kind) => kind === 1).length,
    shapeCount: draw.shapes.length,
    sourceVertexCount: draw.shapes.reduce(
      (total, shape) => total + shape.positions.length,
      0,
    ),
    faceCount: contracts.trianglePlan.leaves.length,
    leafCount: contracts.trianglePlan.leaves.length,
    materialCount: contracts.trianglePlan.topology.materials.length,
    controlCount: 9,
    grabCount: 7,
    eyeCount: 2,
  });
  const payload = {
    schema: TITLE_HEAD_INTERACTION_PACKET_SCHEMA,
    layout: TITLE_HEAD_INTERACTION_PACKET_LAYOUT,
    bindings,
    source: {
      frame: 660,
      animatorState: 7,
      cadenceHz: 30,
      mirrorX: 320,
      cursorBounds: [16, 272, 16, 208],
      viewport: [320, 240],
      cameraWorldPosition: pickingRuntime.camera.worldPosition,
      cameraLookAt: pickingRuntime.camera.lookAt,
      cameraViewMatrix: pickingRuntime.camera.viewMatrix,
      inverseCameraMatrix: grabRuntime.inverseCameraMatrix,
      displacementMagnitude: grabRuntime.displacementMagnitude,
      eyeMaximumOffset: 30,
      spring: {
        pickedResistance: -0.25,
        releaseAcceleration: 0.5,
        velocityDecay: f32(0.8),
        snapVelocityL1: 1,
        snapOffsetL1: 1,
        cursorResistance: f32(0.2),
        grabbedFlag: 8192,
      },
      rejoin: {
        seekFrame: 660,
        nextFrame: 661,
        animatorHoldState: 7,
        animatorExitState: 6,
        animatorResumeState: 2,
      },
      leafTransform: {
        coordinateOrder: "source-zxy",
        pointOrder: "source-0-2-1",
        canonicalSize: 32,
        matrixDecimals: 3,
        leafRowStride: 10,
        vertexRowStride: 4,
      },
      updateOrder: [
        "control",
        "animator",
        "grabber-joint-movement",
        "eye-follow",
        "sparse-deformation",
        "sparse-leaf-publication",
        "grab-pick-drag",
      ],
    },
    counts,
    objects,
    shapes,
    controls: Object.freeze(builtControls.map(({ packet }) => packet)),
    proof: {
      controlClosuresPrepared: 9,
      projectedDirectionsPrepared: true,
      sparseStateBound: true,
      safeVisibilityBound: true,
      springAndRejoinBound: true,
      singleRootPrepared: true,
    },
  };
  const packet = finalizeTitleHeadInteractionPacket(payload);
  return Object.freeze({ packet });
}

function buildTitleHeadInteractionClosureIndex({
  protectedFiles,
  interactionPacketFile,
  backgroundFile,
} = {}) {
  if (!Array.isArray(protectedFiles) || protectedFiles.length === 0
    || interactionPacketFile?.path !== "interaction-packet.json"
    || !SHA256.test(interactionPacketFile.sha256)
    || backgroundFile?.path !== TITLE_HEAD_PACKAGE_BACKGROUND_PATH
    || backgroundFile.role !== "title-head-background-png"
    || backgroundFile.sha256 !== TITLE_HEAD_PACKAGE_BACKGROUND_SHA256) {
    interactionClosuresFail("closure-index inputs are incomplete.");
  }
  const files = Object.freeze([
    ...protectedFiles,
    interactionPacketFile,
    backgroundFile,
  ].map((entry) => Object.freeze({ ...entry }))
    .sort((left, right) => (
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )));
  if (new Set(files.map(({ path }) => path)).size !== files.length) {
    interactionClosuresFail("closure-index file paths are duplicated.");
  }
  const payload = {
    schema: TITLE_HEAD_INTERACTION_CLOSURE_INDEX_SCHEMA,
    authority: "semantic-completed-root-plus-package-inputs",
    protectedFiles: Object.freeze(
      protectedFiles.map(({ path }) => path).sort(),
    ),
    addedFiles: Object.freeze([
      "interaction-packet.json",
      TITLE_HEAD_PACKAGE_BACKGROUND_PATH,
    ]),
    files,
    counts: Object.freeze({
      protectedFiles: protectedFiles.length,
      addedFiles: 2,
      indexedFiles: files.length,
    }),
  };
  return Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
}

function serializeTitleHeadInteractionClosureIndex(value) {
  return `${JSON.stringify(interactionClosureCanonical(value), null, 2)}\n`;
}

// packageBackground
const BACKDROP_MIO0 = Object.freeze({
  romOffset: 2558144,
  sourceBytes: 12510,
  decodedBytes: 26088,
});
const ROW_OFFSETS = Object.freeze([448, 3648, 6848, 10048]);
const TILE_WIDTH = 80;
const TILE_HEIGHT = 80;
const WIDTH = 320;
const HEIGHT = 240;

function packageBackgroundFail(message) {
  throw new Error(`Prepare title background failed: ${message}`);
}

function assertQualifiedRom(rom) {
  if (!rom?.qualified
    || rom.region !== SM64_US_ROM.region
    || rom.byteOrder !== SM64_US_ROM.byteOrder
    || rom.size !== SM64_US_ROM.size
    || rom.sha1 !== SM64_US_ROM.sha1
    || rom.copied !== false) {
    packageBackgroundFail("a qualified user-owned US big-endian ROM is required");
  }
}

function readExactRange(path, offset, bytes) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY);
  } catch (error) {
    packageBackgroundFail(`could not open the qualified ROM read-only: ${error.message}`);
  }
  const output = Buffer.alloc(bytes);
  let cursor = 0;
  try {
    while (cursor < bytes) {
      const count = readSync(
        descriptor,
        output,
        cursor,
        bytes - cursor,
        offset + cursor,
      );
      if (count === 0) packageBackgroundFail("the ROM ended inside the title-backdrop range");
      cursor += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return output;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function unbrandedTile(rows) {
  const tile = Buffer.concat(rows);
  const output = Buffer.alloc(TILE_WIDTH * TILE_HEIGHT * 4);
  for (let y = 0; y < TILE_HEIGHT; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const index = (y * TILE_WIDTH + x) * 4;
      const sourceBlue = tile[index + 2];
      const nx = (x + 0.5 - TILE_WIDTH / 2) / (TILE_WIDTH / 2);
      const ny = (y + 0.5 - TILE_HEIGHT / 2) / (TILE_HEIGHT / 2);
      const radial = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny));
      const sourceTexture = ((sourceBlue & 0x1f) - 15) * 0.45;
      const blue = clampByte(20 + radial * 116 + sourceTexture);
      output[index] = clampByte(blue * 0.24);
      output[index + 1] = clampByte(blue * 0.12);
      output[index + 2] = blue;
      output[index + 3] = 255;
    }
  }
  return output;
}

function prepareTitleHeadPackageBackground({
  romPath,
  qualifiedRom,
} = {}) {
  assertQualifiedRom(qualifiedRom);
  if (typeof romPath !== "string" || romPath.length === 0) {
    packageBackgroundFail("the qualified ROM path is required");
  }
  const compressed = readExactRange(
    romPath,
    BACKDROP_MIO0.romOffset,
    BACKDROP_MIO0.sourceBytes,
  );
  const decoded = decodeMio0(compressed, 0);
  if (decoded.decodedSize !== BACKDROP_MIO0.decodedBytes) {
    packageBackgroundFail("the title-backdrop MIO0 decoded boundary changed");
  }
  const rows = ROW_OFFSETS.map((offset) => decodeRgba16(
    decoded.bytes.subarray(offset, offset + TILE_WIDTH * 20 * 2),
    TILE_WIDTH,
    20,
  ));
  const tile = unbrandedTile(rows);
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    const sourceY = y % TILE_HEIGHT;
    for (let x = 0; x < WIDTH; x += 1) {
      const sourceX = x % TILE_WIDTH;
      const source = (sourceY * TILE_WIDTH + sourceX) * 4;
      const target = (y * WIDTH + x) * 4;
      tile.copy(pixels, target, source, source + 4);
    }
  }
  const bytes = encodePngRgba8Paeth(pixels, WIDTH, HEIGHT);
  return Object.freeze({
    bytes,
    descriptor: Object.freeze({
      path: "title-background.png",
      role: "title-head-background-png",
      bytes: bytes.length,
      sha256: titleHeadSha256(bytes),
      width: WIDTH,
      height: HEIGHT,
      source: "qualified-rom-title-backdrop-unbranded-presentation",
    }),
  });
}

// interactionClosureProducer
function interactionProducerFail(message) {
  throw new Error(`Prepare interaction closure failed: ${message}`);
}

async function loadPreparationRuntime() {
  const [
    animator,
    deformation,
    draw,
    eyes,
    grab,
    math,
    picking,
  ] = await Promise.all([
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/animator.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/deformationRuntime.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/drawRuntime.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/eyeFollow.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/grabRuntime.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/math.ts")),
    import(preparationRuntimeCodeUrl("src/adapters/super-mario-64/source-model/picking.ts")),
  ]);
  return Object.freeze({
    animator,
    deformation,
    draw,
    eyes,
    grab,
    math,
    picking,
  });
}

function completeProtectedFiles(artifactLedger) {
  const expectedPaths = Object.keys(TITLE_HEAD_COMPLETED_ARTIFACT_ROLES);
  if (!Array.isArray(artifactLedger)
    || artifactLedger.length !== expectedPaths.length) {
    interactionProducerFail("the live prepared artifact ledger is incomplete");
  }
  const files = artifactLedger.map((entry) => {
    const role = TITLE_HEAD_COMPLETED_ARTIFACT_ROLES[entry.path];
    if (role === undefined
      || entry.role !== role
      || !Number.isSafeInteger(entry.bytes)
      || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      interactionProducerFail(`prepared artifact ${entry.path} is not the accepted live output`);
    }
    return Object.freeze({ ...entry });
  });
  if (new Set(files.map(({ path }) => path)).size !== expectedPaths.length) {
    interactionProducerFail("the live prepared artifact ledger contains duplicate paths");
  }
  return Object.freeze(files);
}

async function prepareTitleHeadInteractionClosure({
  romPath,
  qualifiedRom,
  contracts,
  artifactLedger,
}) {
  const protectedFiles = completeProtectedFiles(artifactLedger);
  const modules = await loadPreparationRuntime();
  const built = buildTitleHeadInteractionPacket({
    runtime: modules,
    contracts,
    protectedFiles,
  });
  const packetBytes = Buffer.from(
    serializeTitleHeadInteractionPacket(built.packet),
  );
  const background = prepareTitleHeadPackageBackground({
    romPath,
    qualifiedRom,
  });
  if (background.descriptor.sha256 !== TITLE_HEAD_PACKAGE_BACKGROUND_SHA256) {
    interactionProducerFail("the deterministic title background identity changed");
  }
  const interactionPacketFile = Object.freeze({
    path: "interaction-packet.json",
    role: "title-head-interaction-packet-contract",
    bytes: packetBytes.length,
    sha256: titleHeadSha256(packetBytes),
  });
  const backgroundFile = Object.freeze({
    path: TITLE_HEAD_PACKAGE_BACKGROUND_PATH,
    role: "title-head-background-png",
    bytes: background.bytes.length,
    sha256: titleHeadSha256(background.bytes),
  });
  const index = buildTitleHeadInteractionClosureIndex({
    protectedFiles,
    interactionPacketFile,
    backgroundFile,
  });
  return Object.freeze({
    contract: built.packet,
    index,
    files: Object.freeze([
      Object.freeze({
        path: interactionPacketFile.path,
        role: interactionPacketFile.role,
        bytes: packetBytes,
      }),
      Object.freeze({
        path: backgroundFile.path,
        role: backgroundFile.role,
        bytes: background.bytes,
      }),
      Object.freeze({
        path: "closure-index.json",
        role: "title-head-interaction-closure-index",
        bytes: Buffer.from(serializeTitleHeadInteractionClosureIndex(index)),
      }),
    ]),
  });
}
export {
  prepareTitleHeadInteractionClosure,
};
