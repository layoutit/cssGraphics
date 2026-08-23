import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adapterRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(adapterRoot, "index.html"), "utf8");
const css = readFileSync(join(adapterRoot, "src/cssgears/styles.css"), "utf8");

test("css.graphics/gears uses the shared examples shell", () => {
  assert.match(html, /<title>Gears - Powered by PolyCSS<\/title>/u);
  assert.match(html, /rel="canonical" href="https:\/\/css\.graphics\/gears\/"/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main id="scene" class="example-stage"><\/main>/u);
  assert.doesNotMatch(html, /iframe|site-header/u);
  assert.doesNotMatch(html, /<nav\b|<section\b|<output\b|id="app"|id="status"/u);
  assert.doesNotMatch(css, /\.site-(?:header|wordmark|action)/u);
  assert.equal(
    (
      css.match(
        /background: linear-gradient\(180deg, #0b1119 0%, #000 100%\);/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(css, /animation: cssgears-loading 0\.8s linear infinite;/u);
  assert.match(css, /@keyframes cssgears-loading/u);
  assert.doesNotMatch(css, /will-change/u);
});
