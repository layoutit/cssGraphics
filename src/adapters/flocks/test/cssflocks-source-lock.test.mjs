import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adapterRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../../../", import.meta.url);

test("Flocks source lock pins the official geometry-one defaults", async () => {
  const lock = JSON.parse(await readFile(new URL("notes/references/source-lock.json", adapterRoot), "utf8"));
  assert.equal(lock.schema, "cssflocks-source-lock@1");
  assert.equal(lock.repository, "https://github.com/reallyslickscreensavers/reallyslickscreensavers");
  assert.match(lock.revision, /^[0-9a-f]{40}$/u);
  assert.match(lock.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(lock.license, "GPL-2.0-or-later");
  assert.deepEqual(lock.defaults, {
    leaders: 4,
    followers: 1000,
    geometry: 1,
    size: 5,
    complexity: 1,
    speed: 15,
    stretch: 20,
    colorFadeSpeed: 15,
    chromatek: 0,
    connections: 0,
  });
  assert.deepEqual(lock.sourceGeometry, {
    primitive: "gluSphere",
    radius: 2.5,
    slices: 3,
    stacks: 2,
    preparedTriangleFaces: 6,
  });
  assert.equal(lock.adapter.sourceOracle, "compiled-pinned-source-state-and-gl-transform-oracle");
  assert.equal(lock.adapter.visualReference, "compiled-pinned-source-glu-frame-sequence");
  assert.equal(lock.adapter.browserComparison, "strict-prepared-state-projection-and-continuity-with-diagnostic-rgb");
  assert.equal(lock.adapter.terminalLoop, "prepare-only-eight-second-cubic-hermite-correspondence-deviation");
  assert.equal(lock.adapter.mobileDeviceCadence, "unproven");
});

test("ignored local Flocks source matches the pinned bytes when present", async (context) => {
  const sourceUrl = new URL(`.local/reallyslickscreensavers/src/flocks/flocks.cpp`, repositoryRoot);
  let bytes;
  try {
    bytes = await readFile(sourceUrl);
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("ignored upstream checkout is not present");
      return;
    }
    throw error;
  }
  const lock = JSON.parse(await readFile(new URL("notes/references/source-lock.json", adapterRoot), "utf8"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), lock.sha256);
  const source = bytes.toString("utf8");
  for (const statement of [
    "dLeaders = 4;",
    "dFollowers = 1000;",
    "dGeometry = 1;",
    "dComplexity = 1;",
    "gluSphere(qobj, float(dSize) * 0.5f, dComplexity + 2, dComplexity + 1);",
  ]) assert.ok(source.includes(statement), `missing pinned source statement: ${statement}`);
});
