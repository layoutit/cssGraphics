import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("cloth uses the cssGraphics shell without source controls", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /site-wordmark-css[^>]*>css\.<[\s\S]*site-wordmark-graphics[^>]*>graphics</);
  assert.match(html, /\/cloth/);
  assert.doesNotMatch(html, /canvas|dat\.gui|stats/i);
  assert.equal((html.match(/<script\b/gu) ?? []).length, 1);
});

test("runtime has no per-frame geometry or raster construction", async () => {
  const client = await readFile(new URL("src/csscloth/client.mjs", root), "utf8");
  const shadowTarget = await readFile(new URL("src/shared/csscloth/morphShadowPatch.mjs", root), "utf8");
  const textureTarget = await readFile(new URL("src/shared/csscloth/morphTexturePatch.mjs", root), "utf8");
  const styles = await readFile(new URL("src/csscloth/styles.css", root), "utf8");
  assert.doesNotMatch(client, /canvas|getContext|createElement\(["'](?:s|b|div)["']/);
  assert.doesNotMatch(client, /setTimeout|clearTimeout/u);
  assert.doesNotMatch(client, /Math\.random/u);
  assert.match(client, /fetch\("\/csscloth\/prepared\.json", \{ cache: "no-store" \}\)/u);
  assert.match(client, /selectClothStartingBank/u);
  assert.match(client, /player\.seekFrame\(0\)/u);
  assert.match(client, /requestAnimationFrame/u);
  assert.match(client, /continuous-requestAnimationFrame-prepared-bank-publication/u);
  assert.match(client, /publicationTime \+ schedulerLeadMilliseconds \+ 0\.75 < nextFrameAt/u);
  assert.match(client, /prefetchNextBank/u);
  assert.match(client, /prefetchedPlayback/u);
  assert.match(client, /shadowTarget\.setPlayback\(playback\)/u);
  assert.match(client, /publish\(lastFrameIndex \+ 1\)/u);
  assert.doesNotMatch(client, /Math\.floor\([^\n]*frameMilliseconds/u);
  assert.match(client, /createPolyMorphPreparedDomTarget/);
  assert.match(client, /mounted\.modelElement\.remove\(\)/u);
  assert.match(client, /loadClothPreparedPlayback/);
  assert.match(client, /textureLeafSizing !== "raster"/);
  assert.doesNotMatch(client, /backgroundRepeat|backgroundSize/);
  assert.match(client, /runtimeGeometryConstructionCount: 0/);
  assert.match(shadowTarget, /createPolyMorphPreparedDomTarget/);
  assert.match(shadowTarget, /shadowTransformOffsets/u);
  assert.doesNotMatch(shadowTarget, /frameIndex \* playback\.shadowTriangleCount/u);
  assert.doesNotMatch(shadowTarget, /computeParametricShadowSilhouette|canvas|getContext|createElement|requestAnimationFrame/);
  assert.doesNotMatch(textureTarget, /style\.setProperty\("corner-bottom-right-shape"/u);
  assert.match(textureTarget, /--csscloth-atlas/u);
  assert.match(textureTarget, /--csscloth-logo-atlas/u);
  assert.match(textureTarget, /--csscloth-logo-atlas-size/u);
  assert.match(textureTarget, /logoPositions/u);
  assert.match(client, /metadata\.renderer\.logoAtlas/u);
  assert.match(styles, /body > \.polycss-camera > \.polycss-scene > u/u);
  assert.match(styles, /background-image: var\(--csscloth-logo-atlas\), var\(--csscloth-atlas\)/u);
  assert.match(styles, /background-size: var\(--csscloth-logo-atlas-size\), var\(--csscloth-atlas-size\)/u);
  assert.match(styles, /-webkit-backface-visibility: visible/u);
  assert.match(styles, /body\.loading::after/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /transform-style: preserve-3d/u);
  assert.match(client, /mounted\.sceneElement\.append\(leaf\)/u);
  assert.match(client, /shape\.remove\(\)/u);
  assert.match(styles, /corner-top-left-shape: bevel/u);
  assert.match(styles, /corner-top-right-shape: bevel/u);
  assert.match(client, /target\.leaves\[triangleIndex\]\.writeTransform/u);
  assert.doesNotMatch(styles, /transform: matrix3d\(1, 0, 0, 0, 0, 1/u);
  assert.doesNotMatch(textureTarget, /canvas|getContext|createElement|requestAnimationFrame/u);
});

test("source identity and licenses are pinned", async () => {
  const lock = JSON.parse(await readFile(new URL("notes/references/source-lock.json", root), "utf8"));
  assert.equal(lock.revision, "e62b253081438c030d6af1ee3c3346a89124f277");
  assert.equal(lock.license.spdx, "MIT");
  assert.equal(lock.groundTextureNotice.license, "CC-BY-3.0");
  assert.equal(lock.cssLogo.revision, "48f24dccd4e169118d17bab998c3d276e95167df");
  assert.equal(lock.cssLogo.license, "CC0-1.0");
  assert.equal(lock.cssLogo.sha256, "28dceb38651b6d3d43119bae6f56dc6dd76415cfedd4a718afcd61fc7bec8ba3");
});
