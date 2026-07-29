import {
  buildSeamBleedPolygonEdges,
  computeSolidTrianglePlan,
  DEFAULT_SEAM_BLEED,
  SOLID_TRIANGLE_BLEED,
} from "@layoutit/polycss";

import { encodePngRgba8 } from "../../../prepare/shared/png.mjs";
import {
  lexicalCompare,
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";

const TITLE_HEAD_TRIANGLE_PLAN_SCHEMA = "cssgraphics-title-head-triangle-plan@2";
const TITLE_HEAD_RENDER_TOPOLOGY_SCHEMA = "cssgraphics.title-head-render-topology.v1";

const SM64_REVISION = "9921382a68bb0c865e5e45eb594d9c64db59b1af";
const SM64JS_REVISION = "04c1a984117ebb8d0e7b0d5d2e3424367f69b92d";
const SURFACE_ATLAS_PATH = "model/title-head-surface-atlas.png";
const SURFACE_TILE_SIZE = 32;
const SURFACE_TILE_GUTTER = 2;
const SURFACE_TILE_STRIDE = SURFACE_TILE_SIZE + SURFACE_TILE_GUTTER * 2;
const SURFACE_ATLAS_COLUMNS = 16;
const PREPARED_LIGHTING_FRAME = 750;
const PREPARED_LIGHTING_MODEL = "goddard-two-light-smooth-vertex";
const LIGHT_DIRECTION_SCALE = 120;
const VERTEX_NORMAL_SCALE = 127;
const ATLAS_SUPERSAMPLES = 4;
const TITLE_HEAD_SEAM_BLEED = 1;

const PREPARED_POLYCSS_SEAM_REPAIR = Object.freeze({
  strategy: "prepared-polycss-native-solid-triangle",
  edgeTopology: "source-shared-material-edges",
  fallbackAmount: TITLE_HEAD_SEAM_BLEED,
  sharedEdgeAmount: TITLE_HEAD_SEAM_BLEED,
  runtimeEdgeDiscovery: false,
});

const FOOTPRINT_POLYCSS_SEAM_REPAIR = Object.freeze({
  strategy: "prepared-polycss-native-solid-triangle",
  edgeTopology: "source-shared-material-edges",
  fallbackAmount: SOLID_TRIANGLE_BLEED,
  sharedEdgeAmount: DEFAULT_SEAM_BLEED,
  runtimeEdgeDiscovery: false,
});

const SOURCE_LIGHTING_POLYCSS_SEAM_REPAIR = Object.freeze({
  strategy: "prepared-polycss-native-solid-triangle",
  edgeTopology: "source-shared-material-edges",
  fallbackAmount: SOLID_TRIANGLE_BLEED,
  sharedEdgeAmount: SOLID_TRIANGLE_BLEED,
  runtimeEdgeDiscovery: false,
});

function fail(message) {
  throw new TypeError(message);
}

function exactSchema(value, schema, label) {
  if (!value || value.schema !== schema || !/^[0-9a-f]{64}$/u.test(value.contentHash)) {
    fail(`${label} is not a complete prepared contract`);
  }
}

function sourcePath(path) {
  const normalized = String(path).replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized.startsWith("src/") ? normalized : `src/goddard/${normalized}`;
}

function candidateSource(path, symbol, sourceIndex = null) {
  return Object.freeze({
    repository: "sm64js/sm64js",
    revision: SM64JS_REVISION,
    path: sourcePath(path),
    symbol,
    sourceIndex,
  });
}

function authoritativeSource(symbol, sourceIndex = null, path = "src/goddard/dynlists/dynlists.h") {
  return Object.freeze({
    repository: "n64decomp/sm64",
    revision: SM64_REVISION,
    path,
    symbol,
    sourceIndex,
  });
}

function sourceToPolyCss([x, y, z]) {
  return Object.freeze([x, z, y]);
}

function rgbBytes(color) {
  const match = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u.exec(color);
  if (!match) fail(`unsupported prepared PolyCSS surface color ${color}`);
  const values = match.slice(1).map(Number);
  if (values.some((value) => value < 0 || value > 255)) fail(`invalid prepared PolyCSS surface color ${color}`);
  return values;
}

function formatRgb(bytes) {
  if (!Array.isArray(bytes) || bytes.length !== 3
    || bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    fail("prepared surface colour is not RGB8");
  }
  return `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`;
}

function regularChannel(animation, targetId) {
  const matches = animation.channels.filter((channel) => channel.targetId === targetId);
  if (matches.length !== 1) fail(`lighting target ${targetId} does not have one regular animation channel`);
  const channel = matches[0];
  const sequence = channel.regularSequence;
  const row = sequence?.samples?.[PREPARED_LIGHTING_FRAME - 1];
  if (!Array.isArray(row) || row.length !== 6 || !Array.isArray(sequence.componentScale)
    || sequence.componentScale.length !== 6) {
    fail(`lighting target ${targetId} has no complete regular frame ${PREPARED_LIGHTING_FRAME}`);
  }
  const scaled = row.map((value, index) => value * sequence.componentScale[index]);
  if (scaled.some((value) => !Number.isFinite(value))) fail(`lighting target ${targetId} has a non-finite sample`);
  return Object.freeze({
    channelId: channel.id,
    position: Object.freeze(scaled.slice(3)),
  });
}

function quantizedDirection(position, offset) {
  const relative = position.map((value, axis) => value - offset[axis]);
  const magnitude = Math.hypot(...relative);
  if (!(magnitude > 0)) fail("prepared light direction reached zero magnitude");
  return Object.freeze(relative.map((value) => Math.trunc(value / magnitude * LIGHT_DIRECTION_SCALE)));
}

function buildPreparedLighting({ animation, deformation, materials }) {
  exactSchema(animation, "cssgraphics-title-head-animation@1", "animation");
  if (animation.deformationHash !== deformation.contentHash) {
    fail("triangle plan animation does not belong to its prepared deformation graph");
  }
  const rootSample = regularChannel(animation, deformation.rootNetId);
  const sourceLights = materials.sourceState?.lighting?.lights;
  const ambientScale = materials.sourceState?.lighting?.ambientScale;
  if (!Array.isArray(sourceLights) || sourceLights.length !== 2
    || !Array.isArray(ambientScale) || ambientScale.length !== 3) {
    fail("prepared materials do not contain the two-light Goddard contract");
  }
  const lights = [...sourceLights]
    .sort((left, right) => left.lightSlot - right.lightSlot)
    .map((light) => {
      const sample = regularChannel(animation, light.id);
      if (!Array.isArray(light.diffuse) || light.diffuse.length !== 3
        || light.diffuse.some((value) => !Number.isFinite(value))
        || !Number.isFinite(light.initialIntensity)) {
        fail(`${light.id} has incomplete prepared lighting state`);
      }
      return Object.freeze({
        id: light.id,
        lightSlot: light.lightSlot,
        animationChannelId: sample.channelId,
        position: sample.position,
        diffuse: Object.freeze([...light.diffuse]),
        intensity: light.initialIntensity,
        directionS8: quantizedDirection(sample.position, rootSample.position),
      });
    });
  if (lights[0]?.id !== "N231" || lights[1]?.id !== "N228") {
    fail("prepared Goddard light-slot order drifted");
  }
  return Object.freeze({
    model: PREPARED_LIGHTING_MODEL,
    sequence: "regular",
    frame: PREPARED_LIGHTING_FRAME,
    shapeOffsetTargetId: deformation.rootNetId,
    shapeOffset: rootSample.position,
    ambientScale: Object.freeze([...ambientScale]),
    normalQuantization: "truncate-s8(current-normal * 127)",
    directionQuantization: "truncate-s32(normalized-direction * 120), then cast-s8",
    diffuseAccumulation: "ambient + max(0, dot(normal-s8, direction-s8) / (127 * 120)) * diffuse-byte",
    interpolation: "prepared-barycentric-rgba8-4x",
    runtimeLighting: false,
    lights: Object.freeze(lights),
  });
}

function shadeSourceVertex(baseColor, normalS8, lighting) {
  const base = rgbBytes(baseColor);
  if (!Array.isArray(normalS8) || normalS8.length !== 3
    || normalS8.some((value) => !Number.isInteger(value) || value < -127 || value > 127)) {
    fail("prepared source vertex normal is not signed RGB-style input");
  }
  const output = base.map((value, channel) => Math.trunc(value * lighting.ambientScale[channel]));
  for (const light of lighting.lights) {
    const dot = normalS8.reduce((total, value, axis) => total + value * light.directionS8[axis], 0);
    const intensity = Math.max(0, Math.min(1, dot / (VERTEX_NORMAL_SCALE * LIGHT_DIRECTION_SCALE)));
    for (let channel = 0; channel < 3; channel += 1) {
      const diffuseByte = Math.trunc(base[channel] * light.diffuse[channel] * light.intensity);
      output[channel] += Math.trunc(diffuseByte * intensity);
    }
  }
  return Object.freeze(output.map((value) => Math.max(0, Math.min(255, value))));
}

function barycentricWeights(x, y) {
  const top = (SURFACE_TILE_SIZE - y) / SURFACE_TILE_SIZE;
  const right = (x - SURFACE_TILE_SIZE / 2 * top) / SURFACE_TILE_SIZE;
  const left = 1 - top - right;
  return Object.freeze([top, left, right]);
}

function insideTriangle(weights) {
  return weights.every((weight) => weight >= 0 && weight <= 1);
}

function clampedTriangleWeights(x, y) {
  const clampedY = Math.max(0, Math.min(SURFACE_TILE_SIZE, y));
  const halfWidth = clampedY / 2;
  const clampedX = Math.max(SURFACE_TILE_SIZE / 2 - halfWidth, Math.min(SURFACE_TILE_SIZE / 2 + halfWidth, x));
  return barycentricWeights(clampedX, clampedY);
}

function interpolateVertexColors(vertexColors, weights) {
  return [0, 1, 2].map((channel) => Math.round(
    vertexColors.reduce((total, color, vertexIndex) => total + color[channel] * weights[vertexIndex], 0),
  ));
}

function surfaceTileKey(vertexColors) {
  return vertexColors.map((color) => color.join(",")).join("|");
}

function buildSurfaceAtlas(surfaceTiles, lighting) {
  const tileByKey = new Map();
  for (const tile of surfaceTiles) {
    const key = surfaceTileKey(tile.vertexColors);
    if (!tileByKey.has(key)) tileByKey.set(key, Object.freeze({ key, vertexColors: tile.vertexColors }));
  }
  const uniqueTiles = [...tileByKey.values()].sort((left, right) => lexicalCompare(left.key, right.key));
  const rows = Math.ceil(uniqueTiles.length / SURFACE_ATLAS_COLUMNS);
  const width = SURFACE_ATLAS_COLUMNS * SURFACE_TILE_STRIDE;
  const height = rows * SURFACE_TILE_STRIDE;
  const pixels = Buffer.alloc(width * height * 4);
  const tiles = uniqueTiles.map(({ key, vertexColors }, index) => {
    const column = index % SURFACE_ATLAS_COLUMNS;
    const row = Math.floor(index / SURFACE_ATLAS_COLUMNS);
    const cellX = column * SURFACE_TILE_STRIDE;
    const cellY = row * SURFACE_TILE_STRIDE;
    for (let y = 0; y < SURFACE_TILE_STRIDE; y += 1) {
      for (let x = 0; x < SURFACE_TILE_STRIDE; x += 1) {
        const offset = ((cellY + y) * width + cellX + x) * 4;
        const localX = x - SURFACE_TILE_GUTTER;
        const localY = y - SURFACE_TILE_GUTTER;
        let covered = 0;
        const accumulated = [0, 0, 0];
        if (localX >= 0 && localX < SURFACE_TILE_SIZE && localY >= 0 && localY < SURFACE_TILE_SIZE) {
          for (let sampleY = 0; sampleY < ATLAS_SUPERSAMPLES; sampleY += 1) {
            for (let sampleX = 0; sampleX < ATLAS_SUPERSAMPLES; sampleX += 1) {
              const weights = barycentricWeights(
                localX + (sampleX + 0.5) / ATLAS_SUPERSAMPLES,
                localY + (sampleY + 0.5) / ATLAS_SUPERSAMPLES,
              );
              if (!insideTriangle(weights)) continue;
              const color = interpolateVertexColors(vertexColors, weights);
              for (let channel = 0; channel < 3; channel += 1) accumulated[channel] += color[channel];
              covered += 1;
            }
          }
        }
        const color = covered > 0
          ? accumulated.map((value) => Math.round(value / covered))
          : interpolateVertexColors(vertexColors, clampedTriangleWeights(localX + 0.5, localY + 0.5));
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = Math.round(covered / (ATLAS_SUPERSAMPLES * ATLAS_SUPERSAMPLES) * 255);
      }
    }
    return Object.freeze({
      index,
      key,
      vertexColors: Object.freeze(vertexColors.map(formatRgb)),
      sourceRect: Object.freeze({
        x: cellX + SURFACE_TILE_GUTTER,
        y: cellY + SURFACE_TILE_GUTTER,
        width: SURFACE_TILE_SIZE,
        height: SURFACE_TILE_SIZE,
      }),
    });
  });
  const bytes = encodePngRgba8(pixels, width, height);
  const descriptor = Object.freeze({
    path: SURFACE_ATLAS_PATH,
    role: "title-head-polycss-baked-surface-atlas",
    encoding: "PNG-RGBA8",
    width,
    height,
    tileSize: SURFACE_TILE_SIZE,
    gutter: SURFACE_TILE_GUTTER,
    columns: SURFACE_ATLAS_COLUMNS,
    uniqueTiles: tiles.length,
    textureBackend: "atlas",
    textureLighting: "baked",
    lightingModel: PREPARED_LIGHTING_MODEL,
    lighting,
    leafElement: "s",
    runtimeRasterization: false,
    runtimeLighting: false,
    bytes: bytes.length,
    sha256: titleHeadSha256(bytes),
    tiles: Object.freeze(tiles),
  });
  return Object.freeze({ descriptor, bytes });
}

export function encodeTitleHeadSurfaceAtlas(trianglePlan) {
  const surfaceTiles = trianglePlan?.atlas?.tiles?.map((tile) => ({
    vertexColors: tile.vertexColors.map(rgbBytes),
  }));
  if (!Array.isArray(surfaceTiles) || surfaceTiles.length !== trianglePlan.atlas.uniqueTiles) {
    fail("triangle plan has no complete prepared surface atlas lighting tiles");
  }
  const rebuilt = buildSurfaceAtlas(surfaceTiles, trianglePlan.atlas.lighting);
  if (rebuilt.descriptor.sha256 !== trianglePlan.atlas.sha256
    || rebuilt.descriptor.bytes !== trianglePlan.atlas.bytes
    || rebuilt.descriptor.width !== trianglePlan.atlas.width
    || rebuilt.descriptor.height !== trianglePlan.atlas.height) {
    fail("prepared surface atlas metadata does not reproduce its exact PNG bytes");
  }
  return rebuilt.bytes;
}

function buildTopology({ geometry, deformation, materials }) {
  const materialById = new Map(materials.materials.map((material) => [material.id, material]));
  const netById = new Map(deformation.nets.map((net) => [net.id, net]));
  const shapes = geometry.shapes.map((shape, sourceOrder) => {
    const netIds = deformation.nets
      .filter((net) => net.displayShapeId === shape.id || net.skinShapeId === shape.id)
      .map((net) => net.id);
    return Object.freeze({
      id: shape.id,
      sourceOrder,
      vertexIds: Object.freeze(shape.vertices.map((_, index) => `${shape.id}:vertex:${index}`)),
      faceIds: Object.freeze(shape.faces.map((face) => face.id)),
      netIds: Object.freeze(netIds),
      source: candidateSource(shape.source.module, shape.source.list),
    });
  });
  const vertices = geometry.shapes.flatMap((shape) => shape.vertices.map((_, sourceIndex) => Object.freeze({
    id: `${shape.id}:vertex:${sourceIndex}`,
    shapeId: shape.id,
    sourceIndex,
    source: candidateSource(shape.source.module, shape.source.vertexDataRef.split("#").at(-1), sourceIndex),
  })));
  const faces = geometry.shapes.flatMap((shape) => shape.faces.map((face) => {
    const material = materialById.get(face.materialId);
    if (!material) fail(`${face.id} references missing material ${face.materialId}`);
    return Object.freeze({
      id: face.id,
      shapeId: shape.id,
      sourceIndex: face.sourceIndex,
      vertexIds: Object.freeze(face.indices.map((index) => `${shape.id}:vertex:${index}`)),
      materialId: face.materialId,
      sourceWinding: "source-order",
      sourceCull: material.source.sourceCull,
      productBackfaceVisibility: "visible",
      source: candidateSource(shape.source.module, shape.source.faceDataRef.split("#").at(-1), face.sourceIndex),
    });
  }));
  const materialRows = materials.materials.map((material, layerOrder) => Object.freeze({
    id: material.id,
    shapeId: material.shapeId,
    sourceMaterialId: material.sourceMaterialId,
    textureId: material.render.textureIdentity,
    layerId: material.render.layer,
    layerOrder,
    sourceAlpha: material.render.opacity,
    shine: material.source.type.name === "GD_MTL_SHINE_DL",
    source: authoritativeSource(
      material.source.type.name,
      material.sourceMaterialId,
      "src/goddard/renderer.c",
    ),
  }));
  const nets = deformation.nets.map((net) => Object.freeze({
    id: net.id,
    sourceObjectId: net.sourceObjectId,
    sourceCommandIndex: net.sourceCommandIndex,
    displayShapeId: net.displayShapeId,
    skinShapeId: net.skinShapeId,
    source: authoritativeSource(net.sourceName, net.sourceCommandIndex),
  }));
  const joints = deformation.joints.map((joint) => {
    const skinNet = netById.get(joint.skinNetId);
    if (!skinNet?.skinShapeId) fail(`${joint.id} has no prepared skin shape`);
    return Object.freeze({
      id: joint.id,
      sourceObjectId: joint.sourceObjectId,
      sourceCommandIndex: joint.sourceCommandIndex,
      skinNetId: joint.skinNetId,
      vertexIds: Object.freeze(joint.weights.map((weight) => `${skinNet.skinShapeId}:vertex:${weight.vertexIndex}`)),
      source: authoritativeSource(joint.sourceName, joint.sourceCommandIndex),
    });
  });
  const payload = {
    schema: TITLE_HEAD_RENDER_TOPOLOGY_SCHEMA,
    id: "title-head:regular-head-topology",
    coordinateSpace: "model-local",
    shapes: Object.freeze(shapes),
    vertices: Object.freeze(vertices),
    faces: Object.freeze(faces),
    materials: Object.freeze(materialRows),
    nets: Object.freeze(nets),
    joints: Object.freeze(joints),
    totals: Object.freeze({
      shapes: shapes.length,
      vertices: vertices.length,
      faces: faces.length,
      materials: materialRows.length,
      nets: nets.length,
      joints: joints.length,
    }),
  };
  return Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
}

function buildTitleHeadTrianglePlanWithSeamRepair(
  { geometry, deformation, animation, materials } = {},
  seamRepair,
) {
  exactSchema(geometry, "cssgraphics-title-head-geometry@1", "geometry");
  exactSchema(deformation, "cssgraphics-title-head-deformation@1", "deformation");
  exactSchema(materials, "cssgraphics-title-head-materials@1", "materials");
  if (deformation.geometryHash !== geometry.contentHash
    || materials.provenance.geometryContentHash !== geometry.contentHash) {
    fail("triangle plan inputs do not belong to one prepared geometry generation");
  }
  if (geometry.totals.faces !== materials.totals.faces || geometry.totals.vertices !== materials.totals.vertices) {
    fail("triangle plan geometry and material coverage disagree");
  }
  const materialById = new Map(materials.materials.map((material) => [material.id, material]));
  const normalsByShapeId = new Map(materials.normals.map((normalSet) => [normalSet.shapeId, normalSet]));
  const materialStateIndexById = new Map(materials.materials.map((material, index) => [material.id, index]));
  const shapeStateIndexById = new Map(geometry.shapes.map((shape, index) => [shape.id, index]));
  const topology = buildTopology({ geometry, deformation, materials });
  const lighting = buildPreparedLighting({ animation, deformation, materials });
  const faceInputs = geometry.shapes.flatMap((shape) => shape.faces.map((face) => {
    const material = materialById.get(face.materialId);
    if (!material) fail(`${face.id} references missing material ${face.materialId}`);
    const shapeStateIndex = shapeStateIndexById.get(shape.id);
    const materialStateIndex = materialStateIndexById.get(face.materialId);
    if (shapeStateIndex === undefined || materialStateIndex === undefined) {
      fail(`${face.id} has no prepared numeric update lookup`);
    }
    const sourceVertices = face.indices.map((index) => shape.vertices[index]);
    if (sourceVertices.some((vertex) => !vertex)) fail(`${face.id} references a missing source vertex`);
    const normalSet = normalsByShapeId.get(shape.id);
    if (!normalSet || !Array.isArray(normalSet.vertexNormalsS8)) {
      fail(`${face.id} has no prepared source vertex-normal set`);
    }
    // The Y/Z source-to-PolyCSS axis swap changes handedness. Reverse the
    // second and third corners once here so runtime never reclassifies it.
    const polycssVertices = [
      sourceToPolyCss(sourceVertices[0]),
      sourceToPolyCss(sourceVertices[2]),
      sourceToPolyCss(sourceVertices[1]),
    ];
    const baseColor = material.polycss.leafStyle.backgroundColor;
    const polygon = Object.freeze({
      vertices: Object.freeze(polycssVertices),
      color: baseColor,
      material: Object.freeze({ key: face.materialId }),
    });
    return Object.freeze({
      shape,
      face,
      material,
      shapeStateIndex,
      materialStateIndex,
      polycssVertices,
      polygon,
      normalSet,
    });
  }));
  const seamEdgesBySourceOrder = buildSeamBleedPolygonEdges(
    faceInputs.map(({ polygon }) => polygon),
    {
      tileSize: 1,
      layerElevation: 1,
    },
  );
  const plannedLeaves = faceInputs.map(({
    shape,
    face,
    material,
    shapeStateIndex,
    materialStateIndex,
    polycssVertices,
    polygon,
    normalSet,
  }, sourceOrder) => {
    const seamEdges = seamEdgesBySourceOrder.get(sourceOrder);
    const seamEdgeMask = [...(seamEdges ?? [])].reduce((mask, edgeIndex) => {
      if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex > 2) {
        fail(`${face.id} has an invalid prepared PolyCSS seam edge`);
      }
      return mask | (1 << edgeIndex);
    }, 0);
    const polycss = computeSolidTrianglePlan(
      polygon,
      sourceOrder,
      {
        tileSize: 1,
        layerElevation: 1,
        bleedRatio: 1,
        seamBleed: seamEdgeMask === 0
          ? seamRepair.fallbackAmount
          : seamRepair.sharedEdgeAmount,
        ...(seamEdges ? { seamEdges } : {}),
      },
      { primitive: "corner-bevel", includeColor: false },
    );
    if (!polycss || polycss.primitive !== "corner-bevel" || !polycss.transformText.startsWith("matrix3d(")) {
      fail(`${face.id} did not produce a fixed PolyCSS triangle plan`);
    }
    const polycssNormalIndices = [face.indices[0], face.indices[2], face.indices[1]];
    const polycssVertexColors = polycssNormalIndices.map((vertexIndex) => {
      const normal = normalSet.vertexNormalsS8[vertexIndex];
      if (!normal) fail(`${face.id} references a missing prepared source vertex normal`);
      return shadeSourceVertex(polygon.color, normal, lighting);
    });
    // PolyCSS's native solid-triangle basis maps the canonical atlas apex to
    // c, lower-left to a, and lower-right to b. Bake that ordering once.
    const canonicalVertexColors = Object.freeze([
      polycssVertexColors[polycss.basis.c],
      polycssVertexColors[polycss.basis.a],
      polycssVertexColors[polycss.basis.b],
    ]);
    const leaf = {
      id: `title-head:leaf:${face.id}`,
      sourceOrder,
      shapeId: shape.id,
      faceId: face.id,
      materialId: face.materialId,
      vertexIds: Object.freeze(face.indices.map((index) => `${shape.id}:vertex:${index}`)),
      polycss: Object.freeze({
        element: "s",
        strategy: "prepared-atlas-triangle",
        transform: polycss.transformText,
        basis: Object.freeze({ ...polycss.basis }),
        vertices: Object.freeze(polycssVertices),
        color: polygon.color,
        update: Object.freeze({
          shapeStateIndex,
          materialStateIndex,
          vertexIndices: Object.freeze([face.indices[0], face.indices[2], face.indices[1]]),
          pointOrder: "source-0-2-1",
          coordinateOrder: "source-zxy",
          canonicalSize: 32,
          matrixDecimals: 3,
          seamEdgeMask,
        }),
      }),
      presentation: Object.freeze({
        stableLeaf: true,
        productBackfaceVisibility: "visible",
        sourceCullMetadataOnly: material.source.sourceCull,
        runtimePolygonConstruction: false,
        runtimeClipConstruction: false,
      }),
    };
    return Object.freeze({
      leaf,
      surfaceTile: Object.freeze({ vertexColors: canonicalVertexColors }),
      surfaceKey: surfaceTileKey(canonicalVertexColors),
    });
  });
  const surfaceAtlas = buildSurfaceAtlas(plannedLeaves.map(({ surfaceTile }) => surfaceTile), lighting);
  const tileByKey = new Map(surfaceAtlas.descriptor.tiles.map((tile) => [tile.key, tile]));
  const leaves = plannedLeaves.map(({ leaf, surfaceKey }) => {
    const tile = tileByKey.get(surfaceKey);
    if (!tile) fail(`${leaf.faceId} has no prepared PolyCSS surface atlas tile`);
    return Object.freeze({
      ...leaf,
      polycss: Object.freeze({
        ...leaf.polycss,
        surface: Object.freeze({
          atlasTileIndex: tile.index,
          backgroundPosition: `${-tile.sourceRect.x}px ${-tile.sourceRect.y}px`,
          backgroundSize: `${surfaceAtlas.descriptor.width}px ${surfaceAtlas.descriptor.height}px`,
          leafWidth: SURFACE_TILE_SIZE,
          leafHeight: SURFACE_TILE_SIZE,
        }),
      }),
    });
  });
  if (leaves.length !== geometry.totals.faces || new Set(leaves.map(({ faceId }) => faceId)).size !== leaves.length) {
    fail("triangle plan does not cover every source face exactly once");
  }
  const payload = {
    schema: TITLE_HEAD_TRIANGLE_PLAN_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    geometryHash: geometry.contentHash,
    deformationHash: deformation.contentHash,
    animationHash: animation.contentHash,
    materialsHash: materials.contentHash,
    topology,
    atlas: surfaceAtlas.descriptor,
    mount: Object.freeze({
      renderer: "@layoutit/polycss",
      strategy: "prepared-polycss-s-atlas",
      shapeRoots: geometry.totals.shapes,
      faceLeaves: geometry.totals.faces,
      merge: false,
      stableDom: true,
      runtimePolygonConstruction: false,
      runtimeClipConstruction: false,
      runtimeRasterSurface: false,
      seamRepair,
    }),
    leaves: Object.freeze(leaves),
    totals: Object.freeze({
      shapeRoots: geometry.totals.shapes,
      leaves: leaves.length,
      sourceFaces: geometry.totals.faces,
      sourceVertices: geometry.totals.vertices,
    }),
  };
  return Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
}

export function buildTitleHeadTrianglePlan(inputs = {}) {
  return buildTitleHeadTrianglePlanWithSeamRepair(
    inputs,
    PREPARED_POLYCSS_SEAM_REPAIR,
  );
}

export function buildTitleHeadFootprintTrianglePlan(inputs = {}) {
  return buildTitleHeadTrianglePlanWithSeamRepair(
    inputs,
    FOOTPRINT_POLYCSS_SEAM_REPAIR,
  );
}

export function buildTitleHeadSourceLightingTrianglePlan(inputs = {}) {
  return buildTitleHeadTrianglePlanWithSeamRepair(
    inputs,
    SOURCE_LIGHTING_POLYCSS_SEAM_REPAIR,
  );
}
