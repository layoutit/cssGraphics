import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "src/cssmaze/styles.css"), "utf8");

test("css.graphics/maze uses the shipped cssGraphics product shell", () => {
  assert.match(html, /<title>css\.graphics\/maze<\/title>/u);
  assert.match(html, /rel="canonical" href="https:\/\/css\.graphics\/maze\/"/u);
  assert.match(html, /rel="icon" href="\/favicon\.ico" sizes="any"/u);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark" href="https:\/\/css\.graphics\/maze\/"/u);
  assert.match(html, /class="site-wordmark-path">\/maze<\/tspan>/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.equal((html.match(/class="site-action-icon-outline"/gu) ?? []).length, 2);
  assert.match(html, /<main id="scene"/u);
  assert.doesNotMatch(html, /<button\b|<nav\b|id="change-maze"|id="app"|id="status"|<section\b|<output\b/u);
  assert.match(css, /\.site-header \{/u);
  assert.match(css, /\.site-action-icon \{/u);
  assert.equal(
    (css.match(/background: linear-gradient\(180deg, #0b1119 0%, #000 100%\);/gu) ?? []).length,
    2,
  );
  assert.match(css, /\.site-header \{[^}]*position: fixed;[^}]*inset: 0 0 auto;[^}]*pointer-events: none;/u);
  assert.doesNotMatch(css, /\.site-header \{[^}]*background:/u);
  assert.match(css, /#scene \{[^}]*position: absolute;[^}]*inset: 0;/u);
  assert.match(css, /\.site-wordmark \{[^}]*pointer-events: auto;/u);
  assert.match(css, /\.site-action-icon-only \{[^}]*pointer-events: auto;/u);
  assert.match(css, /\.site-wordmark \{[^}]*color: #aeb4bc;/u);
  assert.doesNotMatch(css, /\.site-wordmark-svg text \{[^}]*(?:stroke|paint-order):/u);
  assert.match(css, /\.site-action-icon-outline \{[^}]*stroke: rgb\(0 0 0 \/ 60%\);[^}]*stroke-width: 4;/u);
  assert.doesNotMatch(css, /@keyframes|will-change/u);
});
