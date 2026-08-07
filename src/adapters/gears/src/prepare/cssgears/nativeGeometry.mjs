import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { adapterRoot, localRoot } from "./paths.mjs";

const CAPTURE_SOURCE = join(adapterRoot, "tools/native/capture-involute.c");
const STUB_INCLUDE = join(adapterRoot, "tools/native/include");

export async function captureInvoluteGeometry(sourceRoot, gear) {
  const binary = await compileCaptureTool(sourceRoot);
  const result = spawnSync(binary, captureArgs(gear), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`XScreenSaver involute capture failed for gear ${gear.id}:\n${result.stderr || result.stdout}`);
  }
  const captured = JSON.parse(result.stdout);
  if (captured.schema !== "cssgears-native-geometry@1" ||
      captured.sourcePolygonCount !== captured.capturedPolygonCount ||
      captured.polygons?.length !== captured.sourcePolygonCount) {
    throw new Error(`XScreenSaver involute capture census drifted for gear ${gear.id}`);
  }
  return captured;
}

async function compileCaptureTool(sourceRoot) {
  const sourceFiles = [
    CAPTURE_SOURCE,
    join(adapterRoot, "tools/native/include/screenhackI.h"),
    join(sourceRoot, "hacks/glx/involute.c"),
    join(sourceRoot, "hacks/glx/involute.h"),
    join(sourceRoot, "hacks/glx/normals.c"),
    join(sourceRoot, "hacks/glx/normals.h"),
  ];
  const identity = createHash("sha256");
  for (const path of sourceFiles) identity.update(await readFile(path));
  const key = identity.digest("hex").slice(0, 20);
  const binaryDir = join(localRoot, "bin");
  const binary = join(binaryDir, `capture-involute-${key}`);
  try {
    await readFile(binary);
    return binary;
  } catch {}
  await mkdir(binaryDir, { recursive: true });
  const temporary = `${binary}.tmp-${process.pid}`;
  const compiler = process.env.CC || "cc";
  const result = spawnSync(compiler, [
    "-std=c11", "-O2", "-I", STUB_INCLUDE,
    "-I", resolve(sourceRoot, "hacks/glx"),
    CAPTURE_SOURCE,
    resolve(sourceRoot, "hacks/glx/involute.c"),
    resolve(sourceRoot, "hacks/glx/normals.c"),
    "-lm", "-o", temporary,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to compile the headless XScreenSaver involute capture:\n${result.stderr || result.stdout}`);
  }
  await chmod(temporary, 0o755);
  await rename(temporary, binary);
  return binary;
}

function captureArgs(gear) {
  return [
    gear.id, gear.nteeth, gear.radius, gear.toothW, gear.toothH, gear.toothSlope,
    gear.innerR, gear.innerR2, gear.innerR3, gear.thickness, gear.thickness2,
    gear.thickness3, gear.spokes, gear.nubs, gear.spokeThickness, gear.wobble,
    Number(gear.inverted), Number(gear.base), gear.size,
    ...gear.color, ...gear.color2,
  ].map(String);
}
