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
  assert.match(html, /<title>Solitaire - Powered by PolyCSS<\/title>/u);
  assert.match(html, /property="og:title" content="Solitaire - Powered by PolyCSS"/u);
  assert.match(html, /name="twitter:title" content="Solitaire - Powered by PolyCSS"/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.doesNotMatch(html, /aria-busy/u);
  assert.doesNotMatch(html, /iframe|site-header|<button\b|<nav\b|<section\b|<output\b|<canvas\b/u);
  assert.doesNotMatch(css, /\.site-(?:header|wordmark|action)/u);
  assert.equal(
    (css.match(/background: linear-gradient\(180deg, #008000 0%, #003d00 100%\);/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(css, /csssolitaire-loading|prefers-reduced-motion/u);
  assert.match(css,
    /\.example-stage > \.polycss-camera \{[^}]*position: absolute;[^}]*inset: 0;[^}]*contain: layout paint size style;/u);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|mix-blend-mode/iu);
  assert.match(client, /loadPreparedSolitaire/u);
  assert.match(client, /state\.player\.resume\(\)/u);
  assert.match(client, /new ResizeObserver\(syncPresentation\)/u);
  assert.match(client, /host\.clientWidth/u);
  assert.match(client, /host\.clientHeight/u);
  assert.doesNotMatch(client, /aria-busy/u);
  assert.doesNotMatch(client, /getElementById\("scene"\)|querySelector\("#scene"\)/u);
  assert.doesNotMatch(client, /prefers-reduced-motion/u);
  assert.match(player, /createPolyMorphPreparedDomTarget/u);
  assert.match(player, /deadline-setTimeout-prepared-visibility-publication/u);
  assert.doesNotMatch(player, /Math\.random|requestAnimationFrame\s*\(|createElement|DOMMatrix/u);
  assert.doesNotMatch(player, /lane-/u);
  assert.match(player, /prepared-layout-inline-matrix-resolution/u);
  assert.match(player, /return `matrix\(0,/u);
  assert.match(snapshotMount, /runtimeGeometryBoundsCalculationCount: 0/u);
  assert.match(snapshotMount, /host\.append\(mountedCamera\)/u);
  assert.doesNotMatch(snapshotMount, /host\.replaceChildren/u);
  assert.doesNotMatch(snapshotMount, /renderer\.contentBounds/u);
});
