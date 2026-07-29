import {
  CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE,
  parseCssGraphicsModelTransportDescriptor,
  type CssGraphicsModelTransportDescriptor,
  type CssGraphicsModelTransportPartDescriptor,
} from "./transport.mjs";
import {
  cssGraphicsModelCodecRegistry,
} from "./codecs/preparedPlayback.mjs";

export {
  CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE,
  CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA,
  createCssGraphicsModelCodecRegistry,
  defineCssGraphicsModelCodec,
  parseCssGraphicsModelTransportDescriptor,
} from "./transport.mjs";
export {
  CSSGRAPHICS_PREPARED_PLAYBACK_JSON_CODEC_ID,
  cssGraphicsPreparedPlaybackJsonCodec,
  cssGraphicsModelCodecRegistry,
} from "./codecs/preparedPlayback.mjs";
export type {
  CssGraphicsExpandedModelDescriptor,
  CssGraphicsModelCodec,
  CssGraphicsModelCodecEncodeResult,
  CssGraphicsModelCodecPart,
  CssGraphicsModelCodecRegistry,
  CssGraphicsModelTransportDescriptor,
  CssGraphicsModelTransportPartDescriptor,
} from "./transport.mjs";

export const CSSGRAPHICS_MODEL_SCHEMA = "cssgraphics.model@1";
export const CSSGRAPHICS_MODEL_DATA_SCHEMA = "cssgraphics.model-data@1";
export const CSSGRAPHICS_CATALOG_SCHEMA = "cssgraphics.catalog@1";

export type CssGraphicsProfile = string;

export interface CssGraphicsResourceDescriptor {
  readonly path: string;
  readonly mediaType: "application/json" | "application/gzip" | "text/css";
  readonly bytes: number;
  readonly sha256: string;
}

export interface CssGraphicsAssetDescriptor {
  readonly path: string;
  readonly mediaType: "image/webp";
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export interface CssGraphicsModelManifest {
  readonly schema: typeof CSSGRAPHICS_MODEL_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly profile: CssGraphicsProfile;
  readonly features: readonly string[];
  readonly generationHash: string;
  readonly resources: Readonly<{
    model: CssGraphicsModelTransportDescriptor;
    styles: CssGraphicsResourceDescriptor;
    assets: Readonly<Record<string, CssGraphicsAssetDescriptor>>;
  }>;
  readonly contentHash: string;
}

export interface CssGraphicsModelData {
  readonly schema: typeof CSSGRAPHICS_MODEL_DATA_SCHEMA;
  readonly id: string;
  readonly sections: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

export interface CssGraphicsCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
}

export interface CssGraphicsCatalog {
  readonly schema: typeof CSSGRAPHICS_CATALOG_SCHEMA;
  readonly generationHash: string;
  readonly defaultId: string;
  readonly models: readonly CssGraphicsCatalogRow[];
  readonly contentHash: string;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const NORMALIZED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NORMALIZED_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;
type JsonRecord = Record<string, unknown>;
type PackageResourceDescriptor =
  | CssGraphicsResourceDescriptor
  | CssGraphicsAssetDescriptor
  | CssGraphicsModelTransportPartDescriptor;
type ManifestResources = CssGraphicsModelManifest["resources"];

export class CssGraphicsPackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CssGraphicsPackageError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new CssGraphicsPackageError(code, message);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry)) as Value;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  ) as Value;
}

export function canonicalCssGraphicsJson(
  value: unknown,
  { pretty = true }: Readonly<{ pretty?: boolean }> = {},
): string {
  return JSON.stringify(canonicalValue(value), null, pretty ? 2 : 0);
}

export function canonicalCssGraphicsBytes(
  value: unknown,
  options?: Readonly<{ pretty?: boolean }>,
): Uint8Array {
  return new TextEncoder().encode(`${canonicalCssGraphicsJson(value, options)}\n`);
}

function toBytes(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail("invalid-bytes", `${label} did not provide bytes.`);
}

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function cssGraphicsSha256(
  value: Uint8Array | ArrayBuffer,
): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("crypto-unavailable", "SHA-256 verification is unavailable.");
  const bytes = toBytes(value, "SHA-256 input");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return toHex(digest);
}

export async function cssGraphicsContentHash(value: unknown): Promise<string> {
  return cssGraphicsSha256(new TextEncoder().encode(canonicalCssGraphicsJson(value, { pretty: false })));
}

function record(
  value: unknown,
  label: string,
  code = "invalid-contract",
): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
  code = "invalid-contract",
): void {
  const actual = Object.keys(value).sort(lexicalCompare);
  const wanted = [...expected].sort(lexicalCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${label} has unsupported or missing fields.`);
  }
}

function text(
  value: unknown,
  label: string,
  { max = 160 }: Readonly<{ max?: number }> = {},
): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    fail("invalid-contract", `${label} must be bounded non-empty text.`);
  }
  return value;
}

function normalizedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NORMALIZED_ID.test(value)) {
    fail("invalid-id", `${label} is not a normalized id.`);
  }
  return value;
}

function normalizedPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.endsWith("/")
    || value.includes("\\") || value.includes("?") || value.includes("#") || value.includes("%")
    || value.split("/").some((segment) => !NORMALIZED_SEGMENT.test(segment))) {
    fail("unsafe-path", `${label} is not a normalized relative path.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("invalid-number", `${label} must be a positive integer.`);
  }
  return value as number;
}

function sortedIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail("invalid-contract", `${label} must be an array.`);
  const rows = value.map((entry, index) => normalizedId(entry, `${label}[${index}]`));
  if (new Set(rows).size !== rows.length) fail("duplicate-id", `${label} contains duplicate ids.`);
  const sorted = [...rows].sort(lexicalCompare);
  if (rows.some((entry, index) => entry !== sorted[index])) {
    fail("noncanonical-order", `${label} must be sorted.`);
  }
  return rows;
}

function parseJson(bytes: Uint8Array, label: string, code: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(code, `${label} is not UTF-8 JSON.`);
  }
}

function parseText(bytes: Uint8Array, label: string, code: string): string {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(code, `${label} is not UTF-8 text.`);
  }
  if (!value.trim() || value.includes("\0")) fail(code, `${label} is empty or invalid.`);
  return value;
}

async function assertInternalHash(
  value: JsonRecord,
  label: string,
  code: string,
): Promise<void> {
  if (typeof value.contentHash !== "string" || !SHA256.test(value.contentHash)) {
    fail(code, `${label}.contentHash is invalid.`);
  }
  const { contentHash, ...payload } = value;
  if (await cssGraphicsContentHash(payload) !== contentHash) {
    fail(code, `${label}.contentHash does not match its payload.`);
  }
}

function parseResource(
  value: unknown,
  label: string,
  expectedPath: string,
  expectedMediaType: CssGraphicsResourceDescriptor["mediaType"],
): CssGraphicsResourceDescriptor {
  const resource = record(value, label, "invalid-manifest");
  exactKeys(resource, ["path", "mediaType", "bytes", "sha256"], label, "invalid-manifest");
  const path = normalizedPath(resource.path, `${label}.path`);
  if (path !== expectedPath) fail("invalid-manifest", `${label}.path must be ${expectedPath}.`);
  if (resource.mediaType !== expectedMediaType) {
    fail("invalid-media-type", `${label}.mediaType must be ${expectedMediaType}.`);
  }
  const sha256 = typeof resource.sha256 === "string"
    ? resource.sha256
    : "";
  if (!SHA256.test(sha256)) {
    fail("invalid-manifest", `${label}.sha256 is invalid.`);
  }
  return {
    path,
    mediaType: expectedMediaType,
    bytes: positiveInteger(resource.bytes, `${label}.bytes`),
    sha256,
  };
}

function parseAsset(
  value: unknown,
  role: string,
  label: string,
): CssGraphicsAssetDescriptor {
  const asset = record(value, label, "invalid-manifest");
  exactKeys(asset, ["path", "mediaType", "bytes", "sha256", "width", "height"], label, "invalid-manifest");
  if (role === "sprites") fail("invalid-asset-role", "Use semantic asset roles instead of sprites.");
  const path = normalizedPath(asset.path, `${label}.path`);
  const expectedPath = `assets/${role}.webp`;
  if (path !== expectedPath) fail("invalid-asset-role", `${label}.path must be ${expectedPath}.`);
  if (asset.mediaType !== "image/webp") {
    fail("invalid-media-type", `${label}.mediaType must be image/webp.`);
  }
  const sha256 = typeof asset.sha256 === "string" ? asset.sha256 : "";
  if (!SHA256.test(sha256)) {
    fail("invalid-manifest", `${label}.sha256 is invalid.`);
  }
  return {
    path,
    mediaType: "image/webp",
    bytes: positiveInteger(asset.bytes, `${label}.bytes`),
    sha256,
    width: positiveInteger(asset.width, `${label}.width`),
    height: positiveInteger(asset.height, `${label}.height`),
  };
}

function parseResources(
  value: unknown,
  features: readonly string[],
): ManifestResources {
  const resources = record(value, "manifest.resources", "invalid-manifest");
  exactKeys(resources, ["model", "styles", "assets"], "manifest.resources", "invalid-manifest");
  let model: CssGraphicsModelTransportDescriptor;
  try {
    model = parseCssGraphicsModelTransportDescriptor(resources.model);
  } catch (error) {
    fail(
      "invalid-manifest",
      error instanceof Error ? error.message : "manifest.resources.model is invalid.",
    );
  }
  const styles = parseResource(
    resources.styles,
    "manifest.resources.styles",
    "model.css",
    "text/css",
  );
  const assetsValue = record(resources.assets, "manifest.resources.assets", "invalid-manifest");
  const roles = Object.keys(assetsValue);
  const sortedRoles = [...roles].sort(lexicalCompare);
  if (roles.some((role, index) => role !== sortedRoles[index])) {
    fail("noncanonical-order", "manifest.resources.assets must be ordered by role.");
  }
  const assets: Record<string, CssGraphicsAssetDescriptor> = {};
  for (const roleValue of roles) {
    const role = normalizedId(roleValue, "manifest asset role");
    if (!features.includes(role)) {
      fail("orphan-asset", `Asset ${role} has no matching feature.`);
    }
    assets[role] = parseAsset(
      assetsValue[role],
      role,
      `manifest.resources.assets.${role}`,
    );
  }
  for (const role of Object.keys(assets)) {
    if (!features.includes(role)) {
      fail("undeclared-asset", `Asset ${role} requires a matching manifest feature.`);
    }
  }
  const paths = [
    ...model.parts.map(({ path }) => path),
    styles.path,
    ...Object.values(assets).map(({ path }) => path),
  ];
  if (new Set(paths).size !== paths.length) fail("duplicate-path", "Manifest resource paths must be unique.");
  return { model, styles, assets };
}

function validateAssetBindings(
  value: unknown,
  manifest: CssGraphicsModelManifest,
): void {
  const visit = (current: unknown, label: string): void => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${label}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    const object = current as JsonRecord;
    if (Object.hasOwn(object, "asset")) {
      const role = object.asset;
      if (typeof role !== "string" || !manifest.features.includes(role)
        || !manifest.resources.assets[role]) {
        fail("asset-binding-mismatch", `${label}.asset does not bind a declared package asset.`);
      }
    }
    for (const [name, entry] of Object.entries(object)) {
      visit(entry, `${label}.${name}`);
    }
  };
  visit(value, "model.sections");
}

function parseManifestValue(value: unknown): Readonly<{
  raw: JsonRecord;
  manifest: CssGraphicsModelManifest;
}> {
  const raw = record(value, "manifest", "invalid-manifest");
  exactKeys(
    raw,
    ["schema", "id", "name", "profile", "features", "generationHash", "resources", "contentHash"],
    "manifest",
    "invalid-manifest",
  );
  if (raw.schema !== CSSGRAPHICS_MODEL_SCHEMA) {
    fail("invalid-schema", `Model manifests must use ${CSSGRAPHICS_MODEL_SCHEMA}.`);
  }
  const id = normalizedId(raw.id, "manifest.id");
  const name = text(raw.name, "manifest.name", { max: 80 });
  const profile = normalizedId(raw.profile, "manifest.profile");
  const features = sortedIds(raw.features, "manifest.features");
  const generationHash = typeof raw.generationHash === "string"
    ? raw.generationHash
    : "";
  if (!SHA256.test(generationHash)) {
    fail("invalid-manifest", "manifest.generationHash is invalid.");
  }
  const resources = parseResources(raw.resources, features);
  const contentHash = typeof raw.contentHash === "string"
    ? raw.contentHash
    : "";
  return {
    raw,
    manifest: {
      schema: CSSGRAPHICS_MODEL_SCHEMA,
      id,
      name,
      profile,
      features: Object.freeze(features),
      generationHash,
      resources: Object.freeze({
        ...resources,
        assets: Object.freeze({ ...resources.assets }),
      }),
      contentHash,
    },
  };
}

function parseModelData(
  value: unknown,
  manifest: CssGraphicsModelManifest,
): CssGraphicsModelData {
  const model = record(value, "model.json", "invalid-model-data");
  exactKeys(model, ["schema", "id", "sections"], "model.json", "invalid-model-data");
  if (model.schema !== CSSGRAPHICS_MODEL_DATA_SCHEMA) {
    fail("invalid-model-data", `model.json must use ${CSSGRAPHICS_MODEL_DATA_SCHEMA}.`);
  }
  if (normalizedId(model.id, "model.json.id") !== manifest.id) {
    fail("stale-id", "model.json and manifest ids differ.");
  }
  const sections = record(model.sections, "model.json.sections", "invalid-model-data");
  const names = Object.keys(sections);
  const sortedNames = [...names].sort(lexicalCompare);
  if (names.some((name, index) => name !== sortedNames[index])) {
    fail("noncanonical-order", "model.json.sections must be ordered.");
  }
  const validatedSections: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const name of names) {
    normalizedId(name, `model.json section ${name}`);
    validatedSections[name] = Object.freeze(
      record(sections[name], `model.json.sections.${name}`, "invalid-model-data"),
    );
  }
  validateAssetBindings(validatedSections, manifest);
  return {
    schema: CSSGRAPHICS_MODEL_DATA_SCHEMA,
    id: manifest.id,
    sections: Object.freeze(validatedSections),
  };
}

export async function validateCssGraphicsModelManifest(
  manifestBytes: Uint8Array | ArrayBuffer,
): Promise<CssGraphicsModelManifest> {
  const bytes = toBytes(manifestBytes, "manifest.json");
  const parsed = parseManifestValue(parseJson(bytes, "manifest.json", "invalid-manifest"));
  await assertInternalHash(parsed.raw, "manifest", "invalid-manifest");
  return Object.freeze(parsed.manifest);
}

async function checkedLoad(
  loadResource: (path: string) => Promise<Uint8Array | ArrayBuffer>,
  descriptor: PackageResourceDescriptor,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = toBytes(await loadResource(descriptor.path), descriptor.path);
  } catch (error) {
    if (error instanceof CssGraphicsPackageError) throw error;
    fail("missing-resource", `Resource ${descriptor.path} could not be read.`);
  }
  if (bytes.byteLength !== descriptor.bytes) {
    fail("resource-size-mismatch", `${descriptor.path} has stale byte metadata.`);
  }
  if (await cssGraphicsSha256(bytes) !== descriptor.sha256) {
    fail("resource-hash-mismatch", `${descriptor.path} has stale or mixed bytes.`);
  }
  return bytes;
}

async function decompressModelPart(
  bytes: Uint8Array,
  descriptor: CssGraphicsModelTransportPartDescriptor,
): Promise<Uint8Array> {
  if (descriptor.mediaType !== CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE) {
    fail("invalid-media-type", `${descriptor.path} is not gzip JSON.`);
  }
  let decoded: Uint8Array;
  try {
    const stream = new Response(Uint8Array.from(bytes)).body;
    if (!stream) fail("invalid-model-data", `${descriptor.path} has no response body.`);
    decoded = new Uint8Array(await new Response(
      stream.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer());
  } catch (error) {
    if (error instanceof CssGraphicsPackageError) throw error;
    fail("invalid-model-data", `${descriptor.path} is not valid gzip data.`);
  }
  if (decoded.byteLength !== descriptor.decodedBytes) {
    fail("resource-size-mismatch", `${descriptor.path} has stale decoded byte metadata.`);
  }
  if (await cssGraphicsSha256(decoded) !== descriptor.decodedSha256) {
    fail("resource-hash-mismatch", `${descriptor.path} has stale decoded bytes.`);
  }
  return decoded;
}

function bindCatalogEntry(
  entry: CssGraphicsCatalogRow | null,
  parsedManifest: CssGraphicsModelManifest,
  manifestSha256: string,
): void {
  if (!entry) return;
  if (entry.id !== parsedManifest.id || entry.name !== parsedManifest.name
    || entry.manifestSha256 !== manifestSha256) {
    fail("catalog-binding-mismatch", "Catalog row and manifest bytes disagree.");
  }
}

export async function validateCssGraphicsModelPackage({
  manifestBytes,
  loadResource,
  catalogEntry = null,
}: Readonly<{
  manifestBytes: Uint8Array | ArrayBuffer;
  loadResource(path: string): Promise<Uint8Array | ArrayBuffer>;
  catalogEntry?: CssGraphicsCatalogRow | null;
}>): Promise<Readonly<{
  manifest: CssGraphicsModelManifest;
  model: CssGraphicsModelData;
  styles: string;
  assets: ReadonlyMap<string, Uint8Array>;
}>> {
  if (typeof loadResource !== "function") {
    fail("invalid-loader", "A model resource loader is required.");
  }
  const bytes = toBytes(manifestBytes, "manifest.json");
  const manifest = await validateCssGraphicsModelManifest(bytes);
  bindCatalogEntry(catalogEntry, manifest, await cssGraphicsSha256(bytes));
  const [partRows, stylesBytes] = await Promise.all([
    Promise.all(manifest.resources.model.parts.map(async (descriptor) => {
      const compressed = await checkedLoad(loadResource, descriptor);
      const decoded = await decompressModelPart(compressed, descriptor);
      return [
        descriptor.id,
        parseJson(decoded, descriptor.path, "invalid-model-data"),
      ] as const;
    })),
    checkedLoad(loadResource, manifest.resources.styles),
  ]);
  let decodedModel: CssGraphicsModelData;
  try {
    const codec = cssGraphicsModelCodecRegistry.resolve(
      manifest.resources.model.codec,
    );
    decodedModel = await codec.decode(new Map(partRows));
  } catch (error) {
    if (error instanceof CssGraphicsPackageError) throw error;
    fail(
      "invalid-model-data",
      error instanceof Error ? error.message : "Model transport decoding failed.",
    );
  }
  const modelBytes = canonicalCssGraphicsBytes(decodedModel, { pretty: false });
  if (modelBytes.byteLength !== manifest.resources.model.expanded.bytes
    || await cssGraphicsSha256(modelBytes) !== manifest.resources.model.expanded.sha256) {
    fail("resource-hash-mismatch", "The expanded model identity does not match its manifest.");
  }
  const model = parseModelData(decodedModel, manifest);
  const styles = parseText(stylesBytes, "model.css", "invalid-model-css");
  const assets = new Map<string, Uint8Array>();
  for (const [role, descriptor] of Object.entries(manifest.resources.assets)) {
    assets.set(role, await checkedLoad(loadResource, descriptor));
  }
  return Object.freeze({
    manifest,
    model: Object.freeze(model),
    styles,
    assets,
  });
}

function parseCatalogRow(value: unknown, index: number): CssGraphicsCatalogRow {
  const label = `catalog.models[${index}]`;
  const row = record(value, label, "invalid-catalog");
  exactKeys(row, ["id", "name", "manifestPath", "manifestSha256"], label, "invalid-catalog");
  const id = normalizedId(row.id, `${label}.id`);
  const name = text(row.name, `${label}.name`, { max: 80 });
  const manifestPath = normalizedPath(row.manifestPath, `${label}.manifestPath`);
  if (manifestPath !== `models/${id}/manifest.json`) {
    fail("invalid-catalog", `${label}.manifestPath does not match its model id.`);
  }
  const manifestSha256 = typeof row.manifestSha256 === "string"
    ? row.manifestSha256
    : "";
  if (!SHA256.test(manifestSha256)) {
    fail("invalid-catalog", `${label}.manifestSha256 is invalid.`);
  }
  return { id, name, manifestPath, manifestSha256 };
}

export async function validateCssGraphicsCatalog(
  catalogBytes: Uint8Array | ArrayBuffer,
): Promise<CssGraphicsCatalog> {
  const bytes = toBytes(catalogBytes, "catalog.json");
  const catalog = record(
    parseJson(bytes, "catalog.json", "invalid-catalog"),
    "catalog",
    "invalid-catalog",
  );
  exactKeys(
    catalog,
    ["schema", "generationHash", "defaultId", "models", "contentHash"],
    "catalog",
    "invalid-catalog",
  );
  if (catalog.schema !== CSSGRAPHICS_CATALOG_SCHEMA) {
    fail("invalid-schema", `Catalogs must use ${CSSGRAPHICS_CATALOG_SCHEMA}.`);
  }
  const generationHash = typeof catalog.generationHash === "string"
    ? catalog.generationHash
    : "";
  if (!SHA256.test(generationHash)) {
    fail("invalid-catalog", "catalog.generationHash is invalid.");
  }
  if (!Array.isArray(catalog.models) || catalog.models.length < 1) {
    fail("invalid-catalog", "catalog.models must contain at least one row.");
  }
  const models = catalog.models.map((row, index) => parseCatalogRow(row, index));
  const ids = models.map(({ id }) => id);
  const sortedIds = [...ids].sort(lexicalCompare);
  if (ids.some((id, index) => id !== sortedIds[index])) {
    fail("noncanonical-order", "catalog.models must be sorted by id.");
  }
  if (new Set(ids).size !== ids.length) fail("duplicate-id", "Catalog model ids must be unique.");
  const paths = models.map(({ manifestPath }) => manifestPath);
  if (new Set(paths).size !== paths.length) {
    fail("duplicate-path", "Catalog manifest paths must be unique.");
  }
  const defaultId = normalizedId(catalog.defaultId, "catalog.defaultId");
  if (!ids.includes(defaultId)) fail("stale-id", "catalog.defaultId is not present.");
  await assertInternalHash(catalog, "catalog", "invalid-catalog");
  const contentHash = typeof catalog.contentHash === "string"
    ? catalog.contentHash
    : "";
  return Object.freeze({
    schema: CSSGRAPHICS_CATALOG_SCHEMA,
    generationHash,
    defaultId,
    models: Object.freeze(models),
    contentHash,
  });
}

export async function createCssGraphicsResourceDescriptor({
  path,
  mediaType,
  bytes: inputBytes,
  width,
  height,
}: Readonly<{
  path: string;
  mediaType: "application/json" | "application/gzip" | "text/css" | "image/webp";
  bytes: Uint8Array | ArrayBuffer;
  width?: number;
  height?: number;
}>): Promise<Readonly<CssGraphicsResourceDescriptor | CssGraphicsAssetDescriptor>> {
  const bytes = toBytes(inputBytes, path);
  const descriptor = {
    path,
    mediaType,
    bytes: bytes.byteLength,
    sha256: await cssGraphicsSha256(bytes),
  };
  if (width !== undefined || height !== undefined) {
    if (mediaType !== "image/webp" || width === undefined || height === undefined) {
      fail("invalid-asset", `${path} has incomplete image dimensions.`);
    }
    return Object.freeze(canonicalValue({
      ...descriptor,
      mediaType: "image/webp" as const,
      width,
      height,
    }));
  }
  if (mediaType === "image/webp") {
    fail("invalid-asset", `${path} requires image dimensions.`);
  }
  return Object.freeze(canonicalValue({
    ...descriptor,
    mediaType,
  }));
}

export async function createCssGraphicsModelManifest(
  value: Omit<CssGraphicsModelManifest, "schema" | "contentHash">,
): Promise<Readonly<{
  manifest: CssGraphicsModelManifest;
  bytes: Uint8Array;
}>> {
  const payload: Omit<CssGraphicsModelManifest, "contentHash"> = canonicalValue({
    schema: CSSGRAPHICS_MODEL_SCHEMA,
    id: value.id,
    name: value.name,
    profile: value.profile,
    features: value.features,
    generationHash: value.generationHash,
    resources: value.resources,
  });
  const manifest: CssGraphicsModelManifest = {
    ...payload,
    contentHash: await cssGraphicsContentHash(payload),
  };
  const bytes = canonicalCssGraphicsBytes(manifest);
  await validateCssGraphicsModelManifest(bytes);
  return Object.freeze({ manifest: Object.freeze(manifest), bytes });
}

export async function createCssGraphicsCatalog(
  value: Omit<CssGraphicsCatalog, "schema" | "contentHash">,
): Promise<Readonly<{
  catalog: CssGraphicsCatalog;
  bytes: Uint8Array;
}>> {
  const payload: Omit<CssGraphicsCatalog, "contentHash"> = canonicalValue({
    schema: CSSGRAPHICS_CATALOG_SCHEMA,
    generationHash: value.generationHash,
    defaultId: value.defaultId,
    models: value.models,
  });
  const catalog: CssGraphicsCatalog = {
    ...payload,
    contentHash: await cssGraphicsContentHash(payload),
  };
  const bytes = canonicalCssGraphicsBytes(catalog);
  await validateCssGraphicsCatalog(bytes);
  return Object.freeze({ catalog: Object.freeze(catalog), bytes });
}
