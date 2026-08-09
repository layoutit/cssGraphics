import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("native oracle harness remains bound to XScreenSaver yarandom and source constants", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../tools/native/capture-gravitywell-state.c"), "utf8");
  assert.match(source, /#include "yarandom\.h"/u);
  assert.match(source, /#define COUNT 15/u);
  assert.match(source, /#define GRID_SEGMENT 16/u);
  assert.match(source, /#define MASS_EPSILON 0\.03f/u);
  assert.match(source, /#define SLOPE_EPSILON 0\.06f/u);
  assert.doesNotMatch(source, /canvas|WebGL|browser/u);
});

test("rendered oracle includes original gravitywell.c in a no-window CGL framebuffer", async () => {
  const [capture, runner] = await Promise.all([
    readFile(resolve(import.meta.dirname, "../tools/native/headless/capture-gravitywell.c"), "utf8"),
    readFile(resolve(import.meta.dirname, "../tools/oracle/run-visual-oracle.mjs"), "utf8"),
  ]);
  assert.match(capture, /#include "gravitywell\.c"/u);
  assert.match(capture, /kCGLOGLPVersion_Legacy/u);
  assert.match(capture, /glReadPixels/u);
  assert.match(capture, /gltrackball_get_quaternion/u);
  assert.doesNotMatch(capture, /gltrackball_rotate\s*\([^)]*\)\s*\{\s*\(void\)/u);
  assert.match(runner, /cssgravitywell_native_visual_aa/u);
  assert.match(runner, /cssgravitywell_browser_visual_aa/u);
  assert.match(runner, /cssgravitywell_native_browser/u);
  assert.match(runner, /"--mean-threshold", "0"/u);
  assert.match(runner, /"--changed-threshold", "0"/u);
});
