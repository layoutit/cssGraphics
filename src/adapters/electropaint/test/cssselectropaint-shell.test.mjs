// SPDX-License-Identifier: GPL-2.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adapterRoot } from "../src/prepare/cssselectropaint/paths.mjs";

test("product shell identifies the route and avoids alternate or paint-heavy renderers", async () => {
  const [html, css, player, client] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/preparedPlayback.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/client.mjs"), "utf8"),
  ]);
  assert.match(html, /css\.graphics\/electropaint/u);
  assert.doesNotMatch(html, /<canvas\b|<model-viewer\b/iu);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|mix-blend-mode/iu);
  assert.doesNotMatch(player, /Math\.random|requestAnimationFrame\s*\(|DOMMatrix|createElement/u);
  assert.match(player, /createPolyMorphPreparedDomTarget/u);
  assert.match(player, /shapes:\s*\[\],\s*\n\s*leaves:\s*quads\.map/u);
  assert.match(css, /top:\s*calc\(50% \+ var\(--cssselectropaint-presentation-y, 0px\)\)/u);
  assert.match(css, /\.site-header \{[^}]*pointer-events:\s*none;/u);
  assert.doesNotMatch(css, /\.site-header \{[^}]*background:/u);
  assert.match(css, /\.site-wordmark \{[^}]*pointer-events:\s*auto;/u);
  assert.match(css, /\.site-action-icon-only \{[^}]*pointer-events:\s*auto;/u);
  assert.match(css, /#scene \{[^}]*position:\s*absolute;[^}]*inset:\s*0;/u);
  assert.match(client, /PRESENTATION_VERTICAL_OFFSET_SOURCE_PIXELS = -45/u);
});
