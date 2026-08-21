import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(siteRoot, "..");
const expectedProjects = [
  ["cloth", 7, "Three.js", "2026-08-20", "The Three.js cloth simulation"],
  ["solitaire", 6, "Classic Solitaire", "2026-08-17", "The classic Solitaire victory cascade"],
  ["electropaint", 5, "David Tristram", "2026-08-10", "ElectroPaint, originally written by David Tristram"],
  ["menger", 4, "XScreenSaver", "2026-08-13", "XScreenSaver Menger"],
  ["maze", 3, "XScreenSaver", "2026-08-09", "XScreenSaver Maze3D"],
  ["gears", 2, "XScreenSaver", "2026-08-07", "XScreenSaver Gears"],
  ["pipes", 1, "Original", "2026-08-06", "CSS Pipes"],
];
const projectsExcludedFromLanding = ["flowerbox", "gravitywell"];
const projectAdapterDirectories = new Map([
  ["cloth", "cloth"],
  ["electropaint", "electropaint"],
  ["flowerbox", "flowerbox"],
  ["gravitywell", "gravitywell"],
  ["menger", "menger"],
  ["maze", "maze"],
  ["gears", "gears"],
  ["pipes", "3dpipes"],
  ["solitaire", "solitaire"],
]);

test("landing presents the current deployed collection", async () => {
  const [html, main, projectSource, rendererSource, viteConfig, projectManifestText] = await Promise.all([
    readFile(resolve(siteRoot, "index.html"), "utf8"),
    readFile(resolve(siteRoot, "main.ts"), "utf8"),
    readFile(resolve(siteRoot, "projects.ts"), "utf8"),
    readFile(resolve(siteRoot, "render-projects.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "vite.config.ts"), "utf8"),
    readFile(resolve(siteRoot, "public/projects.json"), "utf8"),
  ]);
  const projectManifest = JSON.parse(projectManifestText);
  assert.equal(projectManifest.schema, "cssgraphics.projects@2");
  assert.deepEqual(
    projectManifest.projects.map(({ id, number, source, date }) => [id, number, source, date]),
    expectedProjects.map(([id, number, source, date]) => [id, number, source, date]),
  );
  assert.equal(new Set(projectManifest.projects.map(({ id }) => id)).size, expectedProjects.length);
  assert.equal(new Set(projectManifest.projects.map(({ number }) => number)).size,
    expectedProjects.length);
  assert.deepEqual(
    projectManifest.projects.filter(({ id }) => projectsExcludedFromLanding.includes(id)),
    [],
  );
  for (const [id, number, source, date, descriptionPrefix] of expectedProjects) {
    const project = projectManifest.projects.find((entry) => entry.id === id);
    assert.equal(project.number, number);
    assert.equal(project.route, `/${id}/`);
    assert.equal(project.preview, `/landing/${id}.webp`);
    assert.equal(project.source, source);
    assert.equal(project.date, date);
    assert.ok(project.description.startsWith(descriptionPrefix));
    assert.ok(project.description.length >= 40);
    await readFile(resolve(siteRoot, `public/landing/${id}.webp`));
  }
  assert.doesNotMatch(
    `${html}\n${main}\n${projectSource}\n${rendererSource}\n${projectManifestText}`,
    /animated-morph-sphere|webgl-morphtargets|morph-stress-test/u,
  );
  assert.equal(main.trim(), 'import "./site.css";');
  assert.doesNotMatch(main, /createElement|appendChild|PROJECTS/u);
  assert.match(rendererSource, /<a class="project-thumbnail" href=/u);
  assert.match(rendererSource, /alt="\$\{escapeAttribute\(project\.description\)\}"/u);
  assert.match(rendererSource, /loading="lazy" fetchpriority="low"/u);
  assert.match(rendererSource, /fetchpriority="high"/u);
  assert.match(rendererSource, /"@type": "WebSite"/u);
  assert.match(rendererSource, /"@type": "ItemList"/u);
  assert.match(viteConfig, /transformIndexHtml\(html\)/u);
  assert.match(viteConfig, /renderLandingProjectCards\(PROJECTS\)/u);
  assert.match(html, /cssgraphics-projects/u);
  assert.match(html, /cssgraphics-structured-data/u);
  assert.match(projectSource, /projectManifest\.projects\.length - index/u);
  assert.match(projectSource, /project\.description\.length < 40/u);
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
  assert.match(html, /<h1 class="site-subtitle">/u);
  assert.match(html, /Self-contained 3D scenes powered by/u);
  assert.match(html, />PolyCSS<\/a>/u);
  assert.match(html, /class="site-subtitle-sparkle"/u);
  assert.match(html, /href="https:\/\/github\.com\/LayoutitStudio\/polycss"/u);
  assert.match(html, /class="site-divider"/u);
  assert.match(html, /<title>css\.graphics - Powered by PolyCSS<\/title>/u);
  assert.match(html, /property="og:image" content="https:\/\/css\.graphics\/landing\/pipes\.webp"/u);
  assert.match(html, /name="twitter:card" content="summary_large_image"/u);
  assert.doesNotMatch(html, /site-actions|site-action-icon/u);
  assert.match(html, /class="thumbnail-gallery"/u);
  assert.match(html, /id="asset-list"/u);
  assert.doesNotMatch(
    html,
    /code-panel|assets-sidebar|viewer|asset-stage|landing-mark/u,
  );
  assert.doesNotMatch(siteCss, /\.project-thumbnail::after/u);
  assert.match(siteCss, /\.project-thumbnail img \{[\s\S]*?background: #000;/u);
  assert.match(siteCss, /\[href="\/cloth\/"\] \.project-title/u);
  assert.match(siteCss, /\[href="\/maze\/"\] \.project-title/u);
  assert.match(siteCss, /\.site-header \{[\s\S]*?position: relative;/u);
  assert.match(siteCss, /\.site-brand \{[^}]*max-width: calc\(100% - 58px\);/u);
  assert.match(siteCss, /\.site-wordmark-svg \{[^}]*max-width: 100%;/u);
  assert.match(
    siteCss,
    /@media \(max-width: 440px\) \{[\s\S]*?\.site-brand \{[^}]*max-width: calc\(100% - 54px\);/u,
  );
  assert.match(
    siteCss,
    /@media \(max-width: 440px\) \{[\s\S]*?\.site-brand-mark \{[^}]*align-self: flex-start;[^}]*margin-top: 11px;/u,
  );
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
    assert.match(html, /<h1 class="site-wordmark-heading">/u);
  }
});

test("every deployed project is advertised for indexing while the landing remains curated", async () => {
  const sitemap = await readFile(resolve(siteRoot, "public/sitemap.xml"), "utf8");
  for (const [id, adapter] of projectAdapterDirectories) {
    assert.match(sitemap, new RegExp(`<loc>https://css\\.graphics/${id}/</loc>`, "u"));
    const html = await readFile(resolve(repositoryRoot, "src/adapters", adapter, "index.html"), "utf8");
    assert.match(html, /<meta name="robots" content="index, follow"/u);
    assert.match(html, /<meta property="og:image" content="https:\/\/css\.graphics\//u);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/css\.graphics\//u);
    assert.match(html, /<title>[^<]+ - Powered by PolyCSS<\/title>/u);
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
    /CSSGRAVITYWELL_DEPLOY_BUILD=1 pnpm build:gravitywell && CSSCYCLONE_DEPLOY_BUILD=1 pnpm build:cyclone && CSSMENGER_DEPLOY_BUILD=1 pnpm build:menger/u,
  );
  assert.match(packageManifest, /pnpm prepare:cloth:artifact/u);
  assert.match(packageManifest, /CSSCLOTH_DEPLOY_BUILD=1 pnpm build:cloth/u);
  assert.ok(
    netlify.indexOf('for = "/csscloth/*"') <
      netlify.indexOf('for = "/csscloth/playback-bank-*"'),
    "Cloth hash-named bank headers must override the broad metadata rule",
  );
  assert.ok(
    netlify.indexOf('for = "/csscloth/*"') <
      netlify.indexOf('for = "/csscloth/model/cloth/assets/*"'),
    "Cloth hash-named texture headers must override the broad metadata rule",
  );
  assert.ok(
    netlify.indexOf('for = "/csscloth/*"') <
      netlify.indexOf('for = "/csscloth/mobile/playback-bank-*"'),
    "Mobile Cloth bank headers must override the broad metadata rule",
  );
  assert.ok(
    netlify.indexOf('for = "/csscloth/*"') <
      netlify.indexOf('for = "/csscloth/mobile/model/cloth-mobile/assets/*"'),
    "Mobile Cloth texture headers must override the broad metadata rule",
  );
  assert.match(
    packageManifest,
    /"prepare:electropaint:deploy": "pnpm prepare:electropaint:artifact"/u,
  );
  assert.match(viteConfig, /emptyOutDir: !deployBuild/u);
});
