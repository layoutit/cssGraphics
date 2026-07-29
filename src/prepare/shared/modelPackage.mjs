import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import sharp from "sharp";

import {
  CSSGRAPHICS_MODEL_DATA_SCHEMA,
  CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA,
  CSSGRAPHICS_PREPARED_PLAYBACK_JSON_CODEC_ID,
  canonicalCssGraphicsBytes,
  createCssGraphicsModelManifest,
  createCssGraphicsResourceDescriptor,
  cssGraphicsModelCodecRegistry,
  cssGraphicsSha256,
  parseCssGraphicsModelTransportDescriptor,
  validateCssGraphicsModelPackage,
} from "../../model-package/modelPackage.mjs";
import {
  assertEmptyOutputRoot,
  writePreparedFile,
} from "./files.mjs";

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSections(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => lexicalCompare(left, right)),
  );
}

async function webpMetadata(bytes, role) {
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
    throw new Error(`Prepared cssGraphics asset ${role} is not one dimensional WebP.`);
  }
  return { width: metadata.width, height: metadata.height };
}

export async function encodeLosslessWebp(bytes) {
  return sharp(bytes, { failOn: "error" })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

export async function encodeCursorWebp(openBytes, closedBytes) {
  return sharp({
    create: {
      width: 64,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: openBytes, left: 0, top: 0 },
      { input: closedBytes, left: 32, top: 0 },
    ])
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

export async function writeCssGraphicsModelPackage({
  outputRoot,
  id,
  name,
  profile,
  features,
  generationHash,
  sections,
  css,
  assets,
} = {}) {
  const root = assertEmptyOutputRoot(outputRoot);
  const model = {
    schema: CSSGRAPHICS_MODEL_DATA_SCHEMA,
    id,
    sections: canonicalSections(sections),
  };
  const modelBytes = canonicalCssGraphicsBytes(model, { pretty: false });
  const stylesBytes = Buffer.from(css.endsWith("\n") ? css : `${css}\n`, "utf8");
  const writeOrder = [];
  const resourceAssets = {};
  const loaded = new Map();

  if (typeof profile !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile)) {
    throw new Error("A normalized cssGraphics runtime profile is required.");
  }
  const codec = cssGraphicsModelCodecRegistry.resolve(
    CSSGRAPHICS_PREPARED_PLAYBACK_JSON_CODEC_ID,
  );
  const encoded = await codec.encode(model);
  if (encoded.parts.length !== 1 || encoded.parts[0]?.id !== "model") {
    throw new Error("cssGraphics model codecs must emit one model part.");
  }
  const decodedBytes = Buffer.from(
    canonicalCssGraphicsBytes(encoded.parts[0].value, { pretty: false }),
  );
  const compressedBytes = gzipSync(decodedBytes, { level: 9, mtime: 0 });
  writePreparedFile(
    root,
    "model.json",
    compressedBytes,
    writeOrder,
    "cssgraphics-model-json-gzip",
  );
  loaded.set("model.json", compressedBytes);
  const descriptor = await createCssGraphicsResourceDescriptor({
    path: "model.json",
    mediaType: "application/gzip",
    bytes: compressedBytes,
  });
  writePreparedFile(root, "model.css", stylesBytes, writeOrder, "cssgraphics-model-styles");
  loaded.set("model.css", stylesBytes);

  for (const asset of [...assets].sort((left, right) => lexicalCompare(left.role, right.role))) {
    const path = `assets/${asset.role}.webp`;
    const bytes = Buffer.from(asset.bytes);
    const dimensions = await webpMetadata(bytes, asset.role);
    writePreparedFile(root, path, bytes, writeOrder, `cssgraphics-${asset.role}-webp`);
    loaded.set(path, bytes);
    resourceAssets[asset.role] = await createCssGraphicsResourceDescriptor({
      path,
      mediaType: "image/webp",
      bytes,
      ...dimensions,
    });
  }

  const resources = {
    model: parseCssGraphicsModelTransportDescriptor({
      schema: CSSGRAPHICS_MODEL_TRANSPORT_SCHEMA,
      codec: codec.id,
      expanded: {
        schema: CSSGRAPHICS_MODEL_DATA_SCHEMA,
        mediaType: "application/json",
        bytes: modelBytes.byteLength,
        sha256: await cssGraphicsSha256(modelBytes),
      },
      parts: [{
        id: "model",
        ...descriptor,
        decodedBytes: decodedBytes.byteLength,
        decodedSha256: await cssGraphicsSha256(decodedBytes),
      }],
    }),
    styles: await createCssGraphicsResourceDescriptor({
      path: "model.css",
      mediaType: "text/css",
      bytes: stylesBytes,
    }),
    assets: resourceAssets,
  };
  const built = await createCssGraphicsModelManifest({
    id,
    name,
    profile,
    features,
    generationHash,
    resources,
  });
  writePreparedFile(root, "manifest.json", built.bytes, writeOrder, "cssgraphics-model-manifest");
  if (writeOrder.at(-1) !== "manifest.json") {
    throw new Error("cssGraphics model manifest was not written last.");
  }
  await validateCssGraphicsModelPackage({
    manifestBytes: built.bytes,
    loadResource: async (path) => {
      const bytes = loaded.get(path);
      if (!bytes) throw new Error(`Missing prepared cssGraphics resource ${path}.`);
      return bytes;
    },
  });
  mkdirSync(resolve(root, "assets"), { recursive: true });
  return Object.freeze({
    root,
    manifest: built.manifest,
    model,
    css,
    writeOrder: Object.freeze([...writeOrder]),
  });
}
