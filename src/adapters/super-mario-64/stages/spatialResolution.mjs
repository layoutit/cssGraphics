import { titleHeadContentHash } from "./contract.mjs";

export const TITLE_HEAD_LIGHTING_STATE_FIELD_SCHEMA =
  "cssgraphics-title-head-lighting-state-field@1";
const TITLE_HEAD_SPATIAL_RESOLUTION_SCHEMA =
  "cssgraphics-title-head-spatial-resolution@1";
const TITLE_HEAD_ALPHA_POLICY_BOX =
  "supersampled-box-coverage";
export const TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE =
  "supersampled-shared-edge-conservative";

export const TITLE_HEAD_LIGHTING_FIELD_SIZE = 4;
export const TITLE_HEAD_LIGHTING_NODE_BYTES =
  TITLE_HEAD_LIGHTING_FIELD_SIZE * TITLE_HEAD_LIGHTING_FIELD_SIZE * 3;
const TITLE_HEAD_SPATIAL_DECODED_BUDGET_BYTES = 128 * 1024 * 1024;

const ALPHA_SUPERSAMPLES = 4;
const TILE_GUTTER = 1;
const PAGE_LIMIT = 4096;
const MAX_STATE_COLUMNS = 41;

function fail(message) {
  throw new Error(`Title-head spatial resolution: ${message}`);
}

function percentile(histogram, fraction) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const target = Math.max(1, Math.ceil(total * fraction));
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return histogram.length - 1;
}

function barycentricWeights(x, y, width, height) {
  const top = (height - y) / height;
  const right = (x - width / 2 * top) / width;
  return [top, 1 - top - right, right];
}

const alphaCache = new Map();

function canonicalEdgeIndexAt(x, y, width, height) {
  const [apex, left, right] = barycentricWeights(x, y, width, height);
  const oppositeWeights = [right, apex, left];
  let edgeIndex = 0;
  for (let index = 1; index < oppositeWeights.length; index += 1) {
    if (oppositeWeights[index] < oppositeWeights[edgeIndex]) edgeIndex = index;
  }
  return edgeIndex;
}

function titleHeadSurfaceAlpha(
  width,
  height,
  alphaPolicy = TITLE_HEAD_ALPHA_POLICY_BOX,
  canonicalSeamEdgeMask = 0,
  canonicalBoundaryEdgeMask = 0,
  boundaryCoverageThreshold = 0,
) {
  if (alphaPolicy !== TITLE_HEAD_ALPHA_POLICY_BOX
    && alphaPolicy !== TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE) {
    fail(`invalid alpha policy ${alphaPolicy}`);
  }
  if (!Number.isSafeInteger(canonicalSeamEdgeMask)
    || canonicalSeamEdgeMask < 0
    || canonicalSeamEdgeMask > 7) {
    fail(`invalid canonical seam edge mask ${canonicalSeamEdgeMask}`);
  }
  if (!Number.isSafeInteger(canonicalBoundaryEdgeMask)
    || canonicalBoundaryEdgeMask < 0
    || canonicalBoundaryEdgeMask > 7
    || !Number.isSafeInteger(boundaryCoverageThreshold)
    || boundaryCoverageThreshold < 0
    || boundaryCoverageThreshold > ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES) {
    fail("invalid boundary alpha policy");
  }
  const key = `${width}x${height}:${alphaPolicy}:${canonicalSeamEdgeMask}`
    + `:${canonicalBoundaryEdgeMask}:${boundaryCoverageThreshold}`;
  const retained = alphaCache.get(key);
  if (retained) return retained;
  if (!Number.isSafeInteger(width) || width < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(height) || height < TITLE_HEAD_LIGHTING_FIELD_SIZE) {
    fail(`invalid triangle raster ${width}x${height}`);
  }
  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (let sampleY = 0; sampleY < ALPHA_SUPERSAMPLES; sampleY += 1) {
        for (let sampleX = 0; sampleX < ALPHA_SUPERSAMPLES; sampleX += 1) {
          const weights = barycentricWeights(
            x + (sampleX + 0.5) / ALPHA_SUPERSAMPLES,
            y + (sampleY + 0.5) / ALPHA_SUPERSAMPLES,
            width,
            height,
          );
          if (weights.every((weight) => weight >= 0 && weight <= 1)) covered += 1;
        }
      }
      let pixelAlpha = Math.round(
        covered / (ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES) * 255,
      );
      if (alphaPolicy === TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE
        && covered > 0
        && covered < ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES) {
        const edgeIndex = canonicalEdgeIndexAt(
          x + 0.5,
          y + 0.5,
          width,
          height,
        );
        if ((canonicalSeamEdgeMask & (1 << edgeIndex)) !== 0) {
          // Max-pool the high-resolution binary coverage only on a
          // topologically shared edge. This is the coverage-preserving
          // downsample: silhouettes retain ordinary box-filter antialiasing.
          pixelAlpha = 255;
        } else if (boundaryCoverageThreshold > 0
          && (canonicalBoundaryEdgeMask & (1 << edgeIndex)) !== 0) {
          // Quantize every selected edge from the same 4x4 coverage samples
          // before CSS bilinear sampling.
          pixelAlpha = covered >= boundaryCoverageThreshold ? 255 : 0;
        }
      }
      alpha[y * width + x] = pixelAlpha;
    }
  }
  alphaCache.set(key, alpha);
  return alpha;
}

function writeTitleHeadLightingStateTile({
  target,
  targetWidth,
  originX,
  originY,
  width,
  height,
  stateNodes,
  nodeOffset,
  alphaPolicy = TITLE_HEAD_ALPHA_POLICY_BOX,
  canonicalSeamEdgeMask = 0,
  canonicalBoundaryEdgeMask = 0,
  boundaryCoverageThreshold = 0,
}) {
  if (!Buffer.isBuffer(target) || !Buffer.isBuffer(stateNodes)
    || nodeOffset < 0
    || nodeOffset + TITLE_HEAD_LIGHTING_NODE_BYTES > stateNodes.length) {
    fail("lighting state tile has incomplete pixel inputs");
  }
  const alpha = titleHeadSurfaceAlpha(
    width,
    height,
    alphaPolicy,
    canonicalSeamEdgeMask,
    canonicalBoundaryEdgeMask,
    boundaryCoverageThreshold,
  );
  for (let y = 0; y < height; y += 1) {
    const sourceY = y * (TITLE_HEAD_LIGHTING_FIELD_SIZE - 1) / (height - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(TITLE_HEAD_LIGHTING_FIELD_SIZE - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const pixelAlpha = alpha[y * width + x];
      const targetOffset = ((originY + y) * targetWidth + originX + x) * 4;
      if (pixelAlpha !== 0) {
        const sourceX = x * (TITLE_HEAD_LIGHTING_FIELD_SIZE - 1) / (width - 1);
        const x0 = Math.floor(sourceX);
        const x1 = Math.min(TITLE_HEAD_LIGHTING_FIELD_SIZE - 1, x0 + 1);
        const xWeight = sourceX - x0;
        for (let channel = 0; channel < 3; channel += 1) {
          const top = stateNodes[
            nodeOffset + (y0 * TITLE_HEAD_LIGHTING_FIELD_SIZE + x0) * 3 + channel
          ] * (1 - xWeight)
            + stateNodes[
              nodeOffset + (y0 * TITLE_HEAD_LIGHTING_FIELD_SIZE + x1) * 3 + channel
            ] * xWeight;
          const bottom = stateNodes[
            nodeOffset + (y1 * TITLE_HEAD_LIGHTING_FIELD_SIZE + x0) * 3 + channel
          ] * (1 - xWeight)
            + stateNodes[
              nodeOffset + (y1 * TITLE_HEAD_LIGHTING_FIELD_SIZE + x1) * 3 + channel
            ] * xWeight;
          target[targetOffset + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
        }
      }
      target[targetOffset + 3] = pixelAlpha;
    }
  }
}

function renderedStateTile(
  stateNodes,
  nodeOffset,
  width,
  height,
  alphaPolicy = TITLE_HEAD_ALPHA_POLICY_BOX,
  canonicalSeamEdgeMask = 0,
  canonicalBoundaryEdgeMask = 0,
  boundaryCoverageThreshold = 0,
) {
  const pixels = Buffer.alloc(width * height * 4);
  writeTitleHeadLightingStateTile({
    target: pixels,
    targetWidth: width,
    originX: 0,
    originY: 0,
    width,
    height,
    stateNodes,
    nodeOffset,
    alphaPolicy,
    canonicalSeamEdgeMask,
    canonicalBoundaryEdgeMask,
    boundaryCoverageThreshold,
  });
  return pixels;
}

const resamplePlanCache = new Map();

function resamplePlan(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const key = `${sourceWidth}x${sourceHeight}:${targetWidth}x${targetHeight}`;
  const retained = resamplePlanCache.get(key);
  if (retained) return retained;
  const x0 = new Int16Array(targetWidth);
  const x1 = new Int16Array(targetWidth);
  const xWeight = new Float64Array(targetWidth);
  const y0 = new Int16Array(targetHeight);
  const y1 = new Int16Array(targetHeight);
  const yWeight = new Float64Array(targetHeight);
  for (let x = 0; x < targetWidth; x += 1) {
    const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5;
    x0[x] = Math.floor(sourceX);
    x1[x] = x0[x] + 1;
    xWeight[x] = sourceX - x0[x];
  }
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * sourceHeight / targetHeight - 0.5;
    y0[y] = Math.floor(sourceY);
    y1[y] = y0[y] + 1;
    yWeight[y] = sourceY - y0[y];
  }
  const plan = Object.freeze({ x0, x1, xWeight, y0, y1, yWeight });
  resamplePlanCache.set(key, plan);
  return plan;
}

function sampleByte(source, width, height, x, y, channel) {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;
  return source[(y * width + x) * 4 + channel];
}

function sampleAlpha(source, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;
  return source[y * width + x];
}

function resampleRgba(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return Buffer.from(source);
  }
  const plan = resamplePlan(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const fy = plan.yWeight[y];
    for (let x = 0; x < targetWidth; x += 1) {
      const fx = plan.xWeight[x];
      const targetOffset = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = sampleByte(
          source,
          sourceWidth,
          sourceHeight,
          plan.x0[x],
          plan.y0[y],
          channel,
        ) * (1 - fx)
          + sampleByte(
            source,
            sourceWidth,
            sourceHeight,
            plan.x1[x],
            plan.y0[y],
            channel,
          ) * fx;
        const bottom = sampleByte(
          source,
          sourceWidth,
          sourceHeight,
          plan.x0[x],
          plan.y1[y],
          channel,
        ) * (1 - fx)
          + sampleByte(
            source,
            sourceWidth,
            sourceHeight,
            plan.x1[x],
            plan.y1[y],
            channel,
          ) * fx;
        output[targetOffset + channel] = Math.max(
          0,
          Math.min(255, Math.round(top * (1 - fy) + bottom * fy)),
        );
      }
    }
  }
  return output;
}

function resampleAlpha(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return Buffer.from(source);
  }
  const plan = resamplePlan(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const output = Buffer.alloc(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const fy = plan.yWeight[y];
    for (let x = 0; x < targetWidth; x += 1) {
      const fx = plan.xWeight[x];
      const top = sampleAlpha(
        source,
        sourceWidth,
        sourceHeight,
        plan.x0[x],
        plan.y0[y],
      ) * (1 - fx)
        + sampleAlpha(
          source,
          sourceWidth,
          sourceHeight,
          plan.x1[x],
          plan.y0[y],
        ) * fx;
      const bottom = sampleAlpha(
        source,
        sourceWidth,
        sourceHeight,
        plan.x0[x],
        plan.y1[y],
      ) * (1 - fx)
        + sampleAlpha(
          source,
          sourceWidth,
          sourceHeight,
          plan.x1[x],
          plan.y1[y],
        ) * fx;
      output[y * targetWidth + x] = Math.max(
        0,
        Math.min(255, Math.round(top * (1 - fy) + bottom * fy)),
      );
    }
  }
  return output;
}

function conservativeTransformStretch(size, sampling) {
  const x = sampling.maximumAxisStretchX
    * sampling.referenceWidth / size.width;
  const y = sampling.maximumAxisStretchY
    * sampling.referenceHeight / size.height;
  const aa = x * x;
  const bb = y * y;
  const ab = x * y * sampling.maximumShearCosine;
  return Math.sqrt(
    (aa + bb + Math.sqrt((aa - bb) ** 2 + 4 * ab * ab)) / 2,
  );
}

function titleHeadLeafTransformStretch(size, sampling) {
  const x = sampling.maximumAxisStretchX
    * sampling.referenceLeafWidth / size.width;
  const y = sampling.maximumAxisStretchY
    * sampling.referenceLeafHeight / size.height;
  const aa = x * x;
  const bb = y * y;
  const ab = x * y * sampling.maximumShearCosine;
  return Math.sqrt(
    (aa + bb + Math.sqrt((aa - bb) ** 2 + 4 * ab * ab)) / 2,
  );
}

export function selectTitleHeadLeafRasterSize({
  minimumWidth,
  minimumHeight,
  preferredMaximumWidth,
  preferredMaximumHeight,
  sampling,
  maximumTransformStretch = 1,
}) {
  if (!Number.isSafeInteger(minimumWidth) || minimumWidth < 1
    || !Number.isSafeInteger(minimumHeight) || minimumHeight < 1
    || !Number.isSafeInteger(preferredMaximumWidth)
    || preferredMaximumWidth < minimumWidth
    || !Number.isSafeInteger(preferredMaximumHeight)
    || preferredMaximumHeight < minimumHeight
    || !Number.isSafeInteger(sampling?.referenceLeafWidth)
    || sampling.referenceLeafWidth < 1
    || !Number.isSafeInteger(sampling?.referenceLeafHeight)
    || sampling.referenceLeafHeight < 1
    || !Number.isFinite(sampling?.maximumAxisStretchX)
    || sampling.maximumAxisStretchX < 0
    || !Number.isFinite(sampling?.maximumAxisStretchY)
    || sampling.maximumAxisStretchY < 0
    || !Number.isFinite(sampling?.maximumShearCosine)
    || sampling.maximumShearCosine < 0
    || sampling.maximumShearCosine > 1.000001
    || !Number.isFinite(maximumTransformStretch)
    || maximumTransformStretch < 1) {
    fail("invalid transform-conditioned CSS leaf raster inputs");
  }
  const solve = (maximumWidth, maximumHeight) => {
    let best = null;
    for (let width = minimumWidth; width <= maximumWidth; width += 1) {
      let low = minimumHeight;
      let high = maximumHeight;
      let height = -1;
      while (low <= high) {
        const middle = low + Math.floor((high - low) / 2);
        if (titleHeadLeafTransformStretch(
          { width, height: middle },
          sampling,
        ) <= maximumTransformStretch) {
          height = middle;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      if (height === -1) continue;
      const stretch = titleHeadLeafTransformStretch(
        { width, height },
        sampling,
      );
      const area = width * height;
      if (best === null
        || area < best.area
        || (area === best.area && stretch < best.maximumTransformStretch)
        || (area === best.area
          && stretch === best.maximumTransformStretch
          && width < best.width)) {
        best = Object.freeze({
          width,
          height,
          area,
          maximumTransformStretch: stretch,
        });
      }
    }
    return best;
  };
  const preferred = solve(
    preferredMaximumWidth,
    preferredMaximumHeight,
  );
  if (preferred !== null) return preferred;
  const maximumWidth = Math.max(
    preferredMaximumWidth,
    Math.ceil(
      sampling.maximumAxisStretchX
      * sampling.referenceLeafWidth
      * Math.SQRT2
      / maximumTransformStretch,
    ),
  );
  const maximumHeight = Math.max(
    preferredMaximumHeight,
    Math.ceil(
      sampling.maximumAxisStretchY
      * sampling.referenceLeafHeight
      * Math.SQRT2
      / maximumTransformStretch,
    ),
  );
  const unbounded = solve(maximumWidth, maximumHeight);
  if (unbounded === null) {
    fail("no transform-conditioned CSS leaf raster satisfies the target");
  }
  return unbounded;
}

function minimumSizeForTransformThreshold(
  footprint,
  stateCount,
  sampling,
  maximumTransformStretch,
) {
  const minimumWidth = sampling.referenceWidth;
  const minimumHeight = sampling.referenceHeight;
  const maximumWidth = Math.max(
    minimumWidth,
    Math.ceil(
      sampling.maximumAxisStretchX
      * sampling.referenceWidth
      * Math.SQRT2
      / maximumTransformStretch,
    ),
  );
  const maximumHeight = Math.max(
    minimumHeight,
    Math.ceil(
      sampling.maximumAxisStretchY
      * sampling.referenceHeight
      * Math.SQRT2
      / maximumTransformStretch,
    ),
  );
  let best = null;
  for (let width = minimumWidth; width <= maximumWidth; width += 1) {
    let low = minimumHeight;
    let high = maximumHeight;
    let height = -1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const stretch = conservativeTransformStretch(
        { width, height: middle },
        sampling,
      );
      if (stretch <= maximumTransformStretch) {
        height = middle;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    if (height === -1) continue;
    const size = Object.freeze({ width, height });
    const block = blockDimensions(stateCount, size);
    if (block === null) continue;
    const blockPixels = block.width * block.height;
    const stretch = conservativeTransformStretch(size, sampling);
    if (best === null
      || blockPixels < best.blockPixels
      || (blockPixels === best.blockPixels && stretch < best.stretch)
      || (blockPixels === best.blockPixels
        && stretch === best.stretch
        && width * height < best.width * best.height)) {
      best = Object.freeze({ width, height, blockPixels, stretch });
    }
  }
  return best;
}

function transformConditionedCandidateSizes(footprint, stateCount, sampling) {
  const unique = new Map();
  const retain = (size) => {
    unique.set(`${size.width}x${size.height}`, Object.freeze({
      width: size.width,
      height: size.height,
    }));
  };
  retain({
    width: sampling.referenceWidth,
    height: sampling.referenceHeight,
  });
  retain(footprint);
  const baselineStretch = conservativeTransformStretch(
    {
      width: sampling.referenceWidth,
      height: sampling.referenceHeight,
    },
    sampling,
  );
  const steps = Math.max(0, Math.ceil((baselineStretch - 1) * 20));
  for (let step = 0; step <= steps; step += 1) {
    const threshold = Math.max(1, baselineStretch - step / 20);
    const size = minimumSizeForTransformThreshold(
      footprint,
      stateCount,
      sampling,
      threshold,
    );
    if (size !== null) retain(size);
  }
  const exact = minimumSizeForTransformThreshold(
    footprint,
    stateCount,
    sampling,
    1,
  );
  if (exact !== null) retain(exact);
  return [...unique.values()];
}

function proportionalCandidateSizes(footprint) {
  const maximum = Math.max(footprint.width, footprint.height);
  const unique = new Map();
  for (let targetMaximum = TITLE_HEAD_LIGHTING_FIELD_SIZE;
    targetMaximum <= maximum;
    targetMaximum += 1) {
    const scale = targetMaximum / maximum;
    const width = Math.min(
      footprint.width,
      Math.max(
        TITLE_HEAD_LIGHTING_FIELD_SIZE,
        Math.ceil(footprint.width * scale),
      ),
    );
    const height = Math.min(
      footprint.height,
      Math.max(
        TITLE_HEAD_LIGHTING_FIELD_SIZE,
        Math.ceil(footprint.height * scale),
      ),
    );
    unique.set(`${width}x${height}`, Object.freeze({ width, height }));
  }
  unique.set(
    `${footprint.width}x${footprint.height}`,
    Object.freeze({ width: footprint.width, height: footprint.height }),
  );
  return [...unique.values()];
}

const basisNodes = Object.freeze(Array.from(
  { length: TITLE_HEAD_LIGHTING_FIELD_SIZE * TITLE_HEAD_LIGHTING_FIELD_SIZE },
  (_, activeNode) => {
    const nodes = Buffer.alloc(TITLE_HEAD_LIGHTING_NODE_BYTES);
    for (let channel = 0; channel < 3; channel += 1) {
      nodes[activeNode * 3 + channel] = 255;
    }
    return nodes;
  },
));
const basisReferenceCache = new Map();
const basisMaximumCache = new Map();

function basisReference(footprint) {
  const key = `${footprint.width}x${footprint.height}`;
  const retained = basisReferenceCache.get(key);
  if (retained) return retained;
  const pixels = basisNodes.map((nodes) => {
    const rgba = renderedStateTile(nodes, 0, footprint.width, footprint.height);
    const premultiplied = Buffer.alloc(footprint.width * footprint.height);
    for (let index = 0; index < premultiplied.length; index += 1) {
      const offset = index * 4;
      premultiplied[index] = premultipliedByte(rgba[offset], rgba[offset + 3]);
    }
    return premultiplied;
  });
  const reference = Object.freeze(pixels);
  basisReferenceCache.set(key, reference);
  return reference;
}

function maximumBasisReconstructionError(
  footprint,
  size,
  alphaPolicy,
  canonicalSeamEdgeMask,
) {
  const key = `${footprint.width}x${footprint.height}:${size.width}x${size.height}`
    + `:${alphaPolicy}:${canonicalSeamEdgeMask}`;
  const retained = basisMaximumCache.get(key);
  if (retained !== undefined) return retained;
  if (footprint.width === size.width
    && footprint.height === size.height
    && (alphaPolicy === TITLE_HEAD_ALPHA_POLICY_BOX
      || canonicalSeamEdgeMask === 0)) {
    basisMaximumCache.set(key, 0);
    return 0;
  }
  const references = basisReference(footprint);
  const positive = new Int16Array(footprint.width * footprint.height);
  const negative = new Int16Array(footprint.width * footprint.height);
  for (let basisIndex = 0; basisIndex < basisNodes.length; basisIndex += 1) {
    const candidate = renderedStateTile(
      basisNodes[basisIndex],
      0,
      size.width,
      size.height,
      alphaPolicy,
      canonicalSeamEdgeMask,
    );
    const reconstructed = resampleRgba(
      candidate,
      size.width,
      size.height,
      footprint.width,
      footprint.height,
    );
    const reference = references[basisIndex];
    for (let pixelIndex = 0; pixelIndex < reference.length; pixelIndex += 1) {
      const offset = pixelIndex * 4;
      const actual = premultipliedByte(
        reconstructed[offset],
        reconstructed[offset + 3],
      );
      const difference = reference[pixelIndex] - actual;
      if (difference > 0) positive[pixelIndex] += difference;
      else negative[pixelIndex] -= difference;
    }
  }
  let maximum = 0;
  for (let pixelIndex = 0; pixelIndex < positive.length; pixelIndex += 1) {
    maximum = Math.max(maximum, positive[pixelIndex], negative[pixelIndex]);
  }
  basisMaximumCache.set(key, maximum);
  return maximum;
}

function blockDimensions(stateCount, size) {
  for (let columns = Math.min(MAX_STATE_COLUMNS, stateCount);
    columns >= 1;
    columns -= 1) {
    const rows = Math.ceil(stateCount / columns);
    const width = columns * (size.width + TILE_GUTTER) + TILE_GUTTER;
    const height = rows * (size.height + TILE_GUTTER) + TILE_GUTTER;
    if (width <= PAGE_LIMIT && height <= PAGE_LIMIT) {
      return Object.freeze({ columns, rows, width, height });
    }
  }
  return null;
}

function isAlphaEdgePixel(alpha, width, height, x, y) {
  const value = alpha[y * width + x];
  if (value === 0) return false;
  if (value < 255) return true;
  return (
    sampleAlpha(alpha, width, height, x - 1, y) < 255
    || sampleAlpha(alpha, width, height, x + 1, y) < 255
    || sampleAlpha(alpha, width, height, x, y - 1) < 255
    || sampleAlpha(alpha, width, height, x, y + 1) < 255
  );
}

function candidateMetric(
  footprint,
  size,
  stateCount,
  visibleFrames,
  transformSampling,
  alphaPolicy,
  canonicalSeamEdgeMask,
) {
  const block = blockDimensions(stateCount, size);
  if (block === null) return null;
  const maximumTransformStretch = conservativeTransformStretch(
    size,
    transformSampling,
  );
  if (size.width >= transformSampling.referenceWidth
    && size.height >= transformSampling.referenceHeight) {
    return Object.freeze({
      ...size,
      blockPixels: block.width * block.height,
      squaredAlphaError: 0,
      weightedSquaredAlphaError: 0,
      weightedObjectiveError: 0,
      absoluteAlphaError: 0,
      maximumAlphaError: transformSampling.maximumReconstructionError,
      edgePixelCount: 0,
      squaredEdgeAlphaDeficit: 0,
      absoluteEdgeAlphaDeficit: 0,
      maximumEdgeAlphaDeficit: transformSampling.maximumEdgeAlphaDeficit,
      maximumBasisError: transformSampling.maximumReconstructionError,
      maximumReconstructionError:
        transformSampling.maximumReconstructionError,
      lostCoveragePixels: 0,
      canonicalSeamEdgeMask,
      maximumTransformStretch,
      weightedTransformStretch: maximumTransformStretch * visibleFrames,
    });
  }
  const reference = titleHeadSurfaceAlpha(footprint.width, footprint.height);
  const candidate = resampleAlpha(
    titleHeadSurfaceAlpha(
      size.width,
      size.height,
      alphaPolicy,
      canonicalSeamEdgeMask,
    ),
    size.width,
    size.height,
    footprint.width,
    footprint.height,
  );
  let squaredAlphaError = 0;
  let absoluteAlphaError = 0;
  let maximumAlphaError = 0;
  let lostCoveragePixels = 0;
  let edgePixelCount = 0;
  let squaredEdgeAlphaDeficit = 0;
  let absoluteEdgeAlphaDeficit = 0;
  let maximumEdgeAlphaDeficit = 0;
  for (let y = 0; y < footprint.height; y += 1) {
    for (let x = 0; x < footprint.width; x += 1) {
      const index = y * footprint.width + x;
      const error = Math.abs(reference[index] - candidate[index]);
      squaredAlphaError += error * error;
      absoluteAlphaError += error;
      maximumAlphaError = Math.max(maximumAlphaError, error);
      if (reference[index] > 0 && candidate[index] === 0) lostCoveragePixels += 1;
      if (isAlphaEdgePixel(reference, footprint.width, footprint.height, x, y)) {
        const deficit = Math.max(0, reference[index] - candidate[index]);
        edgePixelCount += 1;
        squaredEdgeAlphaDeficit += deficit * deficit;
        absoluteEdgeAlphaDeficit += deficit;
        maximumEdgeAlphaDeficit = Math.max(maximumEdgeAlphaDeficit, deficit);
      }
    }
  }
  const maximumBasisError = maximumBasisReconstructionError(
    footprint,
    size,
    alphaPolicy,
    canonicalSeamEdgeMask,
  );
  const meanSquaredAlphaError = squaredAlphaError / reference.length;
  const meanSquaredEdgeAlphaDeficit = edgePixelCount === 0
    ? 0
    : squaredEdgeAlphaDeficit / edgePixelCount;
  return Object.freeze({
    ...size,
    blockPixels: block.width * block.height,
    squaredAlphaError,
    weightedSquaredAlphaError: squaredAlphaError * visibleFrames,
    weightedObjectiveError: (
      meanSquaredAlphaError + meanSquaredEdgeAlphaDeficit
    ) * visibleFrames,
    absoluteAlphaError,
    maximumAlphaError,
    edgePixelCount,
    squaredEdgeAlphaDeficit,
    absoluteEdgeAlphaDeficit,
    maximumEdgeAlphaDeficit,
    maximumBasisError,
    maximumReconstructionError: Math.max(maximumAlphaError, maximumBasisError),
    lostCoveragePixels,
    canonicalSeamEdgeMask,
    maximumTransformStretch,
    weightedTransformStretch: maximumTransformStretch * visibleFrames,
  });
}

export function measureTitleHeadSpatialReconstruction({
  footprint,
  width,
  height,
} = {}) {
  if (!footprint
    || !Number.isSafeInteger(footprint.width)
    || footprint.width < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(footprint.height)
    || footprint.height < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(width)
    || width < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(height)
    || height < TITLE_HEAD_LIGHTING_FIELD_SIZE) {
    fail("spatial reconstruction measurement inputs are incomplete");
  }
  const metric = candidateMetric(
    footprint,
    Object.freeze({ width, height }),
    1,
    1,
    Object.freeze({
      referenceWidth: width + 1,
      referenceHeight: height + 1,
      maximumAxisStretchX: 1,
      maximumAxisStretchY: 1,
      maximumShearCosine: 0,
      maximumReconstructionError: 0,
      maximumEdgeAlphaDeficit: 0,
    }),
    TITLE_HEAD_ALPHA_POLICY_BOX,
    0,
  );
  if (metric === null) {
    fail("spatial reconstruction measurement could not fit one state");
  }
  return Object.freeze({
    maximumReconstructionError: metric.maximumReconstructionError,
    maximumEdgeAlphaDeficit: metric.maximumEdgeAlphaDeficit,
  });
}

function paretoCandidates(
  footprint,
  stateCount,
  visibleFrames,
  transformSampling,
  alphaPolicy,
  canonicalSeamEdgeMask,
) {
  const candidates = transformConditionedCandidateSizes(
    footprint,
    stateCount,
    transformSampling,
  ).map((size) => (
    candidateMetric(
      footprint,
      size,
      stateCount,
      visibleFrames,
      transformSampling,
      alphaPolicy,
      canonicalSeamEdgeMask,
    )
  )).filter(Boolean).sort((left, right) => (
    left.blockPixels - right.blockPixels
    || left.maximumTransformStretch - right.maximumTransformStretch
    || left.width * left.height - right.width * right.height
    || left.width - right.width
    || left.height - right.height
  ));
  const retained = [];
  let bestStretch = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.maximumTransformStretch >= bestStretch) continue;
    retained.push(candidate);
    bestStretch = candidate.maximumTransformStretch;
  }
  return Object.freeze(retained);
}

function canonicalCandidates(footprint, stateCount, visibleFrames) {
  const measurementSampling = Object.freeze({
    referenceWidth: footprint.width + 1,
    referenceHeight: footprint.height + 1,
    maximumAxisStretchX: 0,
    maximumAxisStretchY: 0,
    maximumShearCosine: 0,
    maximumReconstructionError: 0,
    maximumEdgeAlphaDeficit: 0,
  });
  return Object.freeze(proportionalCandidateSizes(footprint).map((size) => (
    candidateMetric(
      footprint,
      size,
      stateCount,
      visibleFrames,
      measurementSampling,
      TITLE_HEAD_ALPHA_POLICY_BOX,
      0,
    )
  )).filter(Boolean));
}

class MaxHeap {
  #values = [];

  static #better(left, right) {
    if (left.ratio !== right.ratio) return left.ratio > right.ratio;
    if (left.benefit !== right.benefit) return left.benefit > right.benefit;
    if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder < right.sourceOrder;
    return left.toIndex < right.toIndex;
  }

  push(value) {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!MaxHeap.#better(this.#values[index], this.#values[parent])) break;
      [this.#values[index], this.#values[parent]] = [
        this.#values[parent],
        this.#values[index],
      ];
      index = parent;
    }
  }

  pop() {
    if (this.#values.length === 0) return null;
    const first = this.#values[0];
    const last = this.#values.pop();
    if (this.#values.length > 0) {
      this.#values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.#values.length
          && MaxHeap.#better(this.#values[left], this.#values[best])) best = left;
        if (right < this.#values.length
          && MaxHeap.#better(this.#values[right], this.#values[best])) best = right;
        if (best === index) break;
        [this.#values[index], this.#values[best]] = [
          this.#values[best],
          this.#values[index],
        ];
        index = best;
      }
    }
    return first;
  }
}

function nextUpgrade(
  faceIndex,
  candidates,
  fromIndex,
  objectiveField = "weightedTransformStretch",
) {
  const from = candidates[fromIndex];
  let toIndex = fromIndex + 1;
  while (toIndex < candidates.length
    && (candidates[toIndex][objectiveField]
      >= from[objectiveField]
      || candidates[toIndex].maximumReconstructionError
        > from.maximumReconstructionError)) {
    toIndex += 1;
  }
  if (toIndex >= candidates.length) return null;
  const to = candidates[toIndex];
  const cost = to.blockPixels - from.blockPixels;
  const benefit = from[objectiveField] - to[objectiveField];
  if (cost <= 0 || benefit <= 0) return null;
  return Object.freeze({
    faceIndex,
    sourceOrder: faceIndex,
    fromIndex,
    toIndex,
    cost,
    benefit,
    ratio: benefit / cost,
  });
}

function upgradeSequence(
  candidateSets,
  initialSelected,
  objectiveField = "weightedTransformStretch",
) {
  const heap = new MaxHeap();
  for (let faceIndex = 0; faceIndex < candidateSets.length; faceIndex += 1) {
    const upgrade = nextUpgrade(
      faceIndex,
      candidateSets[faceIndex],
      initialSelected[faceIndex],
      objectiveField,
    );
    if (upgrade) heap.push(upgrade);
  }
  const selected = Uint16Array.from(initialSelected);
  const upgrades = [];
  while (true) {
    const upgrade = heap.pop();
    if (!upgrade) break;
    if (selected[upgrade.faceIndex] !== upgrade.fromIndex) {
      fail(`face ${upgrade.faceIndex} spatial upgrade order drifted`);
    }
    selected[upgrade.faceIndex] = upgrade.toIndex;
    upgrades.push(upgrade);
    const next = nextUpgrade(
      upgrade.faceIndex,
      candidateSets[upgrade.faceIndex],
      upgrade.toIndex,
      objectiveField,
    );
    if (next) heap.push(next);
  }
  return Object.freeze(upgrades);
}

function selectedIndicesAtPrefix(initialSelected, upgrades, prefix) {
  const selected = Uint16Array.from(initialSelected);
  for (let index = 0; index < prefix; index += 1) {
    const upgrade = upgrades[index];
    selected[upgrade.faceIndex] = upgrade.toIndex;
  }
  return selected;
}

function measurePackedPages(plans, candidateSets, selectedIndices) {
  const blocks = plans.map((plan, faceIndex) => {
    const size = candidateSets[faceIndex][selectedIndices[faceIndex]];
    const dimensions = blockDimensions(plan.states.length, size);
    return {
      sourceOrder: faceIndex,
      width: dimensions.width,
      height: dimensions.height,
    };
  }).sort((left, right) => (
    right.height - left.height
    || right.width - left.width
    || left.sourceOrder - right.sourceOrder
  ));
  const pages = [];
  const place = (page, block) => {
    for (const shelf of page.shelves) {
      if (block.height <= shelf.height && shelf.x + block.width <= PAGE_LIMIT) {
        shelf.x += block.width;
        page.width = Math.max(page.width, shelf.x);
        return true;
      }
    }
    if (page.height + block.height > PAGE_LIMIT) return false;
    page.shelves.push({ x: block.width, height: block.height });
    page.height += block.height;
    page.width = Math.max(page.width, block.width);
    return true;
  };
  for (const block of blocks) {
    let placed = pages.some((page) => place(page, block));
    if (!placed) {
      const page = { shelves: [], width: 0, height: 0 };
      pages.push(page);
      placed = place(page, block);
    }
    if (!placed) fail(`face ${block.sourceOrder} cannot fit a spatial candidate page`);
  }
  const pageSizes = pages.map((page) => Object.freeze({
    width: page.width,
    height: page.height,
    decodedBytes: page.width * page.height * 4,
  }));
  return Object.freeze({
    pages: Object.freeze(pageSizes),
    decodedBytes: pageSizes.reduce((total, page) => total + page.decodedBytes, 0),
  });
}

function selectedPrefix(
  plans,
  candidateSets,
  initialSelected,
  upgrades,
  decodedBudgetBytes,
) {
  const measure = (prefix) => {
    const selected = selectedIndicesAtPrefix(initialSelected, upgrades, prefix);
    return Object.freeze({
      prefix,
      selected,
      packed: measurePackedPages(plans, candidateSets, selected),
    });
  };
  const minimum = measure(0);
  if (minimum.packed.decodedBytes > decodedBudgetBytes) {
    fail("the minimum 4-pixel candidate set exceeds the decoded-page budget");
  }
  let low = 0;
  let high = upgrades.length;
  let best = minimum;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = measure(middle);
    if (candidate.packed.decodedBytes <= decodedBudgetBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const start = Math.max(0, best.prefix - 64);
  const end = Math.min(upgrades.length, best.prefix + 64);
  for (let prefix = start; prefix <= end; prefix += 1) {
    const candidate = measure(prefix);
    if (candidate.packed.decodedBytes <= decodedBudgetBytes
      && candidate.prefix > best.prefix) best = candidate;
  }
  return best;
}

function minimumMaximumReconstructionSelection(
  plans,
  candidateSets,
  footprints,
  visibleFrameCounts,
  exactResolutionFaces,
  decodedBudgetBytes,
) {
  for (let maximumReconstructionError = 0;
    maximumReconstructionError <= 4096;
    maximumReconstructionError += 1) {
    const selected = new Uint16Array(plans.length);
    let complete = true;
    for (let faceIndex = 0; faceIndex < plans.length; faceIndex += 1) {
      if (visibleFrameCounts[faceIndex] === 0) continue;
      const footprint = footprints[faceIndex];
      const candidateIndex = candidateSets[faceIndex].findIndex(
        (candidate) => (
          (!exactResolutionFaces[faceIndex]
            || (candidate.width >= footprint.width
              && candidate.height >= footprint.height))
          &&
          candidate.maximumReconstructionError <= maximumReconstructionError
        ),
      );
      if (candidateIndex === -1) {
        complete = false;
        break;
      }
      selected[faceIndex] = candidateIndex;
    }
    if (!complete) continue;
    const packed = measurePackedPages(plans, candidateSets, selected);
    if (packed.decodedBytes <= decodedBudgetBytes) {
      return Object.freeze({
        maximumReconstructionError,
        selected,
        packed,
      });
    }
  }
  fail("no per-face maximum-reconstruction-error selection fits the decoded-page budget");
}

function minimumMaximumTransformStretchSelection(
  plans,
  candidateSets,
  footprints,
  visibleFrameCounts,
  exactResolutionFaces,
  maximumReconstructionError,
  decodedBudgetBytes,
  requestedMaximumTransformStretch = null,
) {
  const thresholds = [...new Set(candidateSets.flatMap((candidates, faceIndex) => (
    visibleFrameCounts[faceIndex] === 0
      ? []
      : candidates
        .filter((candidate) => (
          (!exactResolutionFaces[faceIndex]
            || (candidate.width >= footprints[faceIndex].width
              && candidate.height >= footprints[faceIndex].height))
          && candidate.maximumReconstructionError <= maximumReconstructionError
        ))
        .map((candidate) => candidate.maximumTransformStretch)
  )))].sort((left, right) => left - right);
  if (thresholds.length === 0) {
    fail("no transform-conditioned spatial candidates are available");
  }

  const measureThreshold = (maximumTransformStretch) => {
    const selected = new Uint16Array(plans.length);
    for (let faceIndex = 0; faceIndex < plans.length; faceIndex += 1) {
      if (visibleFrameCounts[faceIndex] === 0) continue;
      const footprint = footprints[faceIndex];
      const candidateIndex = candidateSets[faceIndex].findIndex(
        (candidate) => (
          (!exactResolutionFaces[faceIndex]
            || (candidate.width >= footprint.width
              && candidate.height >= footprint.height))
          && candidate.maximumReconstructionError <= maximumReconstructionError
          && candidate.maximumTransformStretch <= maximumTransformStretch
        ),
      );
      if (candidateIndex === -1) return null;
      selected[faceIndex] = candidateIndex;
    }
    return Object.freeze({
      maximumTransformStretch,
      selected,
      packed: measurePackedPages(plans, candidateSets, selected),
    });
  };
  const measure = (thresholdIndex) => measureThreshold(thresholds[thresholdIndex]);

  if (requestedMaximumTransformStretch !== null) {
    const requested = measureThreshold(requestedMaximumTransformStretch);
    if (requested === null) {
      fail(
        `the requested maximum transform stretch `
        + `${requestedMaximumTransformStretch} has no prepared candidate`,
      );
    }
    if (requested.packed.decodedBytes > decodedBudgetBytes) {
      fail(
        `the requested maximum transform stretch `
        + `${requestedMaximumTransformStretch} requires `
        + `${requested.packed.decodedBytes} decoded bytes, above the `
        + `${decodedBudgetBytes}-byte safety cap`,
      );
    }
    return requested;
  }

  let low = 0;
  let high = thresholds.length - 1;
  let best = null;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = measure(middle);
    if (candidate !== null
      && candidate.packed.decodedBytes <= decodedBudgetBytes) {
      best = candidate;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (best === null) {
    fail("no transform-conditioned selection fits the decoded-page budget");
  }
  const bestIndex = thresholds.indexOf(best.maximumTransformStretch);
  for (let index = Math.max(0, bestIndex - 64);
    index < bestIndex;
    index += 1) {
    const candidate = measure(index);
    if (candidate !== null
      && candidate.packed.decodedBytes <= decodedBudgetBytes) {
      best = candidate;
      break;
    }
  }
  return best;
}

function premultipliedByte(value, alpha) {
  return Math.round(value * alpha / 255);
}

function auditSelection(
  plans,
  footprints,
  sizes,
  stateNodes,
  alphaPolicy,
  canonicalSeamEdgeMasks,
  canonicalBoundaryEdgeMasks,
  boundaryCoverageThreshold,
) {
  const channelHistogram = new Uint32Array(256);
  let comparedPixels = 0;
  let comparedChannels = 0;
  let squaredError = 0;
  let absoluteError = 0;
  let maximumError = 0;
  let worst = null;
  for (let faceIndex = 0; faceIndex < plans.length; faceIndex += 1) {
    const plan = plans[faceIndex];
    const footprint = footprints[faceIndex];
    const size = sizes[faceIndex];
    for (let stateIndex = 0; stateIndex < plan.states.length; stateIndex += 1) {
      const state = plan.states[stateIndex];
      if (state.visiblyUsed === false) continue;
      const reference = renderedStateTile(
        stateNodes,
        state.nodeOffset,
        footprint.width,
        footprint.height,
      );
      const candidate = renderedStateTile(
        stateNodes,
        state.nodeOffset,
        size.width,
        size.height,
        alphaPolicy,
        canonicalSeamEdgeMasks[faceIndex],
        canonicalBoundaryEdgeMasks[faceIndex],
        boundaryCoverageThreshold,
      );
      const reconstructed = resampleRgba(
        candidate,
        size.width,
        size.height,
        footprint.width,
        footprint.height,
      );
      for (let pixelIndex = 0; pixelIndex < footprint.width * footprint.height;
        pixelIndex += 1) {
        const offset = pixelIndex * 4;
        const referenceAlpha = reference[offset + 3];
        const reconstructedAlpha = reconstructed[offset + 3];
        let pixelMaximum = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          const expected = channel === 3
            ? referenceAlpha
            : premultipliedByte(reference[offset + channel], referenceAlpha);
          const actual = channel === 3
            ? reconstructedAlpha
            : premultipliedByte(reconstructed[offset + channel], reconstructedAlpha);
          const error = Math.abs(expected - actual);
          squaredError += error * error;
          absoluteError += error;
          channelHistogram[error] += 1;
          pixelMaximum = Math.max(pixelMaximum, error);
        }
        comparedPixels += 1;
        comparedChannels += 4;
        if (pixelMaximum > maximumError) {
          maximumError = pixelMaximum;
          worst = Object.freeze({
            faceId: plan.faceId,
            sourceOrder: faceIndex,
            stateIndex,
            sourceFrame: state.sourceFrame,
            pixel: Object.freeze([
              pixelIndex % footprint.width,
              Math.floor(pixelIndex / footprint.width),
            ]),
            referenceSize: Object.freeze({ ...footprint }),
            selectedSize: Object.freeze({ ...size }),
            maximumPremultipliedRgbaError: pixelMaximum,
          });
        }
      }
    }
  }
  if (!worst) fail("spatial audit did not compare any retained lighting state");
  return Object.freeze({
    metrics: Object.freeze({
      comparison: "exact source-footprint RGBA versus selected tile reconstructed with CSS-equivalent bilinear sampling for every visibly used retained state",
      premultiplication: "RGB multiplied by alpha before byte comparison",
      comparedPixels,
      comparedChannels,
      squaredError,
      absoluteError,
      meanAbsoluteError: absoluteError / comparedChannels,
      rmsError: Math.sqrt(squaredError / comparedChannels),
      maximumError,
      channelPercentiles: Object.freeze({
        p95: percentile(channelHistogram, 0.95),
        p99: percentile(channelHistogram, 0.99),
        p999: percentile(channelHistogram, 0.999),
      }),
      worst,
    }),
  });
}

function auditEdgeAlphaDeficit(
  plans,
  footprints,
  candidateSets,
  selectedIndices,
  visibleFrameCounts,
  emittedSizes = null,
  alphaPolicy = TITLE_HEAD_ALPHA_POLICY_BOX,
  canonicalSeamEdgeMasks = null,
  canonicalBoundaryEdgeMasks = null,
  boundaryCoverageThreshold = 0,
) {
  const alphaQuantum = 255 / (ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES);
  const riskThresholdAlphaBytes = Math.ceil(alphaQuantum);
  let comparedEdgePixelFrames = 0;
  let absoluteAlphaDeficit = 0;
  let squaredAlphaDeficit = 0;
  let maximumAlphaDeficit = 0;
  let worst = null;
  for (let faceIndex = 0; faceIndex < plans.length; faceIndex += 1) {
    const visibleFrames = visibleFrameCounts[faceIndex];
    if (visibleFrames === 0) continue;
    let candidate = candidateSets[faceIndex][selectedIndices[faceIndex]];
    if (emittedSizes !== null) {
      const footprint = footprints[faceIndex];
      const size = emittedSizes[faceIndex];
      const reference = titleHeadSurfaceAlpha(footprint.width, footprint.height);
      const reconstructed = resampleAlpha(
        titleHeadSurfaceAlpha(
          size.width,
          size.height,
          alphaPolicy,
          canonicalSeamEdgeMasks[faceIndex],
          canonicalBoundaryEdgeMasks[faceIndex],
          boundaryCoverageThreshold,
        ),
        size.width,
        size.height,
        footprint.width,
        footprint.height,
      );
      let edgePixelCount = 0;
      let squaredEdgeAlphaDeficit = 0;
      let absoluteEdgeAlphaDeficit = 0;
      let maximumEdgeAlphaDeficit = 0;
      for (let y = 0; y < footprint.height; y += 1) {
        for (let x = 0; x < footprint.width; x += 1) {
          if (!isAlphaEdgePixel(
            reference,
            footprint.width,
            footprint.height,
            x,
            y,
          )) continue;
          const index = y * footprint.width + x;
          const deficit = Math.max(0, reference[index] - reconstructed[index]);
          edgePixelCount += 1;
          squaredEdgeAlphaDeficit += deficit * deficit;
          absoluteEdgeAlphaDeficit += deficit;
          maximumEdgeAlphaDeficit = Math.max(maximumEdgeAlphaDeficit, deficit);
        }
      }
      candidate = Object.freeze({
        ...size,
        edgePixelCount,
        squaredEdgeAlphaDeficit,
        absoluteEdgeAlphaDeficit,
        maximumEdgeAlphaDeficit,
      });
    }
    comparedEdgePixelFrames += candidate.edgePixelCount * visibleFrames;
    absoluteAlphaDeficit += candidate.absoluteEdgeAlphaDeficit * visibleFrames;
    squaredAlphaDeficit += candidate.squaredEdgeAlphaDeficit * visibleFrames;
    if (candidate.maximumEdgeAlphaDeficit > maximumAlphaDeficit) {
      maximumAlphaDeficit = candidate.maximumEdgeAlphaDeficit;
      worst = Object.freeze({
        faceId: plans[faceIndex].faceId,
        sourceOrder: faceIndex,
        visibleFrameCount: visibleFrames,
        referenceSize: Object.freeze({ ...footprints[faceIndex] }),
        selectedSize: Object.freeze({
          width: candidate.width,
          height: candidate.height,
        }),
        maximumAlphaDeficit: candidate.maximumEdgeAlphaDeficit,
        equivalentSupersamplesLost: Math.ceil(
          candidate.maximumEdgeAlphaDeficit / alphaQuantum,
        ),
      });
    }
  }
  if (!worst || comparedEdgePixelFrames === 0) {
    fail("edge alpha audit did not compare any visible triangle boundary");
  }
  return Object.freeze({
    comparison: "full-resolution supersampled triangle alpha minus CSS-equivalent reconstructed atlas alpha on the exact boundary band",
    darkeningOnly: true,
    edgeBand: "nonzero partial-alpha pixels plus their one-pixel opaque interior neighbours",
    supersampling: `${ALPHA_SUPERSAMPLES}x${ALPHA_SUPERSAMPLES}`,
    riskThreshold: "more than one supersample of alpha coverage is lost at any visible edge pixel",
    riskThresholdAlphaBytes,
    riskDetected: maximumAlphaDeficit > riskThresholdAlphaBytes,
    comparedEdgePixelFrames,
    absoluteAlphaDeficit,
    meanAlphaDeficit: absoluteAlphaDeficit / comparedEdgePixelFrames,
    rmsAlphaDeficit: Math.sqrt(squaredAlphaDeficit / comparedEdgePixelFrames),
    maximumAlphaDeficit,
    maximumEquivalentSupersamplesLost: Math.ceil(maximumAlphaDeficit / alphaQuantum),
    worst,
  });
}

export function optimizeTitleHeadSpatialResolution({
  plans,
  footprints,
  visibleFrameCounts,
  transformSampling,
  canonicalBaseline = false,
  exactResolutionFaces = null,
  stateNodes,
  stateFieldHash,
  sourceLightingHash,
  visibilityHash,
  footprintHash,
  transformSamplingHash,
  decodedBudgetBytes = TITLE_HEAD_SPATIAL_DECODED_BUDGET_BYTES,
  maximumTransformStretchTarget = null,
  alphaPolicy = TITLE_HEAD_ALPHA_POLICY_BOX,
  canonicalSeamEdgeMasks = null,
  canonicalBoundaryEdgeMasks = null,
  boundaryCoverageThreshold = 0,
}) {
  const exactFaces = exactResolutionFaces === null
    ? Object.freeze(Array.from({ length: plans?.length ?? 0 }, () => false))
    : exactResolutionFaces;
  const seamEdgeMasks = canonicalSeamEdgeMasks === null
    ? Object.freeze(Array.from({ length: plans?.length ?? 0 }, () => 0))
    : canonicalSeamEdgeMasks;
  const boundaryEdgeMasks = canonicalBoundaryEdgeMasks === null
    ? Object.freeze(Array.from({ length: plans?.length ?? 0 }, () => 0))
    : canonicalBoundaryEdgeMasks;
  const transformRows = canonicalBaseline ? null : transformSampling;
  if (!Array.isArray(plans) || plans.length !== footprints.length
    || visibleFrameCounts.length !== plans.length
    || typeof canonicalBaseline !== "boolean"
    || (!canonicalBaseline
      && (!Array.isArray(transformRows)
        || transformRows.length !== plans.length
        || transformRows.some((row) => (
          !Number.isSafeInteger(row?.referenceWidth)
          || row.referenceWidth < TITLE_HEAD_LIGHTING_FIELD_SIZE
          || !Number.isSafeInteger(row?.referenceHeight)
          || row.referenceHeight < TITLE_HEAD_LIGHTING_FIELD_SIZE
          || !Number.isFinite(row?.maximumAxisStretchX)
          || row.maximumAxisStretchX < 0
          || !Number.isFinite(row?.maximumAxisStretchY)
          || row.maximumAxisStretchY < 0
          || !Number.isFinite(row?.maximumShearCosine)
          || row.maximumShearCosine < 0
          || row.maximumShearCosine > 1.000001
          || !Number.isSafeInteger(row?.maximumReconstructionError)
          || row.maximumReconstructionError < 0
          || !Number.isSafeInteger(row?.maximumEdgeAlphaDeficit)
          || row.maximumEdgeAlphaDeficit < 0
        ))
        || typeof transformSamplingHash !== "string"
        || !/^[0-9a-f]{64}$/u.test(transformSamplingHash)))
    || !Array.isArray(exactFaces)
    || exactFaces.length !== plans.length
    || exactFaces.some((value) => typeof value !== "boolean")
    || !Buffer.isBuffer(stateNodes)
    || !Number.isSafeInteger(decodedBudgetBytes)
    || decodedBudgetBytes <= 0
    || (maximumTransformStretchTarget !== null
      && (!Number.isFinite(maximumTransformStretchTarget)
        || maximumTransformStretchTarget < 1
        || canonicalBaseline))
    || (alphaPolicy !== TITLE_HEAD_ALPHA_POLICY_BOX
      && alphaPolicy !== TITLE_HEAD_ALPHA_POLICY_SHARED_CONSERVATIVE)
    || !Array.isArray(seamEdgeMasks)
    || seamEdgeMasks.length !== plans.length
    || seamEdgeMasks.some((mask) => (
      !Number.isSafeInteger(mask) || mask < 0 || mask > 7
    ))
    || !Array.isArray(boundaryEdgeMasks)
    || boundaryEdgeMasks.length !== plans.length
    || boundaryEdgeMasks.some((mask) => (
      !Number.isSafeInteger(mask) || mask < 0 || mask > 7
    ))
    || !Number.isSafeInteger(boundaryCoverageThreshold)
    || boundaryCoverageThreshold < 0
    || boundaryCoverageThreshold > ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES) {
    fail("spatial optimizer inputs are incomplete");
  }
  const candidateSets = plans.map((plan, faceIndex) => (
    canonicalBaseline
      ? canonicalCandidates(
        footprints[faceIndex],
        plan.states.length,
        visibleFrameCounts[faceIndex],
      )
      : paretoCandidates(
        footprints[faceIndex],
        plan.states.length,
        visibleFrameCounts[faceIndex],
        transformRows[faceIndex],
        TITLE_HEAD_ALPHA_POLICY_BOX,
        0,
      )
  ));
  const selectionForBudget = (budget) => {
    const minimax = minimumMaximumReconstructionSelection(
      plans,
      candidateSets,
      footprints,
      visibleFrameCounts,
      exactFaces,
      budget,
    );
    const transformMinimax = canonicalBaseline
      ? null
      : minimumMaximumTransformStretchSelection(
        plans,
        candidateSets,
        footprints,
        visibleFrameCounts,
        exactFaces,
        minimax.maximumReconstructionError,
        budget,
        maximumTransformStretchTarget,
      );
    const initialSelected = canonicalBaseline
      ? minimax.selected
      : transformMinimax.selected;
    const upgrades = maximumTransformStretchTarget === null
      ? upgradeSequence(
        candidateSets,
        initialSelected,
        canonicalBaseline
          ? "weightedObjectiveError"
          : "weightedTransformStretch",
      )
      : Object.freeze([]);
    const selected = maximumTransformStretchTarget === null
      ? selectedPrefix(
        plans,
        candidateSets,
        initialSelected,
        upgrades,
        budget,
      )
      : Object.freeze({
        prefix: 0,
        selected: transformMinimax.selected,
        packed: transformMinimax.packed,
      });
    const selection = Object.freeze({
      minimax,
      transformMinimax,
      upgrades,
      selected,
    });
    return selection;
  };
  const {
    minimax,
    transformMinimax,
    upgrades,
    selected,
  } = selectionForBudget(decodedBudgetBytes);
  const sizes = Object.freeze(plans.map((_, faceIndex) => {
    const candidate = candidateSets[faceIndex][selected.selected[faceIndex]];
    return Object.freeze({ width: candidate.width, height: candidate.height });
  }));
  const audit = auditSelection(
    plans,
    footprints,
    sizes,
    stateNodes,
    alphaPolicy,
    seamEdgeMasks,
    boundaryEdgeMasks,
    boundaryCoverageThreshold,
  );
  const edgeAlphaAudit = auditEdgeAlphaDeficit(
    plans,
    footprints,
    candidateSets,
    selected.selected,
    visibleFrameCounts,
    alphaPolicy === TITLE_HEAD_ALPHA_POLICY_BOX ? null : sizes,
    alphaPolicy,
    seamEdgeMasks,
    boundaryEdgeMasks,
    boundaryCoverageThreshold,
  );
  const selectedMetrics = plans.map((plan, faceIndex) => {
    const candidateIndex = selected.selected[faceIndex];
    const candidate = candidateSets[faceIndex][candidateIndex];
    return Object.freeze({
      faceId: plan.faceId,
      sourceOrder: faceIndex,
      stateCount: plan.states.length,
      visibleFrameCount: visibleFrameCounts[faceIndex],
      footprintWidth: footprints[faceIndex].width,
      footprintHeight: footprints[faceIndex].height,
      tileWidth: candidate.width,
      tileHeight: candidate.height,
      candidateIndex,
      candidateCount: candidateSets[faceIndex].length,
      squaredAlphaError: candidate.squaredAlphaError,
      absoluteAlphaError: candidate.absoluteAlphaError,
      maximumAlphaError: candidate.maximumAlphaError,
      edgePixelCount: candidate.edgePixelCount,
      squaredEdgeAlphaDeficit: candidate.squaredEdgeAlphaDeficit,
      absoluteEdgeAlphaDeficit: candidate.absoluteEdgeAlphaDeficit,
      maximumEdgeAlphaDeficit: candidate.maximumEdgeAlphaDeficit,
      maximumBasisError: candidate.maximumBasisError,
      maximumReconstructionError: candidate.maximumReconstructionError,
      ...(canonicalBaseline
        ? {}
        : {
          maximumTransformStretch: candidate.maximumTransformStretch,
        }),
      lostCoveragePixels: candidate.lostCoveragePixels,
      ...(alphaPolicy === TITLE_HEAD_ALPHA_POLICY_BOX
        ? {}
        : {
          canonicalSeamEdgeMask: seamEdgeMasks[faceIndex],
          ...(boundaryCoverageThreshold === 0
            ? {}
            : {
              canonicalBoundaryEdgeMask: boundaryEdgeMasks[faceIndex],
            }),
        }),
    });
  });
  const payload = Object.freeze({
    schema: TITLE_HEAD_SPATIAL_RESOLUTION_SCHEMA,
    sourceLightingHash,
    stateFieldHash,
    visibilityHash,
    footprintHash,
    ...(canonicalBaseline ? {} : { transformSamplingHash }),
    policy: Object.freeze({
      kind: canonicalBaseline
        ? "prepare-time-per-face-source-footprint-error-optimized-raster"
        : "prepare-time-final-transform-conditioned-per-face-raster",
      candidateDimensions: canonicalBaseline
        ? "every unique proportional integer maximum dimension from 4 pixels through the exact source footprint"
        : "monotonic per-face upscales from the retained canonical-fidelity baseline, with width and height independently solved from the final DOM transform Jacobian",
      objective: canonicalBaseline
        ? "minimize the feasible worst per-face reconstruction error, then maximize equally normalized whole-triangle alpha fidelity plus dark-edge alpha-deficit reduction per occupied state-block pixel"
        : maximumTransformStretchTarget === null
          ? "preserve canonical reconstruction quality, minimize worst final transformed texel stretch within the explicit decoded-memory cap, then spend remaining bytes on visible-frame-weighted transformed sharpness"
          : "preserve canonical reconstruction quality and choose the smallest prepared per-face matrices that satisfy the explicit final transformed texel-stretch target",
      finalValidation: canonicalBaseline
        ? "exhaustive premultiplied RGBA reconstruction diff plus visible-frame-weighted dark-edge alpha-deficit audit"
        : "exhaustive premultiplied RGBA reconstruction diff, visible-frame-weighted dark-edge alpha-deficit audit, and a fresh all-face all-frame final DOM transform audit",
      decodedPageBudgetBytes: decodedBudgetBytes,
      ...(canonicalBaseline ? {} : { maximumTransformStretchTarget }),
      runtimeWork: false,
      cssLeafSizing: "raster",
      cssBackgroundScale: "one decoded atlas texel per leaf CSS pixel",
      exactResolutionFaces: exactFaces.filter(Boolean).length,
      ...(alphaPolicy === TITLE_HEAD_ALPHA_POLICY_BOX
        ? {}
        : {
          alphaDownsample: alphaPolicy,
          sharedEdgeCoverage:
            "partial atlas texels nearest a topologically shared canonical edge are max-pooled; silhouette edges retain 4x4 box coverage",
          ...(boundaryCoverageThreshold === 0
            ? {}
            : {
              boundaryCoverage:
                "partial atlas texels on every prepared triangle edge are quantized before CSS bilinear sampling",
              boundaryCoverageThreshold,
              boundaryCoverageSamples:
                ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES,
            }),
        }),
    }),
    optimizer: Object.freeze({
      algorithm: "deterministic-dependent-marginal-upgrade-queue-with-exact-page-cap",
      primaryObjective: "minimum feasible maximum per-face premultiplied-RGBA basis reconstruction error",
      maximumReconstructionErrorThreshold: minimax.maximumReconstructionError,
      ...(canonicalBaseline
        ? {
          secondaryObjective:
            "visible-frame-weighted equal normalization of whole-triangle alpha error and boundary darkening deficit",
        }
        : {
          secondaryObjective:
            "minimum feasible maximum final transformed atlas-texel stretch",
          maximumTransformStretchThreshold:
            transformMinimax.maximumTransformStretch,
          tertiaryObjective:
            "visible-frame-weighted transformed sharpness per occupied state-block pixel",
        }),
      candidateCount: candidateSets.reduce((total, candidates) => total + candidates.length, 0),
      upgradeCount: upgrades.length,
      selectedUpgradeCount: selected.prefix,
      decodedBytes: selected.packed.decodedBytes,
      pages: selected.packed.pages,
    }),
    audit: Object.freeze({
      ...audit.metrics,
      edgeAlphaDeficit: edgeAlphaAudit,
    }),
    faces: Object.freeze(selectedMetrics),
  });
  const report = Object.freeze({
    ...payload,
    contentHash: titleHeadContentHash(payload),
  });
  return Object.freeze({
    sizes,
    report,
  });
}
