// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  createPinnedGalaxySourceUrl,
  ensureGalaxySourceFile,
} from "../src/prepare/cssgalaxy/sourceAuthority.mjs";

test("acquires a missing pinned source once and verifies its exact bytes", async () => {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "cssgalaxy-source-"));
  const bytes = Buffer.from("exact pinned source fixture\n");
  const source = Object.freeze({
    repository: "https://github.com/Zygo/xscreensaver",
    revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
    path: "hacks/galaxy.c",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  let fetchCount = 0;
  try {
    const fetchImpl = async (url) => {
      fetchCount += 1;
      assert.equal(url,
        "https://raw.githubusercontent.com/Zygo/xscreensaver/" +
        "906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/galaxy.c");
      return new Response(bytes, { status: 200 });
    };
    const first = await ensureGalaxySourceFile({ sourceRoot, source, fetchImpl });
    const second = await ensureGalaxySourceFile({ sourceRoot, source, fetchImpl });
    assert.equal(first, second);
    assert.deepEqual(await readFile(first), bytes);
    assert.equal(fetchCount, 1);
    assert.equal(createPinnedGalaxySourceUrl(source),
      "https://raw.githubusercontent.com/Zygo/xscreensaver/" +
      "906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/galaxy.c");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects source paths that can escape the pinned checkout", () => {
  for (const path of ["/hacks/galaxy.c", "../galaxy.c", "hacks/../galaxy.c", "hacks/"]) {
    assert.throws(() => createPinnedGalaxySourceUrl({
      repository: "https://github.com/Zygo/xscreensaver",
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      path,
    }), /source URL contract drifted/u);
  }
});
