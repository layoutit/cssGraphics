import { createHash } from "node:crypto";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import { PNG } from "pngjs";
import { registerPreparedLightingAsset } from "./preparedLighting.mjs";

const KEY_SCALE = 1e7;
const EDGE_SCALE = 1e7;
const SOURCE_TILE_SIZE = 2;
const BUNDLE_GUTTER = 1;
const SUPERSAMPLE = 2;
const MAX_ATLAS_SEARCH_WIDTH = 1024;
const MAX_ATLAS_SEARCH_HEIGHT = 1536;

export function buildPreparedGearsRenderBundles({ meshes, faceVertexColors, lighting }) {
  const sourceFaceCount = Array.isArray(meshes)
    ? meshes.reduce((sum, mesh) => sum + (Array.isArray(mesh?.polygons) ? mesh.polygons.length : 0), 0)
    : 0;
  if (!Array.isArray(meshes) || meshes.length !== 3 ||
      sourceFaceCount === 0 || !Array.isArray(faceVertexColors) || faceVertexColors.length !== sourceFaceCount ||
      lighting?.schema !== "cssgears-prepared-opengl-static-lighting-atlas@1") {
    throw new TypeError("Complete cssGears source faces and prepared lighting are required");
  }

  let sourceFaceOffset = 0;
  const renderMeshes = [];
  const leaves = [];
  const bundleRows = [];
  for (const mesh of meshes) {
    const components = contiguousMergeComponents(mesh.polygons);
    const componentByFace = new Map();
    for (const component of components) {
      for (const polygonIndex of component) componentByFace.set(polygonIndex, component);
    }
    const polygons = [];
    for (let polygonIndex = 0; polygonIndex < mesh.polygons.length; polygonIndex += 1) {
      const component = componentByFace.get(polygonIndex);
      if (component && polygonIndex !== component[0]) continue;
      const sourcePolygonIndices = component ?? [polygonIndex];
      const sourceFaceIndices = sourcePolygonIndices.map((index) => sourceFaceOffset + index);
      const leafIndex = leaves.length;
      const leaf = component
        ? buildBundleLeaf(mesh.polygons, sourcePolygonIndices, sourceFaceIndices, faceVertexColors)
        : buildSourceLeaf(mesh.polygons[polygonIndex], sourceFaceIndices[0], faceVertexColors[sourceFaceIndices[0]]);
      leaves.push(leaf);
      if (leaf.bundle) bundleRows.push(leafIndex);
      polygons.push(Object.freeze({
        vertices: leaf.vertices,
        color: leaf.color,
        sourceFaceIndices: Object.freeze([...sourceFaceIndices]),
        data: Object.freeze({
          "cssgears-gear": mesh.sourceGear.id,
          "cssgears-gear-index": mesh.gearIndex,
          "cssgears-leaf": leafIndex,
          "cssgears-source": "hacks/glx/involute.c#draw_involute_gear",
        }),
      }));
    }
    renderMeshes.push(Object.freeze({ ...mesh, polygons: Object.freeze(polygons) }));
    sourceFaceOffset += mesh.polygons.length;
  }

  const coverage = leaves.flatMap((leaf) => leaf.sourceFaceIndices).sort((left, right) => left - right);
  if (coverage.length !== sourceFaceOffset || coverage.some((sourceFaceIndex, index) => sourceFaceIndex !== index)) {
    throw new Error("Prepared cssGears render bundles do not cover every source face exactly once");
  }
  const atlas = packAtlas(leaves, bundleRows);
  const bytes = PNG.sync.write(atlas.image, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceFaceCoverageSha256 = createHash("sha256")
    .update(leaves.map((leaf) => leaf.sourceFaceIndices.join(",")).join("\n"))
    .digest("hex");
  const bundleSourceFaceCount = leaves.reduce(
    (sum, leaf) => sum + (leaf.bundle ? leaf.sourceFaceIndices.length : 0),
    0,
  );
  const atlasPixelCount = atlas.image.width * atlas.image.height;
  const contract = Object.freeze({
    ...lighting,
    schema: "cssgears-prepared-opengl-static-render-atlas@1",
    technique: "prepared-contiguous-coplanar-source-coverage-render-bundles",
    assetUrl: `/cssgears/assets/render-${sha256}.png`,
    assetSha256: sha256,
    interpolation: "prepared-source-face-vertex-color-raster-with-alpha-coverage",
    width: atlas.image.width,
    height: atlas.image.height,
    sourceTileWidth: SOURCE_TILE_SIZE,
    sourceTileHeight: SOURCE_TILE_SIZE,
    sourceFaceCount: sourceFaceOffset,
    faceCount: sourceFaceOffset,
    leafCount: leaves.length,
    polygonLeafCount: leaves.length - bundleRows.length,
    bundleLeafCount: bundleRows.length,
    bundledSourceFaceCount: bundleSourceFaceCount,
    unbundledSourceFaceCount: sourceFaceOffset - bundleSourceFaceCount,
    sourceFaceCoverageCount: coverage.length,
    sourceFaceCoverageSha256,
    sourceFaceCoverageExact: true,
    leafRows: Object.freeze(atlas.rows.map((row) => Object.freeze(row))),
    packing: "maxrects-best-short-side-fit-minimum-maximum-dimension@1",
    gutterPixels: BUNDLE_GUTTER,
    packedTilePixelCount: atlas.tilePixelCount,
    packedFootprintPixelCount: atlas.footprintPixelCount,
    atlasPixelCount,
    atlasOccupancy: atlas.footprintPixelCount / atlasPixelCount,
    decodedBytes: atlasPixelCount * 4,
    backgroundSize: `${atlas.image.width}px ${atlas.image.height}px`,
  });
  registerPreparedLightingAsset(contract, bytes);

  return Object.freeze({
    meshes: Object.freeze(renderMeshes),
    lighting: contract,
    metrics: Object.freeze({
      preparedLeafCount: leaves.length,
      preparedPolygonLeafCount: leaves.length - bundleRows.length,
      preparedRenderBundleCount: bundleRows.length,
      mergedSourceFaceCount: bundleSourceFaceCount,
      sourceFaceCoverageCount: coverage.length,
      sourceFaceCoverageSha256,
      sourceFaceCoverageExact: true,
    }),
  });
}

function contiguousMergeComponents(polygons) {
  const planeGroups = new Map();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex];
    if (!Array.isArray(polygon.vertices) || polygon.vertices.length !== 4) continue;
    const normal = polygonNormal(polygon.vertices);
    const planeDistance = dot(normal, polygon.vertices[0]);
    const key = [
      ...normal.map(quantized),
      quantized(planeDistance),
      ...polygon.material.map(quantized),
    ].join("|");
    if (!planeGroups.has(key)) planeGroups.set(key, []);
    planeGroups.get(key).push(polygonIndex);
  }

  const components = [];
  for (const polygonIndices of planeGroups.values()) {
    const edgeOwners = new Map();
    for (const polygonIndex of polygonIndices) {
      const vertices = polygons[polygonIndex].vertices;
      for (let index = 0; index < vertices.length; index += 1) {
        const left = vertexKey(vertices[index]);
        const right = vertexKey(vertices[(index + 1) % vertices.length]);
        const key = left < right ? `${left}|${right}` : `${right}|${left}`;
        if (!edgeOwners.has(key)) edgeOwners.set(key, []);
        edgeOwners.get(key).push(polygonIndex);
      }
    }
    const neighbors = new Map(polygonIndices.map((polygonIndex) => [polygonIndex, new Set()]));
    for (const owners of edgeOwners.values()) {
      if (owners.length < 2) continue;
      for (const left of owners) {
        for (const right of owners) if (left !== right) neighbors.get(left).add(right);
      }
    }
    const visited = new Set();
    for (const polygonIndex of polygonIndices) {
      if (visited.has(polygonIndex)) continue;
      const stack = [polygonIndex];
      const component = [];
      visited.add(polygonIndex);
      while (stack.length > 0) {
        const current = stack.pop();
        component.push(current);
        for (const neighbor of neighbors.get(current)) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
      component.sort((left, right) => left - right);
      const preservesPaintOrder = component.at(-1) - component[0] + 1 === component.length;
      if (component.length > 1 && preservesPaintOrder) components.push(Object.freeze(component));
    }
  }
  return components.sort((left, right) => left[0] - right[0]);
}

function buildSourceLeaf(polygon, sourceFaceIndex, vertexColors) {
  const corners = cornerVertexIndices(polygon.vertices).map((vertexIndex) => vertexColors[vertexIndex]);
  return Object.freeze({
    bundle: false,
    vertices: polygon.vertices,
    color: averageColor(corners),
    sourceFaceIndices: Object.freeze([sourceFaceIndex]),
    tile: sourceTile(corners),
  });
}

function buildBundleLeaf(polygons, polygonIndices, sourceFaceIndices, faceVertexColors) {
  const first = polygons[polygonIndices[0]];
  const normal = polygonNormal(first.vertices);
  const planeDistance = dot(normal, first.vertices[0]);
  const xAxis = planeXAxis(normal);
  const yAxis = normalize(cross(normal, xAxis));
  const vertices = polygonIndices.flatMap((polygonIndex) => polygons[polygonIndex].vertices);
  const us = vertices.map((vertex) => dot(vertex, xAxis));
  const vs = vertices.map((vertex) => dot(vertex, yAxis));
  const minU = Math.min(...us);
  const maxU = Math.max(...us);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const point = (u, v) => [0, 1, 2].map((axis) =>
    xAxis[axis] * u + yAxis[axis] * v + normal[axis] * planeDistance);
  const bundleVertices = Object.freeze([
    Object.freeze(point(minU, minV)),
    Object.freeze(point(maxU, minV)),
    Object.freeze(point(maxU, maxV)),
    Object.freeze(point(minU, maxV)),
  ]);
  const plan = computeTextureAtlasPlanPublic({ vertices: bundleVertices, color: "#ffffff" }, 0);
  if (!plan || !(plan.canvasW > 0) || !(plan.canvasH > 0)) {
    throw new Error("Prepared cssGears render bundle has no PolyCSS plane basis");
  }
  const width = Math.max(2, Math.ceil(plan.canvasW));
  const height = Math.max(2, Math.ceil(plan.canvasH));
  const tile = rasterizeBundle({
    polygons,
    polygonIndices,
    sourceFaceIndices,
    faceVertexColors,
    xAxis,
    yAxis,
    minU,
    maxU,
    minV,
    maxV,
    width,
    height,
  });
  const colors = sourceFaceIndices.flatMap((faceIndex) => faceVertexColors[faceIndex]);
  return Object.freeze({
    bundle: true,
    vertices: bundleVertices,
    color: averageColor(colors),
    sourceFaceIndices: Object.freeze([...sourceFaceIndices]),
    tile,
  });
}

function rasterizeBundle(options) {
  const highWidth = options.width * SUPERSAMPLE;
  const highHeight = options.height * SUPERSAMPLE;
  const data = new Uint8ClampedArray(highWidth * highHeight * 4);
  for (let localFaceIndex = 0; localFaceIndex < options.polygonIndices.length; localFaceIndex += 1) {
    const polygon = options.polygons[options.polygonIndices[localFaceIndex]];
    const sourceFaceIndex = options.sourceFaceIndices[localFaceIndex];
    const points = polygon.vertices.map((vertex) => [
      (dot(vertex, options.xAxis) - options.minU) / (options.maxU - options.minU) * highWidth,
      (options.maxV - dot(vertex, options.yAxis)) / (options.maxV - options.minV) * highHeight,
    ]);
    const colors = options.faceVertexColors[sourceFaceIndex];
    drawTriangle(data, highWidth, highHeight, [points[0], points[1], points[2]], [colors[0], colors[1], colors[2]]);
    drawTriangle(data, highWidth, highHeight, [points[0], points[2], points[3]], [colors[0], colors[2], colors[3]]);
  }
  return Object.freeze({ width: options.width, height: options.height, data: downsample(data, highWidth, highHeight) });
}

function drawTriangle(data, width, height, points, colors) {
  const area = edge(points[0], points[1], points[2]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0]))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point[0]))) - 1);
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))) - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sample = [x + 0.5, y + 0.5];
      const w0 = edge(points[1], points[2], sample) / area;
      const w1 = edge(points[2], points[0], sample) / area;
      const w2 = edge(points[0], points[1], sample) / area;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(
          colors[0][channel] * w0 + colors[1][channel] * w1 + colors[2][channel] * w2,
        )));
      }
      data[offset + 3] = 255;
    }
  }
}

function downsample(source, sourceWidth, sourceHeight) {
  const width = sourceWidth / SUPERSAMPLE;
  const height = sourceHeight / SUPERSAMPLE;
  const output = new Uint8ClampedArray(width * height * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sums = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const sourceOffset = (((y * SUPERSAMPLE + sy) * sourceWidth) + x * SUPERSAMPLE + sx) * 4;
          if (source[sourceOffset + 3] === 0) continue;
          covered += 1;
          for (let channel = 0; channel < 3; channel += 1) sums[channel] += source[sourceOffset + channel];
        }
      }
      const outputOffset = (y * width + x) * 4;
      if (covered > 0) {
        for (let channel = 0; channel < 3; channel += 1) output[outputOffset + channel] = Math.round(sums[channel] / covered);
        output[outputOffset + 3] = Math.round(covered / samples * 255);
      }
    }
  }
  return output;
}

function sourceTile(colors) {
  const data = new Uint8ClampedArray(SOURCE_TILE_SIZE * SOURCE_TILE_SIZE * 4);
  for (let index = 0; index < colors.length; index += 1) {
    const offset = index * 4;
    data[offset] = colors[index][0];
    data[offset + 1] = colors[index][1];
    data[offset + 2] = colors[index][2];
    data[offset + 3] = 255;
  }
  return Object.freeze({ width: SOURCE_TILE_SIZE, height: SOURCE_TILE_SIZE, data });
}

function packAtlas(leaves, bundleRows) {
  const bundleIndices = new Set(bundleRows);
  const rectangles = leaves.map((leaf, index) => {
    const gutter = bundleIndices.has(index) ? BUNDLE_GUTTER : 0;
    return Object.freeze({
      index,
      gutter,
      width: leaf.tile.width + gutter * 2,
      height: leaf.tile.height + gutter * 2,
    });
  }).sort(comparePackingRectangles);
  const packing = findDensePacking(rectangles);
  const rows = new Array(leaves.length);
  for (const placement of packing.placements) {
    const leaf = leaves[placement.index];
    rows[placement.index] = [
      placement.x + placement.gutter,
      placement.y + placement.gutter,
      leaf.tile.width,
      leaf.tile.height,
    ];
  }
  const image = new PNG({ width: packing.width, height: packing.height, colorType: 6 });
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
    const leaf = leaves[leafIndex];
    const [x, y] = rows[leafIndex];
    blit(image, leaf.tile, x, y, leaf.bundle ? BUNDLE_GUTTER : 0);
  }
  return Object.freeze({
    image,
    rows: Object.freeze(rows),
    tilePixelCount: leaves.reduce((sum, leaf) => sum + leaf.tile.width * leaf.tile.height, 0),
    footprintPixelCount: rectangles.reduce((sum, rectangle) => sum + rectangle.width * rectangle.height, 0),
  });
}

function findDensePacking(rectangles) {
  const minimumWidth = Math.max(...rectangles.map((rectangle) => rectangle.width));
  let best = null;
  for (let width = minimumWidth; width <= MAX_ATLAS_SEARCH_WIDTH; width += 2) {
    const candidate = packRectangles(rectangles, width, MAX_ATLAS_SEARCH_HEIGHT);
    if (!candidate) continue;
    const score = [
      Math.max(candidate.width, candidate.height),
      candidate.width * candidate.height,
      Math.abs(candidate.width - candidate.height),
      candidate.width,
    ];
    if (!best || compareNumberRows(score, best.score) < 0) best = { ...candidate, score };
  }
  if (!best) throw new Error("Prepared cssGears render atlas did not fit its deterministic packing bounds");
  assertPacking(best.placements, best.width, best.height);
  return best;
}

function packRectangles(rectangles, binWidth, binHeight) {
  let freeRectangles = [{ x: 0, y: 0, width: binWidth, height: binHeight }];
  const placements = [];
  for (const rectangle of rectangles) {
    let best = null;
    for (const free of freeRectangles) {
      if (rectangle.width > free.width || rectangle.height > free.height) continue;
      const remainingWidth = free.width - rectangle.width;
      const remainingHeight = free.height - rectangle.height;
      const score = [
        Math.min(remainingWidth, remainingHeight),
        Math.max(remainingWidth, remainingHeight),
        free.y,
        free.x,
      ];
      if (!best || compareNumberRows(score, best.score) < 0) best = { free, score };
    }
    if (!best) return null;
    const placement = Object.freeze({
      ...rectangle,
      x: best.free.x,
      y: best.free.y,
    });
    placements.push(placement);
    freeRectangles = splitFreeRectangles(freeRectangles, placement);
  }
  return Object.freeze({
    width: Math.max(...placements.map((placement) => placement.x + placement.width)),
    height: Math.max(...placements.map((placement) => placement.y + placement.height)),
    placements: Object.freeze(placements),
  });
}

function splitFreeRectangles(freeRectangles, placement) {
  const split = [];
  for (const free of freeRectangles) {
    if (!rectanglesOverlap(free, placement)) {
      split.push(free);
      continue;
    }
    if (placement.x > free.x) {
      split.push({ x: free.x, y: free.y, width: placement.x - free.x, height: free.height });
    }
    if (placement.x + placement.width < free.x + free.width) {
      split.push({
        x: placement.x + placement.width,
        y: free.y,
        width: free.x + free.width - placement.x - placement.width,
        height: free.height,
      });
    }
    if (placement.y > free.y) {
      split.push({ x: free.x, y: free.y, width: free.width, height: placement.y - free.y });
    }
    if (placement.y + placement.height < free.y + free.height) {
      split.push({
        x: free.x,
        y: placement.y + placement.height,
        width: free.width,
        height: free.y + free.height - placement.y - placement.height,
      });
    }
  }
  return split.filter((candidate, index, all) => !all.some((other, otherIndex) =>
    index !== otherIndex && rectangleContains(other, candidate)));
}

function assertPacking(placements, width, height) {
  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    const left = placements[leftIndex];
    if (left.x < 0 || left.y < 0 || left.x + left.width > width || left.y + left.height > height) {
      throw new Error(`Prepared cssGears atlas leaf ${left.index} exceeds its packed bounds`);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      if (rectanglesOverlap(left, placements[rightIndex])) {
        throw new Error(`Prepared cssGears atlas leaves ${left.index} and ${placements[rightIndex].index} overlap`);
      }
    }
  }
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
}

function rectangleContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function comparePackingRectangles(left, right) {
  return Math.max(right.width, right.height) - Math.max(left.width, left.height) ||
    right.width * right.height - left.width * left.height ||
    right.height - left.height || right.width - left.width || left.index - right.index;
}

function compareNumberRows(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function blit(image, tile, targetX, targetY, gutter) {
  for (let y = -gutter; y < tile.height + gutter; y += 1) {
    for (let x = -gutter; x < tile.width + gutter; x += 1) {
      const sourceX = Math.max(0, Math.min(tile.width - 1, x));
      const sourceY = Math.max(0, Math.min(tile.height - 1, y));
      const sourceOffset = (sourceY * tile.width + sourceX) * 4;
      const targetOffset = ((targetY + y) * image.width + targetX + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) image.data[targetOffset + channel] = tile.data[sourceOffset + channel];
    }
  }
}

function cornerVertexIndices(vertices) {
  const plan = computeTextureAtlasPlanPublic({ vertices, color: "#ffffff" }, 0);
  if (!plan || plan.screenPts?.length !== 8) throw new Error("Prepared cssGears source face has no PolyCSS basis");
  const xs = [plan.screenPts[0], plan.screenPts[2], plan.screenPts[4], plan.screenPts[6]];
  const ys = [plan.screenPts[1], plan.screenPts[3], plan.screenPts[5], plan.screenPts[7]];
  const targets = [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.min(...ys)],
    [Math.min(...xs), Math.max(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
  const available = new Set([0, 1, 2, 3]);
  return targets.map(([targetX, targetY]) => {
    let best = -1;
    let distance = Infinity;
    for (const vertexIndex of available) {
      const candidate = (xs[vertexIndex] - targetX) ** 2 + (ys[vertexIndex] - targetY) ** 2;
      if (candidate < distance) {
        best = vertexIndex;
        distance = candidate;
      }
    }
    available.delete(best);
    return best;
  });
}

function planeXAxis(normal) {
  const preferred = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const parallel = dot(preferred, normal);
  return normalize(preferred.map((component, axis) => component - normal[axis] * parallel));
}

function polygonNormal(vertices) {
  return normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
}

function edge(left, right, point) {
  return (point[0] - left[0]) * (right[1] - left[1]) - (point[1] - left[1]) * (right[0] - left[0]);
}

function subtract(left, right) {
  return left.map((component, axis) => component - right[axis]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error("Prepared cssGears render bundle has a degenerate vector");
  return vector.map((component) => component / length);
}

function quantized(value) {
  return Math.round(value * KEY_SCALE);
}

function vertexKey(vertex) {
  return vertex.map((value) => Math.round(value * EDGE_SCALE)).join(",");
}

function averageColor(colors) {
  return `#${[0, 1, 2].map((channel) => Math.round(
    colors.reduce((sum, color) => sum + color[channel], 0) / colors.length,
  ).toString(16).padStart(2, "0")).join("")}`;
}
