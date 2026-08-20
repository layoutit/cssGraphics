import {
  buildClothSourceFrames,
  buildClothLightingBank,
  buildFixtureFaces,
  buildFixtureShadowCasters,
  buildGroundPlane,
  clothShadowTriangleMatrix,
  clothTriangleMatrix,
  CSSCLOTH_BANK_COUNT,
  CSSCLOTH_BANK_FRAME_COUNT,
  CSSCLOTH_LOGO_SOURCE,
  CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
  CSSCLOTH_GROUND_REPEAT_COUNT,
  CSSCLOTH_RASTER_LEAF_SIZE,
  CSSCLOTH_SHADOW_LIGHT_DIRECTION,
  CSSCLOTH_SOURCE,
  CSSCLOTH_STREAM_FRAME_COUNT,
  CSSCLOTH_WARMUP_FRAME_COUNT,
  projectClothShadowPoint,
} from "./sourceModel.mjs";
import {
  buildClothDeduplicatedLightingLayout,
  clothRasterSlice,
  clothRasterSlotSlice,
  groundImageSlice,
  shadowImageSlice,
} from "./rasterAtlas.mjs";
import { preparePolyMorphParametricShadow } from "./morphShadowPatch.mjs";

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function buildClothPreparedModel() {
  const source = buildClothSourceFrames({
    frameCount: CSSCLOTH_STREAM_FRAME_COUNT,
    warmupFrameCount: CSSCLOTH_WARMUP_FRAME_COUNT,
  });
  const lighting = buildClothLightingBank(source);
  const rasterBoxes = Object.freeze(Array.from(
    { length: source.triangles.length },
    () => Object.freeze({ width: CSSCLOTH_RASTER_LEAF_SIZE, height: CSSCLOTH_RASTER_LEAF_SIZE }),
  ));
  const rasterLayout = buildClothDeduplicatedLightingLayout(rasterBoxes, lighting.states);
  const clothShadow = preparePolyMorphParametricShadow({
    id: "cloth-shadow",
    frames: source.frames,
    worldTriangles: (frame) => frame.triangles.map((triangle) => triangle.positions),
    lightDirection: CSSCLOTH_SHADOW_LIGHT_DIRECTION,
    projectPoint: projectClothShadowPoint,
    triangleMatrix: clothShadowTriangleMatrix,
    atlas: shadowImageSlice(),
    definition: 32,
  });
  const fixtureShadows = buildFixtureShadowCasters().map((caster) =>
    preparePolyMorphParametricShadow({
      id: `fixture-shadow-${caster.id}`,
      frames: [caster.vertices],
      worldVertices: (vertices) => vertices,
      lightDirection: CSSCLOTH_SHADOW_LIGHT_DIRECTION,
      projectPoint: projectClothShadowPoint,
      triangleMatrix: clothShadowTriangleMatrix,
      atlas: shadowImageSlice(),
      definition: 8,
    }));
  const fixtures = buildFixtureFaces();
  const ground = buildGroundPlane();
  const firstFrame = source.frames[0];
  const vertices = [];
  const normals = [];
  const polygons = [];
  const shapes = [];
  const leaves = [];

  for (let triangleIndex = 0; triangleIndex < firstFrame.triangles.length; triangleIndex += 1) {
    const id = `cloth-${String(triangleIndex).padStart(3, "0")}`;
    const rasterBox = rasterBoxes[triangleIndex];
    const atlas = clothRasterSlice(triangleIndex, rasterLayout);
    shapes.push(Object.freeze({ id, matrix: IDENTITY }));
    addTriangleTopology(vertices, normals, polygons, id, rasterBox.width, rasterBox.height);
    leaves.push(Object.freeze({
      id: `leaf-${id}`,
      polygonId: id,
      shapeId: id,
      materialId: "material-cloth",
      strategy: "solid-triangle",
      width: rasterBox.width,
      height: rasterBox.height,
      matrix: clothTriangleMatrix(firstFrame, triangleIndex),
      atlas: null,
      fallback: Object.freeze({
        width: atlas.width,
        height: atlas.height,
        matrixFromLeaf: IDENTITY,
        atlas,
      }),
    }));
  }

  shapes.push(Object.freeze({ id: "ground", matrix: IDENTITY }));
  addQuadTopology(vertices, normals, polygons, ground.id, ground.width, ground.height);
  leaves.push(Object.freeze({
    id: `leaf-${ground.id}`,
    polygonId: ground.id,
    shapeId: "ground",
    materialId: "material-ground",
    strategy: "direct-image",
    width: ground.width,
    height: ground.height,
    matrix: ground.matrix,
    atlas: groundImageSlice(),
    fallback: null,
  }));

  shapes.push(clothShadow.shape);
  appendShadowTopology(vertices, normals, polygons, clothShadow.topology);
  leaves.push(...clothShadow.leaves);
  for (const fixtureShadow of fixtureShadows) {
    shapes.push(fixtureShadow.shape);
    appendShadowTopology(vertices, normals, polygons, fixtureShadow.topology);
    leaves.push(...fixtureShadow.leaves);
  }

  shapes.push(Object.freeze({ id: "fixtures", matrix: IDENTITY }));
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    addQuadTopology(vertices, normals, polygons, fixture.id, 64);
    leaves.push(Object.freeze({
      id: `leaf-${fixture.id}`,
      polygonId: fixture.id,
      shapeId: "fixtures",
      materialId: `material-fixture-${String(index).padStart(2, "0")}`,
      strategy: "solid-quad",
      width: 64,
      height: 64,
      matrix: fixture.matrix,
      atlas: null,
      fallback: null,
    }));
  }

  const playbackBanks = buildPreparedPlaybackBanks(
    source,
    clothShadow,
    lighting.frameRows,
    rasterLayout.stateSlots,
  );
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({ id: "cloth", name: "Cloth", revision: "1.0.0" }),
    profile: "static-prepared",
    capabilities: Object.freeze(["retained-render"]),
    budgets: Object.freeze({
      maxVertices: vertices.length,
      maxPolygons: polygons.length,
      maxLeaves: leaves.length,
      maxFrames: 0,
      maxJoints: 0,
      maxResources: rasterLayout.pages.length + 3,
      maxBytes: 96 * 1024 * 1024,
    }),
    topology: Object.freeze({
      vertices: Object.freeze(vertices),
      normals: Object.freeze(normals),
      polygons: Object.freeze(polygons),
    }),
    materials: Object.freeze([
      Object.freeze({ id: "material-cloth", color: Object.freeze([1, 1, 1, 1]) }),
      Object.freeze({ id: "material-ground", color: Object.freeze([1, 1, 1, 1]) }),
      clothShadow.material,
      ...fixtures.map((fixture, index) => Object.freeze({
        id: `material-fixture-${String(index).padStart(2, "0")}`,
        color: Object.freeze([...fixture.color, 1]),
      })),
    ]),
    render: Object.freeze({
      modelMatrix: IDENTITY,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }),
    deformation: Object.freeze({ kind: "none" }),
    controls: Object.freeze([]),
    springs: Object.freeze([]),
    animations: Object.freeze([]),
    playback: null,
    provenance: Object.freeze({
      generator: "csscloth-preparer",
      generatorVersion: "1.0.0",
      sources: Object.freeze([Object.freeze({
        id: "three-webgl-animation-cloth-r132",
        kind: "open-data",
        uri: `https://github.com/mrdoob/three.js/blob/${CSSCLOTH_SOURCE.revision}/${CSSCLOTH_SOURCE.primaryPath}`,
        sha256: CSSCLOTH_SOURCE.primarySha256,
        license: "MIT",
      }), Object.freeze({
        id: "css-next-official-css-logo",
        kind: "open-data",
        uri: `${CSSCLOTH_LOGO_SOURCE.repository}/blob/${CSSCLOTH_LOGO_SOURCE.revision}/${CSSCLOTH_LOGO_SOURCE.path}`,
        sha256: CSSCLOTH_LOGO_SOURCE.sha256,
        license: CSSCLOTH_LOGO_SOURCE.license,
      })]),
    }),
  });

  return deepFreeze({
    model,
    playbackBanks,
    lightingStates: lighting.states,
    rasterBoxes,
    metrics: Object.freeze({
      particleCount: 121,
      clothTriangleCount: firstFrame.triangles.length,
      groundLeafCount: 1,
      clothShadowLeafCount: clothShadow.leafCount,
      fixtureShadowLeafCount: fixtureShadows.reduce((sum, shadow) => sum + shadow.leafCount, 0),
      shadowLeafCount: clothShadow.leafCount + fixtureShadows.reduce((sum, shadow) => sum + shadow.leafCount, 0),
      groundTextureRepeatCount: CSSCLOTH_GROUND_REPEAT_COUNT,
      fixtureLeafCount: fixtures.length,
      retainedShapeCount: shapes.length,
      retainedLeafCount: leaves.length,
      clothRasterLeafSize: CSSCLOTH_RASTER_LEAF_SIZE,
      clothRasterPageCount: rasterLayout.pages.length,
      clothRasterPagePixels: rasterLayout.pages.reduce((sum, page) => sum + page.width * page.height, 0),
      clothLightingStateCount: lighting.states.reduce((sum, states) => sum + states.length, 0),
      clothAtlasStoredStateCount: lighting.states.reduce((sum, states) => sum + states.length, 0),
      clothAtlasUniqueStateCount: rasterLayout.slots.length,
      clothAtlasDeduplicatedStateCount:
        lighting.states.reduce((sum, states) => sum + states.length, 0) - rasterLayout.slots.length,
      bankCount: playbackBanks.length,
      bankFrameCount: CSSCLOTH_BANK_FRAME_COUNT,
      bankDurationMilliseconds: CSSCLOTH_BANK_FRAME_COUNT * CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      frameCount: CSSCLOTH_STREAM_FRAME_COUNT,
      frameMilliseconds: CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      durationMilliseconds: CSSCLOTH_STREAM_FRAME_COUNT * CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      maximumShapeWritesPerFrame: firstFrame.triangles.length,
      maximumShadowLeafWritesPerFrame: clothShadow.leafCount,
      averageAtlasRowWritesPerFrame: averageLightingWrites(playbackBanks),
      runtimeGeometryConstructionCount: 0,
      runtimeDomGrowth: false,
    }),
  });
}

export function applyClothRasterPlan(prepared, raster) {
  const layout = raster?.clothLayout;
  if (!layout || layout.stateSlots.length !== prepared.metrics.clothTriangleCount ||
      layout.slots.length !== raster.clothUniqueStateCount) {
    throw new TypeError("Cloth deduplicated raster plan is incomplete");
  }
  let triangleIndex = 0;
  const leaves = prepared.model.render.leaves.map((leaf) => {
    if (!/^leaf-cloth-\d{3}$/u.test(leaf.id)) return leaf;
    const atlas = clothRasterSlotSlice(layout.stateSlots[triangleIndex][0], layout);
    triangleIndex += 1;
    return Object.freeze({
      ...leaf,
      fallback: Object.freeze({
        ...leaf.fallback,
        width: atlas.width,
        height: atlas.height,
        atlas,
      }),
    });
  });
  const model = Object.freeze({
    ...prepared.model,
    budgets: Object.freeze({
      ...prepared.model.budgets,
      maxResources: layout.pages.length + (raster.clothLogoPages?.length ?? 0) + 3,
    }),
    render: Object.freeze({
      ...prepared.model.render,
      leaves: Object.freeze(leaves),
    }),
  });
  const playbackBanks = Object.freeze(prepared.playbackBanks.map((playback) => Object.freeze({
    ...playback,
    atlasStateSlots: layout.stateSlots,
  })));
  const metrics = Object.freeze({
    ...prepared.metrics,
    clothRasterPageCount: layout.pages.length,
    clothLogoRasterPageCount: raster.clothLogoPages?.length ?? 0,
    clothRasterPagePixels: layout.pages.reduce((sum, page) => sum + page.width * page.height, 0),
    clothAtlasStoredStateCount: raster.clothStoredStateCount,
    clothAtlasUniqueStateCount: raster.clothUniqueStateCount,
    clothAtlasDeduplicatedStateCount: raster.clothStoredStateCount - raster.clothUniqueStateCount,
  });
  return deepFreeze({ ...prepared, model, playbackBanks, metrics });
}

function buildPreparedPlaybackBanks(source, clothShadow, lightingRows, atlasStateSlots) {
  if (source.frames.length !== CSSCLOTH_STREAM_FRAME_COUNT ||
      clothShadow.frames.length !== CSSCLOTH_STREAM_FRAME_COUNT ||
      lightingRows.length !== CSSCLOTH_STREAM_FRAME_COUNT) {
    throw new Error("Cloth prepared bank stream is incomplete");
  }
  return Object.freeze(Array.from({ length: CSSCLOTH_BANK_COUNT }, (_, bankIndex) => {
    const frameOffset = bankIndex * CSSCLOTH_BANK_FRAME_COUNT;
    const frames = Object.freeze(Array.from({ length: CSSCLOTH_BANK_FRAME_COUNT }, (_, frameIndex) => {
      const streamFrameIndex = frameOffset + frameIndex;
      const frame = source.frames[streamFrameIndex];
      return Object.freeze({
        matrices: Object.freeze(frame.triangles.map((_, triangleIndex) =>
          clothTriangleMatrix(frame, triangleIndex))),
        lightingRows: lightingRows[streamFrameIndex],
        shadowMatrices: clothShadow.frames[streamFrameIndex].matrices,
        shadowVisibility: clothShadow.frames[streamFrameIndex].visibility,
      });
    }));
    return Object.freeze({
      schema: "csscloth-prepared-playback-bank-source@1",
      bankIndex,
      streamFrameOffset: frameOffset,
      frameCount: frames.length,
      triangleCount: source.triangles.length,
      shadowTriangleCount: clothShadow.leafCount,
      frameMilliseconds: CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      durationMilliseconds: frames.length * CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      atlasStateSlots,
      frames,
    });
  }));
}

function appendShadowTopology(vertices, normals, polygons, topology) {
  const vertexOffset = vertices.length;
  const normalOffset = normals.length;
  vertices.push(...topology.vertices);
  normals.push(...topology.normals);
  for (const polygon of topology.polygons) {
    polygons.push(Object.freeze({
      id: polygon.id,
      vertexIndices: Object.freeze(polygon.vertexIndices.map((index) => index + vertexOffset)),
      normalIndices: Object.freeze(polygon.normalIndices.map((index) => index + normalOffset)),
    }));
  }
}

function averageLightingWrites(playbackBanks) {
  let previous = null;
  let writes = 0;
  let frameCount = 0;
  for (const playback of playbackBanks) {
    for (const frame of playback.frames) {
      for (let triangleIndex = 0; triangleIndex < frame.lightingRows.length; triangleIndex += 1) {
        if (previous?.[triangleIndex] !== frame.lightingRows[triangleIndex]) writes += 1;
      }
      previous = frame.lightingRows;
      frameCount += 1;
    }
  }
  return writes / frameCount;
}

function addTriangleTopology(vertices, normals, polygons, id, width, height) {
  const vertexOffset = vertices.length;
  vertices.push(Object.freeze([0, 0, 0]), Object.freeze([width, 0, 0]), Object.freeze([0, height, 0]));
  const normalIndex = normals.length;
  normals.push(Object.freeze([0, 0, 1]));
  polygons.push(Object.freeze({
    id,
    vertexIndices: Object.freeze([vertexOffset, vertexOffset + 1, vertexOffset + 2]),
    normalIndices: Object.freeze([normalIndex, normalIndex, normalIndex]),
  }));
}

function addQuadTopology(vertices, normals, polygons, id, width, height = width) {
  const vertexOffset = vertices.length;
  vertices.push(
    Object.freeze([0, 0, 0]),
    Object.freeze([width, 0, 0]),
    Object.freeze([width, height, 0]),
    Object.freeze([0, height, 0]),
  );
  const normalIndex = normals.length;
  normals.push(Object.freeze([0, 0, 1]));
  polygons.push(Object.freeze({
    id,
    vertexIndices: Object.freeze([vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset + 3]),
    normalIndices: Object.freeze([normalIndex, normalIndex, normalIndex, normalIndex]),
  }));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
