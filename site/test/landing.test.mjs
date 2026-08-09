import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(siteRoot, "..");
const projectSlugs = [
  "gravitywell",
  "maze",
  "menger",
  "gears",
  "flowerbox",
  "pipes",
];

test("landing presents the current deployed collection", async () => {
  const [html, main] = await Promise.all([
    readFile(resolve(siteRoot, "index.html"), "utf8"),
    readFile(resolve(siteRoot, "main.ts"), "utf8"),
  ]);
  for (const slug of projectSlugs) {
    assert.match(main, new RegExp(`route: "/${slug}/"`, "u"));
    assert.match(main, new RegExp(`preview: "/landing/${slug}\\.webp"`, "u"));
  }
  assert.doesNotMatch(
    `${html}\n${main}`,
    /animated-morph-sphere|webgl-morphtargets|morph-stress-test/u,
  );
  assert.match(main, /link\.href = project\.route/u);
  assert.match(main, /title\.textContent = project\.name/u);
  assert.match(main, /padStart\(3, "0"\)/u);
  assert.ok(
    projectSlugs.every((slug, index) => (
      index === 0 || main.indexOf(`route: "/${projectSlugs[index - 1]}/"`)
        < main.indexOf(`route: "/${slug}/"`)
    )),
    "projects are ordered newest first",
  );
  assert.doesNotMatch(`${html}\n${main}`, /iframe|canvas|<code|<pre/u);
});

test("landing is only the shared shell and linked project thumbnails", async () => {
  const html = await readFile(resolve(siteRoot, "index.html"), "utf8");
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark-svg"/u);
  assert.match(html, /class="site-actions"/u);
  assert.match(html, /class="thumbnail-gallery"/u);
  assert.match(html, /id="asset-list"/u);
  assert.doesNotMatch(
    html,
    /code-panel|assets-sidebar|viewer|asset-stage|landing-mark/u,
  );
});

test("deployment serves the landing at the root", async () => {
  const [netlify, packageManifest, viteConfig] = await Promise.all([
    readFile(resolve(repositoryRoot, "netlify.toml"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "vite.config.ts"), "utf8"),
  ]);
  assert.doesNotMatch(netlify, /to\s*=\s*"\/pipes\/"/u);
  assert.match(
    packageManifest,
    /CSSMAZE_DEPLOY_BUILD=1 pnpm build:maze && CSSGRAPHICS_DEPLOY_BUILD=1 pnpm build:site/u,
  );
  assert.match(viteConfig, /emptyOutDir: !deployBuild/u);
});
