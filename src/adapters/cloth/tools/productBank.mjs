import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const PRODUCT_ROOT = "/csscloth/";

export async function inspectCssclothProductBank(root) {
  const productRoot = resolve(root);
  const preparedBytes = await readFile(join(productRoot, "prepared.json"));
  const prepared = JSON.parse(preparedBytes);
  const banks = prepared?.playback?.banks;
  assert(prepared?.schema === "csscloth-prepared-scene@1", "prepared schema");
  assert(prepared.status === "ready", "prepared status");
  assert(prepared.presentation?.bankCount === 8, "bank count");
  assert(prepared.presentation.bankFrameCount === 1440, "bank frame count");
  assert(prepared.presentation.bankDurationMilliseconds === 24_000, "bank duration");
  assert(prepared.presentation.durationMilliseconds === 192_000, "stream duration");
  assert(prepared.playback?.schema === "csscloth-prepared-playback-bank-catalog@1", "playback catalog");
  assert(Array.isArray(banks) && banks.length === 8, "playback banks");
  assert(prepared.renderer?.runtimeGeometryConstruction === false, "runtime geometry contract");
  assert(prepared.renderer.runtimeDomGrowth === false, "runtime DOM contract");
  assert(prepared.renderer.runtimeAtlasRasterization === false, "runtime atlas contract");

  const expectedPaths = new Set(["prepared.json", "model/catalog.json"]);
  for (const [bankIndex, bank] of banks.entries()) {
    assert(bank?.bankIndex === bankIndex, `bank ${bankIndex} index`);
    assert(bank.frameCount === 1440 && bank.triangleCount === 200, `bank ${bankIndex} counts`);
    assert(bank.shadowTriangleCount === 51, `bank ${bankIndex} shadow count`);
    assert(bank.schema === "csscloth-prepared-playback@5", `bank ${bankIndex} schema`);
    assert(bank.encoding ===
      "gzip-third-order-zigzag-varint-fixed4-affine12-u16-lighting-u16-atlas-shadow@5",
    `bank ${bankIndex} encoding`);
    const path = productPath(bank.path);
    const bytes = await readFile(join(productRoot, path));
    assert(bytes.byteLength === bank.compressedByteLength, `bank ${bankIndex} bytes`);
    assert(sha256(bytes) === bank.sha256, `bank ${bankIndex} hash`);
    expectedPaths.add(path);
  }

  const catalogBytes = await readFile(join(productRoot, "model/catalog.json"));
  const catalog = JSON.parse(catalogBytes);
  assert(catalog?.schema === "polycss-morph.catalog@1", "model catalog schema");
  assert(catalog.defaultId === "cloth" && catalog.packages?.length === 1, "model catalog package");
  const manifestPath = productRelativePath(`model/${catalog.packages[0].manifestPath}`);
  const manifestBytes = await readFile(join(productRoot, manifestPath));
  assert(sha256(manifestBytes) === catalog.packages[0].manifestSha256, "model manifest hash");
  expectedPaths.add(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert(manifest?.schema === "polycss-morph.package@1", "model manifest schema");
  assert(manifest.identity?.id === "cloth", "model identity");
  const manifestDirectory = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
  for (const resource of manifest.resources ?? []) {
    const path = productRelativePath(`${manifestDirectory}/${resource.path}`);
    const bytes = await readFile(join(productRoot, path));
    assert(bytes.byteLength === resource.bytes, `resource ${path} bytes`);
    assert(sha256(bytes) === resource.sha256, `resource ${path} hash`);
    expectedPaths.add(path);
  }

  const paths = await listFiles(productRoot);
  assert(paths.length === expectedPaths.size && paths.every((path) => expectedPaths.has(path)),
    "portable closure");
  const closure = createHash("sha256");
  let closureBytes = 0;
  for (const path of paths) {
    const bytes = await readFile(join(productRoot, path));
    closure.update(path);
    closure.update("\0");
    closure.update(bytes);
    closure.update("\0");
    closureBytes += bytes.byteLength;
  }
  return Object.freeze({
    schema: "csscloth-product-bank-summary@1",
    bankCount: banks.length,
    bankFrameCount: prepared.presentation.bankFrameCount,
    durationMilliseconds: prepared.presentation.durationMilliseconds,
    retainedLeafCount: prepared.metrics?.retainedLeafCount,
    fileCount: paths.length,
    closureBytes,
    closureSha256: closure.digest("hex"),
    preparedByteLength: preparedBytes.byteLength,
    preparedSha256: sha256(preparedBytes),
  });
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith(PRODUCT_ROOT), `product URL ${url}`);
  return productRelativePath(url.slice(PRODUCT_ROOT.length));
}

function productRelativePath(path) {
  assert(typeof path === "string" && path.length > 0 && !path.startsWith("/") &&
    !path.split("/").includes(".."), `product path ${path}`);
  return path;
}

async function listFiles(root, directory = root) {
  const paths = [];
  for (const entry of (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `symlink ${path}`);
    if (entry.isDirectory()) paths.push(...await listFiles(root, path));
    else {
      assert(entry.isFile() && (await stat(path)).isFile(), `file ${path}`);
      paths.push(relative(root, path));
    }
  }
  return paths;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, label) {
  if (!condition) throw new Error(`cssCloth product bank failed ${label}`);
}
