import type { CssGraphicsModelData } from "./modelPackage.mjs";

export const CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA = "cssgraphics.model-transport@1";
export const CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE = "application/gzip";

export interface CssGraphicsExpandedModelDescriptor {
  readonly schema: string;
  readonly mediaType: "application/json";
  readonly bytes: number;
  readonly sha256: string;
}

export interface CssGraphicsModelTransportPartDescriptor {
  readonly id: string;
  readonly path: string;
  readonly mediaType: typeof CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE;
  readonly bytes: number;
  readonly sha256: string;
  readonly decodedBytes: number;
  readonly decodedSha256: string;
}

export interface CssGraphicsModelTransportDescriptor {
  readonly schema: typeof CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA;
  readonly codec: string;
  readonly expanded: CssGraphicsExpandedModelDescriptor;
  readonly parts: readonly CssGraphicsModelTransportPartDescriptor[];
}

export interface CssGraphicsModelCodecPart {
  readonly id: string;
  readonly value: unknown;
}

export interface CssGraphicsModelCodecEncodeResult {
  readonly parts: readonly CssGraphicsModelCodecPart[];
}

export interface CssGraphicsModelCodec {
  readonly id: string;
  encode(model: CssGraphicsModelData): Promise<CssGraphicsModelCodecEncodeResult>;
  decode(parts: ReadonlyMap<string, unknown>): Promise<CssGraphicsModelData>;
}

export interface CssGraphicsModelCodecRegistry {
  readonly ids: readonly string[];
  resolve(id: string): CssGraphicsModelCodec;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const CODEC_ID = /^cssgraphics\.[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$/u;
const NORMALIZED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NORMALIZED_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has unsupported or missing fields.`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${label} must be a positive integer.`);
  }
  return value as number;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a SHA-256 hash.`);
  }
  return value;
}

function normalizedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NORMALIZED_ID.test(value)) {
    fail(`${label} must be a normalized id.`);
  }
  return value;
}

function normalizedPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.startsWith("/")
    || value.endsWith("/") || value.includes("\\") || value.includes("?")
    || value.includes("#") || value.includes("%")
    || value.split("/").some((segment) => !NORMALIZED_SEGMENT.test(segment))) {
    fail(`${label} must be a normalized relative path.`);
  }
  return value;
}

function codecId(value: unknown, label: string): string {
  if (typeof value !== "string" || !CODEC_ID.test(value)) {
    fail(`${label} must be a versioned cssGraphics codec id.`);
  }
  return value;
}

function expandedDescriptor(value: unknown): CssGraphicsExpandedModelDescriptor {
  const descriptor = record(value, "transport.expanded");
  exactKeys(
    descriptor,
    ["bytes", "mediaType", "schema", "sha256"],
    "transport.expanded",
  );
  if (descriptor.mediaType !== "application/json") {
    fail("transport.expanded.mediaType must be application/json.");
  }
  if (typeof descriptor.schema !== "string"
    || !/^cssgraphics\.[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$/u.test(descriptor.schema)) {
    fail("transport.expanded.schema must be versioned.");
  }
  return Object.freeze({
    schema: descriptor.schema,
    mediaType: descriptor.mediaType,
    bytes: positiveInteger(descriptor.bytes, "transport.expanded.bytes"),
    sha256: hash(descriptor.sha256, "transport.expanded.sha256"),
  });
}

function partDescriptor(
  value: unknown,
  index: number,
): CssGraphicsModelTransportPartDescriptor {
  const label = `transport.parts[${index}]`;
  const descriptor = record(value, label);
  exactKeys(
    descriptor,
    [
      "bytes",
      "decodedBytes",
      "decodedSha256",
      "id",
      "mediaType",
      "path",
      "sha256",
    ],
    label,
  );
  const id = normalizedId(descriptor.id, `${label}.id`);
  const path = normalizedPath(descriptor.path, `${label}.path`);
  if (id !== "model" || path !== "model.json") {
    fail(`${label} must describe the single model.json payload.`);
  }
  if (descriptor.mediaType !== CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE) {
    fail(`${label}.mediaType must be ${CSSGRAPHICS_MODEL_GZIP_MEDIA_TYPE}.`,
    );
  }
  return Object.freeze({
    id,
    path,
    mediaType: descriptor.mediaType,
    bytes: positiveInteger(descriptor.bytes, `${label}.bytes`),
    sha256: hash(descriptor.sha256, `${label}.sha256`),
    decodedBytes: positiveInteger(descriptor.decodedBytes, `${label}.decodedBytes`),
    decodedSha256: hash(descriptor.decodedSha256, `${label}.decodedSha256`),
  });
}

export function parseCssGraphicsModelTransportDescriptor(
  value: unknown,
): CssGraphicsModelTransportDescriptor {
  const transport = record(value, "transport");
  exactKeys(
    transport,
    ["codec", "expanded", "parts", "schema"],
    "transport",
  );
  if (transport.schema !== CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA) {
    fail(`transport.schema must be ${CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA}.`,
    );
  }
  const codec = codecId(transport.codec, "transport.codec");
  if (!Array.isArray(transport.parts) || transport.parts.length !== 1) {
    fail("transport.parts must contain exactly one model payload.");
  }
  const parts = transport.parts.map((part, index) => (
    partDescriptor(part, index)
  ));
  const ids = parts.map(({ id }) => id);
  const paths = parts.map(({ path }) => path);
  if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) {
    fail("transport.parts contains duplicate ids or paths.");
  }
  const sorted = [...ids].sort();
  if (ids.some((id, index) => id !== sorted[index])) {
    fail("transport.parts must be ordered by semantic id.");
  }
  return Object.freeze({
    schema: transport.schema,
    codec,
    expanded: expandedDescriptor(transport.expanded),
    parts: Object.freeze(parts),
  });
}

export function defineCssGraphicsModelCodec(
  value: CssGraphicsModelCodec,
): CssGraphicsModelCodec {
  const codec = record(value, "codec");
  exactKeys(codec, ["decode", "encode", "id"], "codec");
  const id = codecId(codec.id, "codec.id");
  if (typeof codec.encode !== "function" || typeof codec.decode !== "function") {
    fail("codec encode and decode operations are required.");
  }
  return Object.freeze({
    id,
    encode: value.encode,
    decode: value.decode,
  });
}

export function createCssGraphicsModelCodecRegistry(
  codecs: readonly CssGraphicsModelCodec[],
): CssGraphicsModelCodecRegistry {
  if (!Array.isArray(codecs) || codecs.length < 1) {
    fail("At least one model codec is required.");
  }
  const entries = codecs.map(defineCssGraphicsModelCodec);
  const ids = entries.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    fail("Model codec ids must be unique.");
  }
  const byId = new Map<string, CssGraphicsModelCodec>(
    entries.map((codec) => [codec.id, codec]),
  );
  return Object.freeze({
    ids: Object.freeze([...ids].sort()),
    resolve(id: string): CssGraphicsModelCodec {
      const normalizedCodecId = codecId(id, "codec id");
      const codec = byId.get(normalizedCodecId);
      if (!codec) fail(`Model codec ${normalizedCodecId} is not registered.`);
      return codec;
    },
  });
}
