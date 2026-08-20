#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  applyClothRasterPlan,
  buildClothPreparedModel,
} from "../src/prepare/csscloth/modelBuilder.mjs";
import {
  CSSCLOTH_PLAYBACK_ENCODING,
  CSSCLOTH_PLAYBACK_SCHEMA,
  encodeClothPreparedPlayback,
} from "../src/shared/csscloth/preparedPlaybackTransport.mjs";
import {
  buildClothRasterAssets,
  clothLogoRasterPagePath,
  clothRasterPagePath,
  CSSCLOTH_GROUND_IMAGE_PATH,
  CSSCLOTH_SHADOW_IMAGE_PATH,
} from "../src/prepare/csscloth/rasterAtlas.mjs";
import {
  CSSCLOTH_BANK_COUNT,
  CSSCLOTH_BANK_FRAME_COUNT,
  CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
  CSSCLOTH_RASTER_LEAF_SIZE,
  CSSCLOTH_STREAM_FRAME_COUNT,
} from "../src/prepare/csscloth/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const sourceRoot = resolveRequiredSourceRoot();
const outputRoot = join(repositoryRoot, "build/generated/public/csscloth");
const stagingRoot = join(repositoryRoot, `build/generated/.csscloth-${process.pid}`);
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));

await assertSourceIdentity();
const grassBytes = await readFile(join(sourceRoot, sourceLock.groundTexture.path));
const logoBytes = await readFile(join(adapterRoot, sourceLock.cssLogo.localPath));
await rm(stagingRoot, { recursive: true, force: true });
const desktop = await prepareProfile("desktop", stagingRoot, "/csscloth/");
const mobile = await prepareProfile("mobile", join(stagingRoot, "mobile"), "/csscloth/mobile/");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({
  outputRoot,
  profiles: { desktop, mobile },
}, null, 2));

async function prepareProfile(profile, profileRoot, publicRoot) {
  const basePrepared = buildClothPreparedModel({ profile });
  const raster = await buildClothRasterAssets({
    logoBytes,
    grassBytes,
    rasterBoxes: basePrepared.rasterBoxes,
    lightingStates: basePrepared.lightingStates,
    triangles: basePrepared.triangles,
  });
  const prepared = applyClothRasterPlan(basePrepared, raster);
  const resources = [
    ...raster.clothPages.map((bytes, index) => ({
      path: clothRasterPagePath(index),
      role: "image",
      mediaType: "image/png",
      bytes,
    })),
    ...raster.clothLogoPages.map((bytes, index) => ({
      path: clothLogoRasterPagePath(index),
      role: "image",
      mediaType: "image/png",
      bytes,
    })),
    {
      path: CSSCLOTH_GROUND_IMAGE_PATH,
      role: "image",
      mediaType: "image/webp",
      bytes: raster.groundImage,
    },
    {
      path: CSSCLOTH_SHADOW_IMAGE_PATH,
      role: "image",
      mediaType: "image/png",
      bytes: raster.shadowImage,
    },
  ];
  const builtPackage = await buildPolyMorphPackage(prepared.model, resources);
  const playbackAssets = Object.freeze(prepared.playbackBanks.map((playback, bankIndex) => {
    const bytes = encodeClothPreparedPlayback(playback);
    const compressedBytes = gzipSync(bytes, { level: 9 });
    const uncompressedSha256 = createHash("sha256").update(bytes).digest("hex");
    const sha256 = createHash("sha256").update(compressedBytes).digest("hex");
    const fileName = `playback-bank-${String(bankIndex).padStart(2, "0")}-${sha256.slice(0, 16)}.bin.gz`;
    return Object.freeze({
      fileName,
      bytes,
      compressedBytes,
      descriptor: Object.freeze({
        schema: CSSCLOTH_PLAYBACK_SCHEMA,
        encoding: CSSCLOTH_PLAYBACK_ENCODING,
        bankIndex,
        path: `${publicRoot}${fileName}`,
        sha256,
        uncompressedSha256,
        compressedByteLength: compressedBytes.byteLength,
        uncompressedByteLength: bytes.byteLength,
        frameCount: playback.frameCount,
        triangleCount: playback.triangleCount,
        shadowTriangleCount: playback.shadowTriangleCount,
        frameMilliseconds: playback.frameMilliseconds,
      }),
    });
  }));
  const logoPage = raster.clothLogoLayout?.pages[0];
  const logoSlice = raster.clothLogoLayout?.slots[0];
  const logoAtlas = logoPage && logoSlice
    ? Object.freeze({
        pageWidth: logoPage.width,
        pageHeight: logoPage.height,
        leafWidth: logoSlice.width,
        leafHeight: logoSlice.height,
        gutter: logoSlice.x,
        columns: logoPage.width / (logoSlice.width + logoSlice.x * 2),
        rasterScale: logoSlice.width / CSSCLOTH_RASTER_LEAF_SIZE,
        triangleSlots: raster.clothLogoLayout.stateSlots.map((slots) => slots[0]),
      })
    : undefined;
  const packageRoot = join(profileRoot, "model", prepared.model.identity.id);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of builtPackage.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), builtPackage.manifestBytes);
  const catalog = await buildPolyMorphCatalog(prepared.model.identity.id, [{
    manifest: builtPackage.manifest,
    manifestPath: `${prepared.model.identity.id}/manifest.json`,
    manifestSha256: builtPackage.manifestSha256,
  }]);
  await writeBytes(join(profileRoot, "model", "catalog.json"), catalog.bytes);
  for (const asset of playbackAssets) {
    await writeBytes(join(profileRoot, asset.fileName), asset.compressedBytes);
  }
  await writeJson(join(profileRoot, "prepared.json"), {
    schema: "csscloth-prepared-scene@1",
    status: "ready",
    source: sourceLock,
    renderer: {
      package: "@layoutit/polycss-morph",
      profile: "static-prepared-with-external-prepared-playback",
      profileId: profile,
      modelId: prepared.model.identity.id,
      modelRoot: `${publicRoot}model/`,
      representation: "retained-cloth-and-shadow-triangles-with-compact-prepared-raster-playback",
      textureLeafSizing: "raster",
      logoAtlas,
      lightingAtlas: {
        triangleSlots: raster.clothLayout.stateSlots,
      },
      runtimeGeometryConstruction: false,
      runtimeDomGrowth: false,
      runtimeAtlasRasterization: false,
    },
    presentation: {
      bankCount: CSSCLOTH_BANK_COUNT,
      bankFrameCount: CSSCLOTH_BANK_FRAME_COUNT,
      bankDurationMilliseconds: CSSCLOTH_BANK_FRAME_COUNT * CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      frameCount: CSSCLOTH_STREAM_FRAME_COUNT,
      durationMilliseconds: CSSCLOTH_STREAM_FRAME_COUNT * CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      frameMilliseconds: CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
      loop: true,
      clothSurface: "white-i-love-css",
      responsiveProfile: profile === "desktop" ? {
        media: "(max-width: 600px)",
        path: "/csscloth/mobile/prepared.json",
      } : undefined,
      startingBankSelection: {
        policy: "crypto-random-uniform-starting-bank-once-before-prepared-bank-fetch",
        bankCount: CSSCLOTH_BANK_COUNT,
      },
      groundTextureRepeatCount: prepared.metrics.groundTextureRepeatCount,
    },
    playback: {
      schema: "csscloth-prepared-playback-bank-catalog@1",
      bankCount: CSSCLOTH_BANK_COUNT,
      bankFrameCount: CSSCLOTH_BANK_FRAME_COUNT,
      banks: playbackAssets.map((asset) => asset.descriptor),
    },
    metrics: {
      ...prepared.metrics,
      preparedPlaybackCompressedBytes: playbackAssets.reduce(
        (sum, asset) => sum + asset.compressedBytes.byteLength,
        0,
      ),
      preparedPlaybackUncompressedBytes: playbackAssets.reduce(
        (sum, asset) => sum + asset.bytes.byteLength,
        0,
      ),
    },
    manifestSha256: builtPackage.manifestSha256,
    oracle: {
      sourceState: "source-model-pinned",
      visual: "unqualified",
    },
  });
  return Object.freeze({
    manifestSha256: builtPackage.manifestSha256,
    playback: playbackAssets.map((asset) => asset.descriptor),
    metrics: prepared.metrics,
  });
}

function resolveRequiredSourceRoot() {
  const value = process.env.CSSCLOTH_SOURCE_ROOT;
  if (!value) throw new Error("Set CSSCLOTH_SOURCE_ROOT to the pinned Three.js r132 checkout");
  return resolve(value);
}

async function assertSourceIdentity() {
  const head = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.error) throw head.error;
  if (head.status !== 0) throw new Error(`Unable to resolve cloth source revision:\n${head.stderr || head.stdout}`);
  if (head.stdout.trim() !== sourceLock.revision) {
    throw new Error(`Cloth source revision drifted: ${head.stdout.trim()}`);
  }
  for (const input of [sourceLock.primary, sourceLock.clothTexture, sourceLock.groundTexture, sourceLock.license, sourceLock.groundTextureNotice]) {
    const bytes = await readFile(join(sourceRoot, input.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== input.sha256) throw new Error(`Cloth source bytes drifted: ${input.path}`);
  }
  const logoBytes = await readFile(join(adapterRoot, sourceLock.cssLogo.localPath));
  const logoSha256 = createHash("sha256").update(logoBytes).digest("hex");
  if (logoSha256 !== sourceLock.cssLogo.sha256) {
    throw new Error(`CSS logo source bytes drifted: ${sourceLock.cssLogo.localPath}`);
  }
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJson(path, value) {
  await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}
