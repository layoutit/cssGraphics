import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const CSSMAZE_PRODUCT_BANK_SCHEMA = "cssmaze-product-bank@1";

const TEXTURE_HASHES = Object.freeze({
  "assets/brick1.png": "60190f318c521e43160cd8780a70e08117f4cc6d8bd839c304bcc30f312c300d",
  "assets/brick2.png": "8829d69a3eb036ac97fbf5a3bf9ecdbc90fe9fe1a36775bd96fa57a46d481ef9",
  "assets/wood2.png": "22e6111a207b6e1463641c583ea08a17cc6f89bc62276a3e14ad37ff3350f0a6",
});

export async function inspectCssmazeProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schema === "cssmaze-manifest@3" && manifest.status === "ready", "manifest contract");
  assert(manifest.release?.status === "ready" && manifest.scope === "public-prepared-product" &&
    manifest.release?.noticePath === "debian/copyright" &&
    manifest.release?.noticeSha256 === "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9",
  "public release boundary");
  assert(manifest.scenes?.length === 24 && manifest.preparedBank?.sceneIds?.length === 24,
    "prepared bank size");
  assert(manifest.transport?.schema === "cssmaze-prepared-transport@1" &&
    manifest.transport.encoding === "gzip" &&
    manifest.transport.startup === "selected-scene-and-snapshot-first" &&
    manifest.transport.selection === "page-load-only" &&
    manifest.transport.runtimeArchiveDownload === false &&
    manifest.transport.runtimeGeometryPayload === false,
  "prepared transport");

  const expectedFiles = new Set(["manifest.json", ...Object.keys(TEXTURE_HASHES)]);
  let totalTimelineStates = 0;
  let totalPreparedLeaves = 0;
  let totalVisibilityDeltaOperations = 0;
  for (const entry of manifest.scenes) {
    const scenePath = productPath(entry.sceneUrl);
    const snapshotPath = productPath(entry.snapshotUrl);
    expectedFiles.add(scenePath);
    expectedFiles.add(snapshotPath);
    assert(scenePath.endsWith(".json.gz") && snapshotPath.endsWith(".html.gz"),
      `scene ${entry.id} gzip URLs`);

    const scene = JSON.parse(gunzipSync(await readFile(join(root, scenePath))).toString("utf8"));
    assert(scene.id === entry.id && scene.sourceProfile?.seed === entry.nativeSeed,
      `scene ${entry.id} identity`);
    assert(scene.meshes === undefined && scene.meshDescriptors?.length === 2 &&
      scene.meshDescriptors.reduce((sum, mesh) => sum + mesh.polygonCount, 0) === 171,
    `scene ${entry.id} lean geometry payload`);
    assert(scene.metrics?.sourceWallSegmentCount === 169 && scene.metrics?.preparedLeafCount === 171 &&
      scene.metrics?.sourceWallCoverageExact === true &&
      scene.metrics?.runtimeMazeGenerationCount === 0 &&
      scene.metrics?.runtimeCameraCalculationCount === 0 &&
      scene.metrics?.runtimeVisibilityCalculationCount === 0 &&
      scene.metrics?.runtimeLeafVisibilityComparisonCount === 0 &&
      scene.metrics?.runtimeDomGrowth === false && scene.renderer?.runtimeGeometryPayload === false,
    `scene ${entry.id} runtime boundary`);
    assert(scene.playback?.frameRows?.length === scene.playback?.stateCount &&
      scene.playback?.leafVisibilityChangeRows?.length === scene.playback?.stateCount &&
      scene.playback?.preparedCompositorInterpolation === true &&
      scene.playback?.runtimeInterpolation === false,
    `scene ${entry.id} prepared playback`);
    assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/)/u.test(JSON.stringify(scene)),
      `scene ${entry.id} public paths`);

    const snapshot = gunzipSync(await readFile(join(root, snapshotPath))).toString("utf8");
    assert(count(snapshot, /class="[^"]*cssmaze-world/gu) === 1 &&
      count(snapshot, /class="[^"]*cssmaze-walls/gu) === 1 &&
      count(snapshot, /class="[^"]*cssmaze-surfaces/gu) === 1 &&
      count(snapshot, /data-polycss-leaf="polygon"/gu) === 171,
    `scene ${entry.id} retained DOM`);
    assert(!/<(?:script|canvas|svg)\b/iu.test(snapshot), `scene ${entry.id} renderer boundary`);

    totalTimelineStates += scene.playback.stateCount;
    totalPreparedLeaves += scene.metrics.preparedLeafCount;
    totalVisibilityDeltaOperations += scene.metrics.preparedLeafVisibilityDeltaOperationCount;
  }

  for (const [path, hash] of Object.entries(TEXTURE_HASHES)) {
    assert(sha256(await readFile(join(root, path))) === hash, `texture ${path} identity`);
  }

  const files = (await walk(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "product-bank.json")
    .sort();
  assert(files.length === expectedFiles.size && files.every((path) => expectedFiles.has(path)),
    "exact product file closure");

  const closure = createHash("sha256");
  let closureBytes = 0;
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    closure.update(path).update("\0").update(bytes).update("\0");
    closureBytes += bytes.length;
  }
  const summary = Object.freeze({
    schema: CSSMAZE_PRODUCT_BANK_SCHEMA,
    closureSha256: closure.digest("hex"),
    closureBytes,
    fileCount: files.length,
    sceneCount: manifest.scenes.length,
    retainedWorldRootCount: 1,
    retainedWallRootCount: 1,
    retainedSurfaceRootCount: 1,
    preparedLeavesPerScene: 171,
    totalPreparedLeaves,
    totalTimelineStates,
    totalVisibilityDeltaOperations,
    textureCount: Object.keys(TEXTURE_HASHES).length,
  });

  if (verifyDescriptor) {
    const descriptor = JSON.parse(await readFile(join(root, "product-bank.json"), "utf8"));
    for (const [key, value] of Object.entries(summary)) {
      assert(descriptor[key] === value, `product descriptor ${key}`);
    }
    assert(descriptor.license?.sourceNoticePath === "debian/copyright" &&
      descriptor.license?.sourceNoticeSha256 === "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9" &&
      descriptor.license?.copyright === "Copyright 1991-2025 Jamie Zawinski <jwz@jwz.org>" &&
      descriptor.license?.permissionNotice?.startsWith("Permission to use, copy, modify, distribute, and sell this software") &&
      descriptor.publicBoundary?.xscreensaverSourceIncluded === false &&
      descriptor.publicBoundary?.xscreensaverTextureFileCount === 3 &&
      descriptor.publicBoundary?.nativeBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false,
    "product public boundary");
  }
  return summary;
}

export async function writeCssmazeProductBankDescriptor(root, summary) {
  const descriptor = {
    ...summary,
    source: {
      repository: "https://github.com/Zygo/xscreensaver",
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      preparedSeedCount: 24,
      nativeAuthorityStatus: "qualified-locally-not-packaged",
    },
    transport: {
      archiveFormat: "tar+gzip",
      runtimeDownloadsArchive: false,
      deployUnpacksStaticFiles: true,
      preparedAssetEncoding: "gzip",
      startupFetch: "selected-scene-and-snapshot-first",
      selection: "page-load-only",
    },
    license: {
      sourceNoticePath: "debian/copyright",
      sourceNoticeSha256: "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9",
      copyright: "Copyright 1991-2025 Jamie Zawinski <jwz@jwz.org>",
      permissionNotice: "Permission to use, copy, modify, distribute, and sell this software and its documentation for any purpose is hereby granted without fee, provided that the above copyright notice appear in all copies and that both that copyright notice and this permission notice appear in supporting documentation. No representations are made about the suitability of this software for any purpose. It is provided \"as is\" without express or implied warranty.",
    },
    publicBoundary: {
      xscreensaverSourceIncluded: false,
      xscreensaverTextureFileCount: 3,
      nativeBinaryIncluded: false,
      nativeCaptureIncluded: false,
      oraclePacketIncluded: false,
    },
  };
  await writeFile(join(root, "product-bank.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith("/cssmaze/") && !url.includes(".."),
    "safe product asset URL");
  return url.slice("/cssmaze/".length);
}

async function walk(root) {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Unsupported product-bank entry ${path}`);
  }
  return paths;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(text, expression) {
  return (text.match(expression) ?? []).length;
}

function assert(condition, label) {
  if (!condition) throw new Error(`cssMaze product bank failed ${label}`);
}
