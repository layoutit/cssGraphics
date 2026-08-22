import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "src/cssmaze/styles.css"), "utf8");

test("css.graphics/maze uses the shipped cssGraphics product shell", () => {
  assert.match(html, /<title>Maze - Powered by PolyCSS<\/title>/u);
  assert.match(html, /rel="canonical" href="https:\/\/css\.graphics\/maze\/"/u);
  assert.match(html, /rel="icon" href="\/favicon\.ico" sizes="any"/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main id="scene" class="example-stage"/u);
  assert.doesNotMatch(html, /iframe|site-header/u);
  assert.doesNotMatch(html, /<button\b|<nav\b|id="change-maze"|id="app"|id="status"|<section\b|<output\b/u);
  assert.doesNotMatch(css, /\.site-(?:header|wordmark|action)/u);
  assert.equal(
    (css.match(/background: linear-gradient\(180deg, #0b1119 0%, #000 100%\);/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(css, /#scene \{[^}]*(?:position|inset):/u);
  assert.doesNotMatch(css, /@keyframes|will-change/u);
});
