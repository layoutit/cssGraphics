import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adapterRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(adapterRoot, "index.html"), "utf8");
const css = readFileSync(join(adapterRoot, "src/cssgears/styles.css"), "utf8");

test("css.graphics/gears uses the cssPipes product shell", () => {
  assert.match(html, /<title>css\.graphics\/gears<\/title>/u);
  assert.match(html, /rel="canonical" href="https:\/\/css\.graphics\/gears\/"/u);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark" href="\/" aria-label="css\.graphics home"/u);
  assert.match(html, /class="site-wordmark-path">\/gears<\/tspan>/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.match(html, /<main id="scene"><\/main>/u);
  assert.doesNotMatch(html, /<nav\b|<section\b|<output\b|id="app"|id="status"/u);
  assert.equal((html.match(/aria-label=/gu) ?? []).length, 2);
  assert.match(css, /\.site-header \{/u);
  assert.match(css, /\.site-action-icon \{/u);
  assert.equal(
    (
      css.match(
        /background: linear-gradient\(180deg, #0b1119 0%, #000 100%\);/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(css, /@keyframes|will-change/u);
});
