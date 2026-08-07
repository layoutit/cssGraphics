import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const CSSGEARS_PRODUCT_BANK_SCHEMA = "cssgears-product-bank@2";

export async function inspectCssgearsProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schema === "cssgears-manifest@3" && manifest.status === "ready", "manifest contract");
  assert(manifest.scenes?.length === 24 && manifest.showreel?.retainedSceneBankCount === 24,
    "prepared bank size");
  assert(manifest.preparedBank?.runtimeGeometryConstruction === false &&
    manifest.metrics?.runtimeSceneGenerationCount === 0 &&
    manifest.metrics?.runtimeGeometryConstructionCount === 0 &&
    manifest.metrics?.runtimeCameraCalculationCount === 0 &&
    manifest.metrics?.runtimeDomGrowth === false,
  "manifest runtime boundary");

  const expectedFiles = new Set(["manifest.json"]);
  const lightingUrls = new Set();
  let totalPreparedLeaves = 0;
  let maximumPreparedLeaves = 0;
  let totalSourceFaces = 0;

  for (const entry of manifest.scenes) {
    const scenePath = productPath(entry.sceneUrl);
    const snapshotPath = productPath(entry.snapshotUrl);
    expectedFiles.add(scenePath);
    expectedFiles.add(snapshotPath);

    const sceneBytes = await readFile(join(root, scenePath));
    const scene = JSON.parse(sceneBytes.toString("utf8"));
    assert(scene.id === entry.id && scene.sourceProfile?.seed === entry.nativeSeed, `scene ${entry.id} identity`);
    assert(scene.meshes === undefined && scene.meshDescriptors?.length === 3, `scene ${entry.id} product payload`);
    assert(scene.metrics?.sourceGearCount === 3 && scene.metrics?.preparedGearRootCount === 3,
      `scene ${entry.id} gear roots`);
    assert(scene.metrics?.sourceFaceCoverageExact === true &&
      scene.metrics?.runtimePolygonConstructionCount === 0 &&
      scene.metrics?.runtimeCameraCalculationCount === 0 &&
      scene.metrics?.runtimeRatioCalculationCount === 0 &&
      scene.metrics?.runtimeMeshingPhaseCalculationCount === 0 &&
      scene.metrics?.runtimeLightingCalculationCount === 0 &&
      scene.metrics?.runtimeLightingPublicationCount === 0 &&
      scene.metrics?.runtimeEdgeSelectionCount === 0 &&
      scene.metrics?.runtimeDomGrowth === false,
    `scene ${entry.id} runtime boundary`);
    assert(scene.playback?.frameRows?.length === 720 && scene.playback?.transforms?.length === 2_160,
      `scene ${entry.id} prepared playback`);
    assert(scene.showreel?.stateCount === 580 &&
      scene.showreel?.phases?.spin?.durationMilliseconds === 15_000 &&
      scene.showreel?.runtimeInterpolation === false &&
      scene.showreel?.runtimeEasingCalculation === false &&
      scene.showreel?.runtimeEdgeSelection === false,
    `scene ${entry.id} showreel`);
    assert(scene.renderer?.stableDom === true &&
      scene.renderer?.runtimeGeometryConstruction === false &&
      scene.renderer?.runtimeLightingCalculation === false &&
      scene.renderer?.runtimeDomGrowth === false,
    `scene ${entry.id} renderer`);
    assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/)/u.test(sceneBytes.toString("utf8")),
      `scene ${entry.id} public paths`);

    const lightingPath = productPath(scene.lighting?.assetUrl);
    lightingUrls.add(scene.lighting.assetUrl);
    expectedFiles.add(lightingPath);
    const lightingBytes = await readFile(join(root, lightingPath));
    assert(sha256(lightingBytes) === scene.lighting.assetSha256, `scene ${entry.id} lighting identity`);

    const snapshot = await readFile(join(root, snapshotPath), "utf8");
    assert(count(snapshot, /class="g"/gu) === 3 &&
      count(snapshot, /<b\b/gu) === scene.metrics.preparedLeafCount &&
      count(snapshot, /<div\b/gu) === 5,
    `scene ${entry.id} retained DOM`);
    assert(!/\sdata-[\w-]+=/u.test(snapshot) && !/<(?:script|canvas|svg)\b/iu.test(snapshot),
      `scene ${entry.id} lean DOM`);

    totalPreparedLeaves += scene.metrics.preparedLeafCount;
    maximumPreparedLeaves = Math.max(maximumPreparedLeaves, scene.metrics.preparedLeafCount);
    totalSourceFaces += scene.metrics.sourcePolygonCount;
  }

  const bankSnapshotPath = productPath(manifest.showreel.snapshotUrl);
  expectedFiles.add(bankSnapshotPath);
  const bankSnapshot = await readFile(join(root, bankSnapshotPath), "utf8");
  assert(count(bankSnapshot, /class="g a"/gu) === 3 &&
    count(bankSnapshot, /<b\b/gu) === manifest.showreel.retainedLeafCount &&
    count(bankSnapshot, /<div\b/gu) === 5,
  "showreel bank retained DOM");
  assert(!/\sdata-[\w-]+=/u.test(bankSnapshot) && !/<(?:script|canvas|svg)\b/iu.test(bankSnapshot),
    "showreel bank lean DOM");

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
    schema: CSSGEARS_PRODUCT_BANK_SCHEMA,
    closureSha256: closure.digest("hex"),
    closureBytes,
    fileCount: files.length,
    sceneCount: manifest.scenes.length,
    showreelBankCount: 1,
    retainedGearRootCount: 3,
    retainedSceneBankCount: 24,
    timelineStateCount: 720,
    showreelStateCount: 580,
    showreelSpinMilliseconds: 15_000,
    totalPreparedLeaves,
    maximumPreparedLeaves,
    maximumRetainedShowreelLeaves: manifest.metrics.maximumRetainedShowreelLeafCount,
    totalSourceFaces,
    lightingAssetCount: lightingUrls.size,
  });

  if (verifyDescriptor) {
    const descriptor = JSON.parse(await readFile(join(root, "product-bank.json"), "utf8"));
    for (const [key, value] of Object.entries(summary)) {
      assert(descriptor[key] === value, `product descriptor ${key}`);
    }
    assert(descriptor.publicBoundary?.xscreensaverSourceIncluded === false &&
      descriptor.publicBoundary?.nativeBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false &&
      descriptor.publicBoundary?.oraclePacketIncluded === false,
    "product public boundary");
  }
  return summary;
}

export async function writeCssgearsProductBankDescriptor(root, summary) {
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
    },
    publicBoundary: {
      xscreensaverSourceIncluded: false,
      nativeBinaryIncluded: false,
      nativeCaptureIncluded: false,
      oraclePacketIncluded: false,
    },
  };
  await writeFile(join(root, "product-bank.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith("/cssgears/") && !url.includes(".."),
    "safe product asset URL");
  return url.slice("/cssgears/".length);
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
  if (!condition) throw new Error(`cssGears product bank failed ${label}`);
}
