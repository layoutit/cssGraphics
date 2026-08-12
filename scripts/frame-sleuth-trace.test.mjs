import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  CAPTURE_SCHEMA,
  captureOutputPaths,
  parseCaptureCli,
  traceCategories,
} from "./frame-sleuth-trace.mjs";

test("defaults to a long untouched no-focus installed-Chrome capture", () => {
  const output = resolve("output/frame-sleuth-test/default/Trace.json.gz");
  const options = parseCaptureCli([
    "http://127.0.0.1:5173/gravitywell/?bank=15",
    "--output", output,
  ]);
  assert.equal(CAPTURE_SCHEMA, "cssgraphics-frame-sleuth-capture@1");
  assert.equal(options.durationMs, 8_000);
  assert.equal(options.startupMs, 1_000);
  assert.equal(options.headless, true);
  assert.equal(options.screenshots, false);
  assert.equal(options.width, null);
  assert.equal(options.height, null);
  assert.equal(options.url, "http://127.0.0.1:5173/gravitywell/?bank=15");
});

test("requires paired viewport dimensions and safe gzip output", () => {
  assert.throws(() => parseCaptureCli(["https://example.test/", "--width", "390"]), /together/);
  assert.throws(() => parseCaptureCli(["https://example.test/", "--startup-ms", "8000"]), /smaller/);
  assert.throws(() => parseCaptureCli([new URL("demo.html", `file:${"///"}`).href]), /http\(s\)/);
  assert.throws(() => parseCaptureCli([
    "https://example.test/",
    "--output", resolve("output/frame-sleuth-test/Trace.json"),
  ]), /.json.gz/);
});

test("requires explicit headed opt-in before opening a Chrome window", () => {
  const options = parseCaptureCli([
    "https://example.test/",
    "--headed",
    "--output", resolve("output/frame-sleuth-test/headed/Trace.json.gz"),
  ]);
  assert.equal(options.headless, false);
});

test("captures DevTools frame, JavaScript, GC, navigation, and optional screenshot evidence", () => {
  const categories = traceCategories();
  assert.ok(categories.includes("disabled-by-default-devtools.timeline.frame"));
  assert.ok(categories.includes("disabled-by-default-v8.cpu_profiler"));
  assert.ok(categories.includes("v8.execute"));
  assert.ok(categories.includes("navigation"));
  assert.ok(!categories.includes("disabled-by-default-devtools.screenshot"));
  assert.ok(traceCategories({ screenshots: true }).includes("disabled-by-default-devtools.screenshot"));
});

test("derives reports beside the raw trace", () => {
  const fixture = resolve("output/frame-sleuth-test/run/Trace.json.gz");
  const root = resolve("output/frame-sleuth-test/run");
  const paths = captureOutputPaths(fixture);
  assert.equal(paths.trace, fixture);
  assert.equal(paths.capture, resolve(root, "Trace.capture.json"));
  assert.equal(paths.fullReport, resolve(root, "Trace.frame-sleuth.md"));
  assert.equal(paths.steadyReport, resolve(root, "Trace.frame-sleuth-steady.md"));
  assert.equal(paths.fullChart, resolve(root, "Trace.frame-times.svg"));
  assert.equal(paths.steadyChart, resolve(root, "Trace.frame-times-steady.svg"));
});

test("starts tracing before cold navigation and contains no app warmup seam", async () => {
  const source = await readFile(resolve(import.meta.dirname, "frame-sleuth-trace.mjs"), "utf8");
  assert.ok(source.indexOf("await startTrace(cdp, categories)") < source.indexOf("await page.goto(options.url"));
  assert.doesNotMatch(source, /networkidle|waitForFunction|\.evaluate\(|\.pause\(|\.seek|\.step\(/u);
  assert.match(source, /headless: options\.headless/u);
  assert.match(source, /Network\.setCacheDisabled/u);
});
