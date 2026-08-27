// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const adapterRoot = resolve(import.meta.dirname, "..");

test("uses the shared css.graphics examples shell for the Chaos adapter", async () => {
  const [html, main, config, styles, projects] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/main.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "vite.config.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssdysts/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "../../../site/public/projects.json"), "utf8"),
  ]);
  const manifest = JSON.parse(projects);
  const project = manifest.projects.find(({ id }) => id === "chaos");
  assert.equal(project?.route, "/chaos/");
  assert.equal(project?.number, 11);
  assert.match(html, /<!-- cssgraphics-examples-sidebar -->/u);
  assert.match(html, /<main class="example-stage"/u);
  assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.match(main, /mountChaosClient\(requireExamplesStage\(\)\)/u);
  assert.match(config, /createExamplesShellPlugin\("chaos"\)/u);
  assert.match(styles, /\.example-stage \{[\s\S]*?background: #000;/u);
  assert.match(styles, /\.example-stage > \.polycss-camera/u);
});

test("contains no audition-only UI or runtime machinery", async () => {
  const [html, client] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssdysts/client.mjs"), "utf8"),
  ]);
  assert.equal((html.match(/<button\b/gu) ?? []).length, 0);
  assert.doesNotMatch(html, /lab-ui|review-controls|review-output|loading-label/u);
  assert.doesNotMatch(client,
    /localStorage|installReviewControls|loadRemovedSystemIds|saveRemovedSystemIds/u);
  assert.doesNotMatch(client, /createElement|createDocumentFragment/u);
});
