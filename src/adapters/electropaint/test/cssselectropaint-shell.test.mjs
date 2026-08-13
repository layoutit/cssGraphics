// SPDX-License-Identifier: GPL-2.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adapterRoot } from "../src/prepare/cssselectropaint/paths.mjs";

test("product shell identifies the route and avoids alternate or paint-heavy renderers", async () => {
  const [html, css, player, client, snapshotMount] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/preparedPlayback.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssselectropaint/polycssScene.mjs"), "utf8"),
  ]);
  assert.match(html, /css\.graphics\/electropaint/u);
  assert.doesNotMatch(html, /<canvas\b|<model-viewer\b/iu);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|mix-blend-mode/iu);
  assert.doesNotMatch(player, /Math\.random|requestAnimationFrame\s*\(|DOMMatrix|createElement/u);
  assert.match(player, /createPolyMorphPreparedDomTarget/u);
  assert.match(player, /shapes:\s*\[\],\s*\n\s*leaves:\s*quads\.map/u);
  assert.match(css, /--cssselectropaint-presentation-scale:\s*min\(/u);
  assert.match(css, /calc\(100dvw \/ 960px\)/u);
  assert.match(css, /calc\(\(50dvh - 2px\) \/ 311px\)/u);
  assert.match(css, /--cssselectropaint-inverse-presentation-scale:\s*calc\(/u);
  assert.match(css, /50% - calc\(35px \* var\(--cssselectropaint-presentation-scale\)\)/u);
  assert.match(css, /perspective:\s*1000px/u);
  assert.match(css, /transform:\s*translateY\(135px\) rotateX\(45deg\)/u);
  assert.doesNotMatch(css, /@media \(pointer:\s*coarse\)/u);
  assert.doesNotMatch(css, /--cssselectropaint-presentation-y/u);
  assert.match(css, /\.site-header \{[^}]*pointer-events:\s*none;/u);
  assert.doesNotMatch(css, /\.site-header \{[^}]*background:/u);
  assert.match(css, /\.site-wordmark \{[^}]*pointer-events:\s*auto;/u);
  assert.match(css, /\.site-action-icon-only \{[^}]*pointer-events:\s*auto;/u);
  assert.match(css, /#scene \{[^}]*position:\s*absolute;[^}]*inset:\s*0;/u);
  assert.match(css, /body\.loading::after \{[^}]*animation:\s*cssselectropaint-loading 0\.8s linear infinite;/u);
  assert.match(css, /@keyframes cssselectropaint-loading \{\s*to \{\s*transform:\s*rotate\(1turn\);/u);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\) \{\s*body\.loading::after \{\s*animation:\s*none;/u);
  assert.doesNotMatch(client, /ResizeObserver|style\.setProperty|PRESENTATION_VERTICAL_OFFSET_SOURCE_PIXELS/u);
  assert.match(client, /verticalCenterOffsetSourcePixels:\s*-35/u);
  assert.match(client, /runtimeStyleWriteCount:\s*0/u);
  assert.match(snapshotMount, /removeProperty\("perspective"\)/u);
  assert.match(snapshotMount, /removeProperty\("transform"\)/u);
});
