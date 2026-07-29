import {
  CssGraphicsPackageError,
  validateCssGraphicsCatalog,
  type CssGraphicsCatalog,
  type CssGraphicsCatalogRow,
} from "../../model-package/modelPackage.mjs";
import {
  CSSGRAPHICS_DEFAULT_BASE_URL,
} from "../../public-contract.js";

export const CSSGRAPHICS_PACKAGE_CATALOG_URL = "/cssgraphics/catalog.json";
const NORMALIZED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type ValidatedCssGraphicsPackageCatalog = CssGraphicsCatalog;

export class CssGraphicsPackageCatalogError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CssGraphicsPackageCatalogError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new CssGraphicsPackageCatalogError(code, message);
}

export function normalizeCssGraphicsPackageBaseUrl(
  value: string = CSSGRAPHICS_DEFAULT_BASE_URL,
): string {
  if (typeof value !== "string" || !value.startsWith("/")
    || value.includes(":") || value.includes("\\")
    || value.includes("?") || value.includes("#")
    || value.split("/").includes("..")) {
    throw new TypeError("The cssGraphics model base URL must be normalized and root-relative.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

export async function loadCssGraphicsPackageCatalog(
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = CSSGRAPHICS_DEFAULT_BASE_URL,
): Promise<ValidatedCssGraphicsPackageCatalog> {
  if (typeof fetchImpl !== "function") {
    fail("missing-catalog", "The cssGraphics model catalog cannot be requested.");
  }
  const catalogUrl = `${normalizeCssGraphicsPackageBaseUrl(baseUrl)}catalog.json`;
  let response: Response;
  try {
    response = await fetchImpl(catalogUrl, { cache: "no-store" });
  } catch {
    fail("missing-catalog", "The cssGraphics model catalog could not be requested.");
  }
  if (!response.ok) {
    fail(
      response.status === 404 ? "missing-catalog" : "invalid-catalog-request",
      `cssGraphics model catalog returned HTTP ${response.status}.`,
    );
  }
  try {
    return await validateCssGraphicsCatalog(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof CssGraphicsPackageCatalogError) throw error;
    if (error instanceof CssGraphicsPackageError) fail(error.code, error.message);
    throw error;
  }
}

export function resolveCssGraphicsPackageCatalogEntry(
  catalog: ValidatedCssGraphicsPackageCatalog,
  modelId: string,
): CssGraphicsCatalogRow {
  if (!catalog || !Array.isArray(catalog.models)) {
    fail("invalid-catalog", "A validated cssGraphics model catalog is required.");
  }
  if (typeof modelId !== "string" || !NORMALIZED_ID.test(modelId)) {
    fail("invalid-model-id", "The requested model id is not normalized.");
  }
  const entry = catalog.models.find(({ id }) => id === modelId);
  if (!entry) fail("unavailable-model", `cssGraphics model ${modelId} is unavailable.`);
  return entry;
}

export function modelPackageBaseUrl(
  entry: CssGraphicsCatalogRow,
  baseUrl: string = CSSGRAPHICS_DEFAULT_BASE_URL,
): string {
  if (!entry || typeof entry.manifestPath !== "string"
    || !entry.manifestPath.endsWith("/manifest.json") || entry.manifestPath.startsWith("/")) {
    fail("unsafe-manifest-path", "The catalog entry has no normalized manifest path.");
  }
  return `${normalizeCssGraphicsPackageBaseUrl(baseUrl)}${entry.manifestPath.slice(0, -"manifest.json".length)}`;
}
