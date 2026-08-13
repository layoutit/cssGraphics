import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(siteRoot, "..");
const expectedProjects = [
  ["electropaint", 5, "David A. Tristram / SGI", "2026-08-10"],
  ["menger", 4, "XScreenSaver", "2026-08-13"],
  ["maze", 3, "XScreenSaver", "2026-08-09"],
  ["gears", 2, "XScreenSaver", "2026-08-07"],
  ["pipes", 1, "Original", "2026-08-06"],
];
const hiddenLandingProjects = ["flowerbox", "gravitywell"];
const projectAdapterDirectories = new Map([
  ["electropaint", "electropaint"],
  ["flowerbox", "flowerbox"],
  ["gravitywell", "gravitywell"],
  ["menger", "menger"],
  ["maze", "maze"],
  ["gears", "gears"],
  ["pipes", "3dpipes"],
]);

test("landing presents the current deployed collection", async () => {
  const [html, main, projectSource, projectManifestText] = await Promise.all([
    readFile(resolve(siteRoot, "index.html"), "utf8"),
    readFile(resolve(siteRoot, "main.ts"), "utf8"),
    readFile(resolve(siteRoot, "projects.ts"), "utf8"),
    readFile(resolve(siteRoot, "public/projects.json"), "utf8"),
  ]);
  const projectManifest = JSON.parse(projectManifestText);
  assert.equal(projectManifest.schema, "cssgraphics.projects@2");
  assert.deepEqual(
    projectManifest.projects.map(({ id, number, source, date }) => [id, number, source, date]),
    expectedProjects,
  );
  assert.equal(new Set(projectManifest.projects.map(({ id }) => id)).size, expectedProjects.length);
  assert.equal(new Set(projectManifest.projects.map(({ number }) => number)).size,
    expectedProjects.length);
  assert.deepEqual(
    projectManifest.projects.filter(({ id }) => hiddenLandingProjects.includes(id)),
    [],
  );
  for (const [id, number, source, date] of expectedProjects) {
    const project = projectManifest.projects.find((entry) => entry.id === id);
    assert.equal(project.number, number);
    assert.equal(project.route, `/${id}/`);
    assert.equal(project.preview, `/landing/${id}.webp`);
    assert.equal(project.source, source);
    assert.equal(project.date, date);
    await readFile(resolve(siteRoot, `public/landing/${id}.webp`));
  }
  assert.doesNotMatch(
    `${html}\n${main}\n${projectSource}\n${projectManifestText}`,
    /animated-morph-sphere|webgl-morphtargets|morph-stress-test/u,
  );
  assert.match(main, /link\.href = project\.route/u);
  assert.match(main, /title\.textContent = project\.name/u);
  assert.match(main, /String\(project\.number\)\.padStart\(3, "0"\)/u);
  assert.match(main, /source\.textContent = project\.source/u);
  assert.match(main, /date\.dateTime = project\.date/u);
  assert.match(projectSource, /projectManifest\.projects\.length - index/u);
  assert.doesNotMatch(`${html}\n${main}`, /iframe|canvas|<code|<pre/u);
});

test("landing is only the shared shell and linked project thumbnails", async () => {
  const [html, siteCss] = await Promise.all([
    readFile(resolve(siteRoot, "index.html"), "utf8"),
    readFile(resolve(siteRoot, "site.css"), "utf8"),
  ]);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark-svg"/u);
  assert.match(html, /class="site-wordmark-dot"/u);
  assert.match(html, /class="site-brand-mark"/u);
  assert.match(html, /class="site-brand-mark-inner"/u);
  assert.match(html, /class="site-brand-mark-inner-secondary"/u);
  assert.match(html, /class="site-brand-mark-inner-tertiary"/u);
  assert.match(html, /class="site-brand-mark-outer"/u);
  assert.match(html, /commons\.wikimedia\.org\/wiki\/File:Benzol\.svg/u);
  assert.match(html, /class="site-brand-copy"/u);
  assert.match(html, /class="site-github-link"/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.match(html, /aria-label="View cssGraphics on GitHub"/u);
  assert.match(html, /viewBox="0 0 130 30"/u);
  assert.match(html, /class="site-subtitle"/u);
  assert.match(html, /Self-contained 3D scenes powered by/u);
  assert.match(html, />PolyCSS<\/a>/u);
  assert.match(html, /class="site-subtitle-sparkle"/u);
  assert.match(html, /href="https:\/\/github\.com\/LayoutitStudio\/polycss"/u);
  assert.match(html, /class="site-divider"/u);
  assert.doesNotMatch(html, /site-actions|site-action-icon/u);
  assert.match(html, /class="thumbnail-gallery"/u);
  assert.match(html, /id="asset-list"/u);
  assert.doesNotMatch(
    html,
    /code-panel|assets-sidebar|viewer|asset-stage|landing-mark/u,
  );
  assert.doesNotMatch(siteCss, /\.project-thumbnail::after/u);
  assert.match(siteCss, /\.project-thumbnail img \{[\s\S]*?background: #000;/u);
  assert.match(siteCss, /\.site-header \{[\s\S]*?position: relative;/u);
  assert.match(siteCss, /grid-template-columns: repeat\(5, minmax\(0, 386px\)\)/u);
});

test("every deployed project wordmark links back to the landing", async () => {
  for (const [id, adapterDirectory] of projectAdapterDirectories) {
    const html = await readFile(
      resolve(repositoryRoot, "src/adapters", adapterDirectory, "index.html"),
      "utf8",
    );
    assert.match(
      html,
      /<a\b(?=[^>]*\bclass="site-wordmark")(?=[^>]*\bhref="\/")[^>]*>/u,
      `${id} wordmark must link to the root landing`,
    );
  }
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
    /CSSMAZE_DEPLOY_BUILD=1 pnpm build:maze && CSSSELECTROPAINT_DEPLOY_BUILD=1 pnpm build:electropaint && CSSGRAPHICS_DEPLOY_BUILD=1 pnpm build:site/u,
  );
  assert.match(
    packageManifest,
    /"prepare:electropaint:deploy": "pnpm prepare:electropaint:artifact"/u,
  );
  assert.match(viteConfig, /emptyOutDir: !deployBuild/u);
});
