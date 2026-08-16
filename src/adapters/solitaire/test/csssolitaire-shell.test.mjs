import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { adapterRoot } from "../src/prepare/csssolitaire/paths.mjs";

test("product shell is the standard css.graphics route without demo controls", async () => {
  const [html, css, client, player, snapshotMount] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssolitaire/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssolitaire/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssolitaire/preparedPlayback.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssolitaire/polycssScene.mjs"), "utf8"),
  ]);
  assert.match(html, /css\.graphics\/solitaire/u);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark-svg"/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.match(html, /<main id="scene"/u);
  assert.doesNotMatch(html, /<button\b|<nav\b|<section\b|<output\b|<canvas\b/u);
  assert.match(css, /\.site-header \{[^}]*position: fixed;[^}]*pointer-events: none;/u);
  assert.match(css, /\.site-wordmark \{[^}]*pointer-events: auto;/u);
  assert.match(css, /\.site-wordmark \{[^}]*color: #aeb4bc;/u);
  assert.match(css, /\.site-action-icon-only \{[^}]*pointer-events: auto;/u);
  assert.equal(
    (css.match(/background: linear-gradient\(180deg, #008000 0%, #003d00 100%\);/gu) ?? []).length,
    2,
  );
  assert.match(css, /#scene \{[^}]*position: absolute;[^}]*inset: 0;[^}]*contain: layout paint size style;/u);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|mix-blend-mode/iu);
  assert.match(client, /loadPreparedSolitaire/u);
  assert.match(client, /state\.player\.resume\(\)/u);
  assert.doesNotMatch(client, /prefers-reduced-motion/u);
  assert.match(player, /createPolyMorphPreparedDomTarget/u);
  assert.match(player, /deadline-setTimeout-prepared-visibility-publication/u);
  assert.doesNotMatch(player, /Math\.random|requestAnimationFrame\s*\(|createElement|DOMMatrix/u);
  assert.match(snapshotMount, /new ResizeObserver\(updatePresentation\)/u);
  assert.match(snapshotMount, /host\.clientWidth/u);
  assert.match(snapshotMount, /host\.clientHeight/u);
  assert.match(snapshotMount, /--csssolitaire-presentation-scale/u);
  assert.match(snapshotMount, /single-root-presentation-scale-only/u);
  assert.match(snapshotMount, /runtimeGeometryBoundsCalculationCount: 0/u);
  assert.doesNotMatch(snapshotMount, /renderer\.contentBounds/u);
});
