import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createCssGraphicsCatalog,
  cssGraphicsContentHash,
  validateCssGraphicsModelPackage,
} from "../model-package/modelPackage.mjs";

export const CSSGRAPHICS_CATALOG_GENERATION_SCHEMA = "cssgraphics.catalog-generation@1";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readModel(root) {
  const manifestBytes = readFileSync(resolve(root, "manifest.json"));
  const bundle = await validateCssGraphicsModelPackage({
    manifestBytes,
    loadResource: async (path) => readFileSync(resolve(root, path)),
  });
  return Object.freeze({
    root,
    manifestBytes,
    bundle,
    row: Object.freeze({
      id: bundle.manifest.id,
      name: bundle.manifest.name,
      manifestPath: `models/${bundle.manifest.id}/manifest.json`,
      manifestSha256: sha256(manifestBytes),
    }),
  });
}

export async function buildCssGraphicsCatalog({ modelRoots, defaultId = null } = {}) {
  if (!Array.isArray(modelRoots) || modelRoots.length === 0) {
    throw new TypeError("At least one prepared cssGraphics model root is required.");
  }
  const models = await Promise.all(modelRoots.map(readModel));
  models.sort((left, right) => (
    left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0
  ));
  if (new Set(models.map(({ row }) => row.id)).size !== models.length) {
    throw new Error("The cssGraphics catalog contains duplicate model ids.");
  }
  const selectedDefault = defaultId
    ?? (models.find(({ row }) => row.id === "mario")?.row.id
      ?? models[0]?.row.id);
  if (!selectedDefault || !models.some(({ row }) => row.id === selectedDefault)) {
    throw new Error("The cssGraphics catalog has no valid default model.");
  }
  const generationHash = await cssGraphicsContentHash({
    schema: CSSGRAPHICS_CATALOG_GENERATION_SCHEMA,
    defaultId: selectedDefault,
    manifests: models.map(({ row }) => ({
      id: row.id,
      manifestPath: row.manifestPath,
      manifestSha256: row.manifestSha256,
    })),
  });
  const built = await createCssGraphicsCatalog({
    generationHash,
    defaultId: selectedDefault,
    models: models.map(({ row }) => row),
  });
  return Object.freeze({
    catalog: built.catalog,
    bytes: Buffer.from(built.bytes),
    models: Object.freeze(models),
  });
}
