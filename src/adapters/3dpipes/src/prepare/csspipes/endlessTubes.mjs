import { createPolyCylinder } from "@layoutit/polycss";
import { sourceMaterialColor } from "./formatAdapters.mjs";

function windowsMaterial(sourceIndex, symbol, ambient, diffuse, specular, shininess) {
  return Object.freeze({
    sourceIndex,
    symbol,
    ambient: Object.freeze([...ambient, 1]),
    diffuse: Object.freeze([...diffuse, 1]),
    specular: Object.freeze([...specular, 1]),
    shininess,
    cssSrgb: sourceMaterialColor([...diffuse, 1]),
  });
}

// Exact source order from the Microsoft Win95 SDK sample's goodMaterials[].
const WINDOWS_GOOD_MATERIALS = Object.freeze([
  windowsMaterial(0, "EMERALD",
    [0.0215, 0.1745, 0.0215], [0.07568, 0.61424, 0.07568],
    [0.633, 0.727811, 0.633], 0.6),
  windowsMaterial(1, "JADE",
    [0.135, 0.2225, 0.1575], [0.54, 0.89, 0.63],
    [0.316228, 0.316228, 0.316228], 0.1),
  windowsMaterial(3, "PEARL",
    [0.25, 0.20725, 0.20725], [1, 0.829, 0.829],
    [0.296648, 0.296648, 0.296648], 0.088),
  windowsMaterial(4, "RUBY",
    [0.1745, 0.01175, 0.01175], [0.61424, 0.04136, 0.04136],
    [0.727811, 0.626959, 0.626959], 0.6),
  windowsMaterial(5, "TURQUOISE",
    [0.1, 0.18725, 0.1745], [0.396, 0.74151, 0.69102],
    [0.297254, 0.30829, 0.306678], 0.1),
  windowsMaterial(6, "BRASS",
    [0.329412, 0.223529, 0.027451], [0.780392, 0.568627, 0.113725],
    [0.992157, 0.941176, 0.807843], 0.21794872),
  windowsMaterial(7, "BRONZE",
    [0.2125, 0.1275, 0.054], [0.714, 0.4284, 0.18144],
    [0.393548, 0.271906, 0.166721], 0.2),
  windowsMaterial(9, "COPPER",
    [0.19125, 0.0735, 0.0225], [0.7038, 0.27048, 0.0828],
    [0.256777, 0.137622, 0.086014], 0.1),
  windowsMaterial(10, "GOLD",
    [0.24725, 0.1995, 0.0745], [0.75164, 0.60648, 0.22648],
    [0.628281, 0.555802, 0.366065], 0.4),
  windowsMaterial(11, "SILVER",
    [0.19225, 0.19225, 0.19225], [0.50754, 0.50754, 0.50754],
    [0.508273, 0.508273, 0.508273], 0.4),
  windowsMaterial(13, "CYAN_PLASTIC",
    [0, 0.1, 0.06], [0, 0.50980392, 0.50980392],
    [0.50196078, 0.50196078, 0.50196078], 0.25),
  windowsMaterial(16, "WHITE_PLASTIC",
    [0, 0, 0], [0.55, 0.55, 0.55], [0.7, 0.7, 0.7], 0.25),
  windowsMaterial(17, "YELLOW_PLASTIC",
    [0, 0, 0], [0.5, 0.5, 0], [0.6, 0.6, 0.5], 0.25),
  windowsMaterial(19, "CYAN_RUBBER",
    [0, 0.05, 0.05], [0.4, 0.5, 0.5], [0.04, 0.7, 0.7], 0.078125),
  windowsMaterial(20, "GREEN_RUBBER",
    [0, 0.05, 0], [0.4, 0.5, 0.4], [0.04, 0.7, 0.04], 0.078125),
  windowsMaterial(22, "WHITE_RUBBER",
    [0.05, 0.05, 0.05], [0.5, 0.5, 0.5], [0.7, 0.7, 0.7], 0.078125),
]);

export const CSSPIPES_HISTORICAL_PALETTE = Object.freeze({
  schema: "csspipes-windows-good-materials@1",
  source: Object.freeze({
    title: "Microsoft Win95 SDK OpenGL 3D Pipes screen-saver sample",
    repository: "joncampbell123/windows_sdk_collection",
    commit: "e707dd87e84171c8e061c7ed6268eb3edaf85b49",
    path: "win/win95/sdk-1995-07-win32/win32sdk/mstools/samples/opengl/pipes/material.c",
    sha256: "e8b7559efd580cdf166ef2482877bd98dbd5bbdf808ee0a9fa45e5b92048148c",
    selectionLines: "31-34, 135-144",
    materialLines: "45-94",
  }),
  sourceColorSpace: "linear-light OpenGL ambient/diffuse/specular RGBA",
  outputColorSpace: "CSS sRGB",
  conversion: "IEC 61966-2-1 linear-to-sRGB transfer function",
  sourceSelection: Object.freeze({
    symbol: "goodMaterials",
    count: 16,
    expression: "teaMaterial[goodMaterials[mfRand(16)]]",
    replacement: true,
  }),
  materials: WINDOWS_GOOD_MATERIALS,
});

const historicalMaterial = (symbol) => {
  const material = WINDOWS_GOOD_MATERIALS.find((entry) => entry.symbol === symbol);
  if (!material) throw new Error(`Missing historical cssPipes material ${symbol}`);
  return material;
};

function authoredMaterial(symbol, ambient, diffuse, specular, shininess, cssSrgb, provenance) {
  if (sourceMaterialColor([...diffuse, 1]) !== cssSrgb) {
    throw new Error(`Authored cssPipes material ${symbol} does not match its linear diffuse color`);
  }
  return Object.freeze({
    sourceIndex: null,
    symbol,
    ambient: Object.freeze([...ambient, 1]),
    diffuse: Object.freeze([...diffuse, 1]),
    specular: Object.freeze([...specular, 1]),
    shininess,
    cssSrgb,
    provenance,
  });
}

const CSSPIPES_AMBER = authoredMaterial(
  "AMBER",
  [0, 0, 0],
  [0.715693501, 0.37123768, 0],
  [0.6, 0.6, 0.5],
  0.25,
  "#dca400",
  "authored-cssPipes-amber-with-yellow-plastic-response",
);

const CSSPIPES_SLATE = authoredMaterial(
  "SLATE",
  [0.03, 0.04, 0.05],
  [0.099898728, 0.124771818, 0.14995979],
  [0.50196078, 0.50196078, 0.50196078],
  0.25,
  "#59636c",
  "authored-cssPipes-cool-slate-with-plastic-response",
);

const CSSPIPES_PURPLE = Object.freeze({
  sourceIndex: null,
  symbol: "PURPLE",
  ambient: Object.freeze([0.1745, 0.0215, 0.1745, 1]),
  diffuse: Object.freeze([0.439657, 0.076185, 0.617207, 1]),
  specular: Object.freeze([0.68, 0.68, 0.68, 1]),
  shininess: 0.6,
  cssSrgb: "#b14ece",
  provenance: "authored-cssPipes-vivid-purple",
});

export const CSSPIPES_PRODUCT_MATERIALS = Object.freeze([
  historicalMaterial("EMERALD"),
  historicalMaterial("RUBY"),
  historicalMaterial("CYAN_PLASTIC"),
  CSSPIPES_AMBER,
  CSSPIPES_SLATE,
  historicalMaterial("PEARL"),
  CSSPIPES_PURPLE,
]);

export const CSSPIPES_PRODUCT_PALETTE = Object.freeze({
  schema: "csspipes-fixed-seven-color-product-palette@1",
  selection: "fixed-by-source-pipe-identity",
  historicalPalette: CSSPIPES_HISTORICAL_PALETTE,
  materials: CSSPIPES_PRODUCT_MATERIALS,
});

export const CSSPIPES_PALETTE = Object.freeze(
  CSSPIPES_PRODUCT_MATERIALS.map((material) => material.cssSrgb),
);

export const CSSPIPES_SOURCE_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
export const CSSPIPES_VIEWPORT_PROFILES = Object.freeze({
  desktop: Object.freeze({
    id: "desktop",
    seedCount: 32,
    quarterTurns: 0,
    rotationDegrees: 0,
    projectedViewport: CSSPIPES_SOURCE_VIEWPORT,
  }),
  mobile: Object.freeze({
    id: "mobile",
    seedCount: 32,
    quarterTurns: 1,
    rotationDegrees: 90,
    projectedViewport: Object.freeze({
      width: CSSPIPES_SOURCE_VIEWPORT.height,
      height: CSSPIPES_SOURCE_VIEWPORT.width,
    }),
  }),
});
export const CSSPIPES_CAMERA_CONTRACT = Object.freeze({
  projection: "perspective",
  perspective: 1400,
  rotX: 60,
  rotY: -38,
  distance: 0,
  safeTopGap: 0,
});

export const CSSPIPES_PREBAKE_CONFIG = Object.freeze({
  schema: "csspipes-prebake-contract@13",
  clipCount: 64,
  viewportSeedCountPerProfile: 32,
  preparedForwardChainChapterCount: 1,
  snakeFramesPerSeed: 462,
  preparedCameraAspectRatioMinimum: 1.1,
  preparedCameraAspectRatioMaximum: 2.5,
  preparedCameraOverscanMaximum: 1.8,
  preparedScreenGridColumns: 4,
  preparedScreenGridRows: 3,
  preparedScreenMinimumOccupiedCells: 10,
  preparedChainEndpointSafeMarginXRatio: 0.12,
  preparedChainEndpointSafeMarginYRatio: 0.08,
  preparedChainEndpointReturnSegments: 24,
  preparedBandSlotsByPipe: Object.freeze([47, 45, 47, 41, 45, 35, 49]),
  pipeCount: 7,
  segmentsPerPipe: 60,
  logicalSegmentCount: 420,
  stepLength: 1.25,
  tubeLength: 1,
  tubeRadius: 0.34,
  radialSegments: 7,
  radialSegmentsByPipe: Object.freeze([4, 4, 5, 5, 6, 6, 7]),
  radialSegmentsBySourcePipe: Object.freeze([6, 5, 6, 4, 4, 5, 7]),
  turnRadius: 0.46,
  jointSeamOverlap: 0,
  tubeEntryProgress: 0.04,
  growthWorldUnitsPerSecond: 9.375,
  pipeStaggerFrames: 0,
  sourceTicksPerSecond: 30,
  playbackFramesPerSecond: 60,
  frameMorphDurationMilliseconds: 16.666667,
  morphEasing: "linear",
  holdTicks: 30,
  fadeTicks: 24,
  straightWeight: 0.8,
});

if (CSSPIPES_PREBAKE_CONFIG.logicalSegmentCount !==
    CSSPIPES_PREBAKE_CONFIG.pipeCount * CSSPIPES_PREBAKE_CONFIG.segmentsPerPipe) {
  throw new Error("cssPipes logical segment count must be pipeCount x segmentsPerPipe");
}
if (CSSPIPES_PREBAKE_CONFIG.clipCount !==
    CSSPIPES_PREBAKE_CONFIG.viewportSeedCountPerProfile *
      Object.keys(CSSPIPES_VIEWPORT_PROFILES).length) {
  throw new Error("cssPipes clip count must split evenly across viewport seed profiles");
}

const CYLINDER_SURFACES = new Map(
  [...new Set(CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe)].map((radialSegments) => {
    const polygons = createPolyCylinder({
      radius: CSSPIPES_PREBAKE_CONFIG.tubeRadius,
      height: CSSPIPES_PREBAKE_CONFIG.tubeLength,
      radialSegments,
    }).polygons;
    const sides = Object.freeze(
      polygons.filter((polygon) => polygon.vertices.length === 4),
    );
    const caps = polygons.filter((polygon) => polygon.vertices.length === 3);
    const capPolygons = Object.freeze(["start", "tip"].map((cap) => {
      const isStart = cap === "start";
      const triangles = caps.slice(
        isStart ? 0 : radialSegments,
        isStart ? radialSegments : radialSegments * 2,
      );
      const vertices = triangles.map(
        (polygon) => polygon.vertices[isStart ? 2 : 1],
      );
      if (isStart) vertices.reverse();
      return Object.freeze({
        vertices: Object.freeze(vertices.map((vertex) => Object.freeze([...vertex]))),
        color: "#cccccc",
      });
    }));
    if (sides.length !== radialSegments || caps.length !== radialSegments * 2 ||
        capPolygons.some((polygon) => polygon.vertices.length !== radialSegments)) {
      throw new Error(`PolyCSS ${radialSegments}-facet cylinder surface contract drifted`);
    }
    return [radialSegments, Object.freeze({ sides, capPolygons })];
  }),
);

export const CSSPIPES_END_CAP_VERTICES_PER_END =
  CSSPIPES_PREBAKE_CONFIG.radialSegments;
export const CSSPIPES_END_CAP_LEAVES_PER_END = 1;
export const CSSPIPES_END_CAP_LEAVES_PER_PIPE =
  CSSPIPES_END_CAP_LEAVES_PER_END * 2;
export const CSSPIPES_END_CAP_TARGETS_PER_PIPE = 2;

export function preparedPipeLeafCount(
  bandSlotsPerPipe,
  radialSegments = CSSPIPES_PREBAKE_CONFIG.radialSegments,
) {
  if (!Number.isInteger(bandSlotsPerPipe) || bandSlotsPerPipe < 1) {
    throw new TypeError("cssPipes bandSlotsPerPipe must be a positive integer");
  }
  return bandSlotsPerPipe * radialSegments +
    CSSPIPES_END_CAP_TARGETS_PER_PIPE;
}

function canonicalBandFace(pipe, band, side, radialSegments, color, polygon) {
  const id = `csspipes-pipe-${String(pipe).padStart(2, "0")}-band-${String(band).padStart(3, "0")}-side-${String(side).padStart(2, "0")}`;
  const zOffset = (band + 0.5) * CSSPIPES_PREBAKE_CONFIG.tubeLength;
  return Object.freeze({
    id,
    polygon: Object.freeze({
      vertices: Object.freeze(polygon.vertices.map(([x, y, z]) =>
        Object.freeze([x, y, z + zOffset]))),
      color,
      data: Object.freeze({
        "csspipes-face": id,
        "csspipes-family": "tube",
        "csspipes-pipe": pipe,
        "csspipes-band": band,
        "csspipes-cylinder-side": side,
        "csspipes-surface": "wall",
        "csspipes-leaf-slot": band * radialSegments + side,
        "csspipes-seam-bleed": 0,
      }),
    }),
  });
}

function canonicalCapFace(pipe, cap, color, polygon) {
  const id = `csspipes-pipe-${String(pipe).padStart(2, "0")}-${cap}-cap`;
  const isStart = cap === "start";
  const zOffset = isStart ? 0.5 : -0.5;
  return Object.freeze({
    id,
    polygon: Object.freeze({
      vertices: Object.freeze(polygon.vertices.map(([x, y, z]) =>
        Object.freeze([x, y, z + zOffset]))),
      color,
      data: Object.freeze({
        "csspipes-face": id,
        "csspipes-family": "tube",
        "csspipes-pipe": pipe,
        "csspipes-cap": cap,
        "csspipes-cap-polygon": 0,
        "csspipes-surface": "end-cap",
        "csspipes-seam-bleed": 0,
      }),
    }),
  });
}

export function buildPreparedPipeMeshes(bandSlotsByPipe, pipeColors) {
  if (!Array.isArray(bandSlotsByPipe) ||
      bandSlotsByPipe.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      bandSlotsByPipe.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new TypeError("cssPipes bandSlotsByPipe must contain one positive integer per pipe");
  }
  if (!Array.isArray(pipeColors) ||
      pipeColors.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      pipeColors.some((color) => !/^#[0-9a-f]{6}$/iu.test(color))) {
    throw new TypeError("cssPipes pipeColors must contain one CSS hex color per pipe");
  }
  return Object.freeze(Array.from(
    { length: CSSPIPES_PREBAKE_CONFIG.pipeCount },
    (_, pipe) => {
      const color = pipeColors[pipe];
      const bandSlotsPerPipe = bandSlotsByPipe[pipe];
      const radialSegments = CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipe];
      const cylinder = CYLINDER_SURFACES.get(radialSegments);
      const polygons = [];
      for (let band = 0; band < bandSlotsPerPipe; band += 1) {
        for (let side = 0; side < cylinder.sides.length; side += 1) {
          polygons.push(canonicalBandFace(
            pipe,
            band,
            side,
            radialSegments,
            color,
            cylinder.sides[side],
          ));
        }
      }
      polygons.push(canonicalCapFace(pipe, "start", color, cylinder.capPolygons[0]));
      polygons.push(canonicalCapFace(pipe, "tip", color, cylinder.capPolygons[1]));
      return Object.freeze({
        id: `csspipes-pipe-${String(pipe).padStart(2, "0")}`,
        pipe,
        color,
        bandCount: bandSlotsPerPipe,
        radialSegments,
        endCapLeafCount: CSSPIPES_END_CAP_LEAVES_PER_PIPE,
        polygons: Object.freeze(polygons),
      });
    },
  ));
}
