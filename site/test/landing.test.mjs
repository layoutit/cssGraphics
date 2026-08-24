import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(siteRoot, "..");
const expectedProjects = [
  ["galaxy", 9, "XScreenSaver", "2026-08-23", "XScreenSaver Galaxy"],
  ["cyclone", 8, "Really Slick", "2026-08-22", "Really Slick Cyclone rendered"],
  ["cloth", 7, "three.js", "2026-08-20", "The Three.js cloth simulation"],
  ["solitaire", 6, "Classic Solitaire", "2026-08-17", "The classic Solitaire victory cascade"],
  ["electropaint", 5, "David A. Tristram", "2026-08-10", "ElectroPaint, originally written by David A. Tristram"],
  ["menger", 4, "XScreenSaver", "2026-08-13", "Menger Sponge rendered"],
  ["maze", 3, "XScreenSaver", "2026-08-09", "Maze3D rendered"],
  ["gears", 2, "XScreenSaver", "2026-08-07", "Gears rendered"],
  ["pipes", 1, "Original", "2026-08-06", "CSS Pipes"],
];
const projectsExcludedFromLanding = ["flowerbox", "gravitywell"];
const expectedNumberTones = new Map([
  ["galaxy", "light"],
  ["cyclone", "light"],
  ["cloth", "dark"],
  ["solitaire", "light"],
  ["electropaint", "light"],
  ["menger", "light"],
  ["maze", "light"],
  ["gears", "light"],
  ["pipes", "light"],
]);
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
  ["flocks", "flocks"],
  ["cyclone", "cyclone"],
  ["galaxy", "galaxy"],
]);

test("landing presents the current deployed collection", async () => {
  const [homePage, layout, sceneRouter, projectSource, rendererSource, shellRenderer, astroConfig, projectManifestText] = await Promise.all([
    readFile(resolve(siteRoot, "pages/index.astro"), "utf8"),
    readFile(resolve(siteRoot, "layouts/ExamplesLayout.astro"), "utf8"),
    readFile(resolve(siteRoot, "scene-router.mjs"), "utf8"),
    readFile(resolve(siteRoot, "projects.ts"), "utf8"),
    readFile(resolve(siteRoot, "render-projects.ts"), "utf8"),
    readFile(resolve(siteRoot, "examples-shell-plugin.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "astro.config.mjs"), "utf8"),
    readFile(resolve(siteRoot, "public/projects.json"), "utf8"),
  ]);
  const projectManifest = JSON.parse(projectManifestText);
  assert.equal(projectManifest.schema, "cssgraphics.projects@2");
  assert.doesNotMatch(projectManifestText, /Windows 3D Pipes/u);
  assert.equal(projectManifest.projects.find(({ id }) => id === "cyclone").credits[0].name, "Really Slick");
  assert.doesNotMatch(projectManifestText, /David Tristram/u);
  assert.doesNotMatch(projectManifestText, /three\.js examples/u);
  assert.match(projectManifestText, /David A\. Tristram/u);
  assert.deepEqual(
    projectManifest.projects.map(({ id, number, source, date }) => [id, number, source, date]),
    expectedProjects.map(([id, number, source, date]) => [id, number, source, date]),
  );
  assert.equal(new Set(projectManifest.projects.map(({ id }) => id)).size, expectedProjects.length);
  assert.equal(new Set(projectManifest.projects.map(({ number }) => number)).size,
    expectedProjects.length);
  assert.deepEqual(projectManifest.unlistedProjects.map(({ id, number }) => [id, number]), [["flocks", 10]]);
  assert.equal(projectManifest.projects.some(({ id }) => id === "flocks"), false);
  assert.deepEqual(
    projectManifest.projects.filter(({ id }) => projectsExcludedFromLanding.includes(id)),
    [],
  );
  for (const [id, number, source, date, descriptionPrefix] of expectedProjects) {
    const project = projectManifest.projects.find((entry) => entry.id === id);
    assert.equal(project.number, number);
    assert.equal(project.route, `/${id}/`);
    assert.equal(project.preview, `/landing/${id}.webp`);
    assert.equal(project.numberTone, expectedNumberTones.get(id));
    assert.equal(project.source, source);
    assert.equal(project.date, date);
    assert.ok(project.description.startsWith(descriptionPrefix));
    assert.ok(project.description.length >= 40);
    await readFile(resolve(siteRoot, `public/landing/${id}.webp`));
    await readFile(resolve(siteRoot, `public/landing/sidebar/${id}.webp`));
  }
  assert.doesNotMatch(
    `${homePage}\n${layout}\n${sceneRouter}\n${projectSource}\n${rendererSource}\n${projectManifestText}`,
    /animated-morph-sphere|webgl-morphtargets|morph-stress-test/u,
  );
  assert.match(homePage, /const latestProject = PROJECTS\[0\];/u);
  assert.match(homePage, /PROJECT_ADAPTER_DIRECTORIES\[latestProject\.id\]/u);
  assert.match(
    homePage,
    /<ProjectPage projectId=\{latestProject\.id\} projectStyles=\{latestProjectStyles\} home \/>/u,
  );
  assert.match(layout, /<link rel="stylesheet" href="\/site\.css" \/>[\s\S]*projectStyles/u);
  assert.doesNotMatch(homePage, /projectId="cloth"|adapters\/cloth/u);
  assert.match(sceneRouter, /mountClothClient\(host\)/u);
  assert.match(sceneRouter, /mountFlocksClient\(host\)/u);
  assert.match(sceneRouter, /mountCycloneClient\(host\)/u);
  assert.match(sceneRouter, /mountGalaxyClient\(host\)/u);
  assert.match(sceneRouter, /addEventListener\("visibilitychange", syncSceneVisibility\)/u);
  assert.match(sceneRouter, /activeMount\.pause\(\)/u);
  assert.match(sceneRouter, /activeMount\?\.resume\(\)/u);
  assert.match(sceneRouter, /if \(document\.hidden\)/u);
  assert.match(sceneRouter, /scene mount does not implement pause, resume, and destroy/u);
  assert.doesNotMatch(sceneRouter, /createElement|appendChild|innerHTML/u);
  assert.match(shellRenderer, /<a class="project-thumbnail" href=/u);
  assert.match(shellRenderer, /href="\$\{escapeAttribute\(project\.route\)\}"/u);
  assert.match(shellRenderer, /alt="\$\{escapeAttribute\(project\.description\)\}"/u);
  assert.match(shellRenderer, /loading="lazy" fetchpriority="low"/u);
  assert.match(shellRenderer, /fetchpriority="high"/u);
  assert.doesNotMatch(shellRenderer, /<span>\$\{escapeText\(project\.source\)\}<\/span>/u);
  assert.match(shellRenderer, /<time[^>]+>\$\{date\}<\/time><\/span>/u);
  assert.match(shellRenderer, /<span class="project-number project-number-\$\{project\.numberTone\}" aria-hidden="true">#\$\{number\}<\/span>/u);
  assert.doesNotMatch(`${homePage}\n${layout}\n${sceneRouter}\n${shellRenderer}`, /iframe|example-frame|renderLandingViewer/u);
  assert.match(rendererSource, /"@type": "WebSite"/u);
  assert.match(rendererSource, /"@type": "ItemList"/u);
  assert.match(layout, /renderExamplesSidebar\(project\.id\)/u);
  assert.match(layout, /renderExamplesInfo\(project\.id\)/u);
  assert.match(layout, /data-project-id=\{project\.id\}/u);
  assert.match(sceneRouter, /querySelector\("\.example-stage"\)\?\.dataset\.projectId/u);
  assert.doesNotMatch(sceneRouter, /pathname === "\/" \? "cloth"/u);
  assert.match(layout, /transition:persist="examples-sidebar"/u);
  assert.match(layout, /transition:animate="none"/u);
  assert.match(astroConfig, /devToolbar: \{ enabled: false \}/u);
  assert.match(projectSource, /projectManifest\.projects\.length - index/u);
  assert.match(projectSource, /project\.description\.length < 40/u);
  assert.doesNotMatch(`${homePage}\n${layout}\n${sceneRouter}`, /canvas|<code|<pre/u);
});

test("landing uses the compact examples shell and mounts the latest scene directly", async () => {
  const [layout, shellRenderer, siteCss, shellClient] = await Promise.all([
    readFile(resolve(siteRoot, "layouts/ExamplesLayout.astro"), "utf8"),
    readFile(resolve(siteRoot, "examples-shell-plugin.mjs"), "utf8"),
    readFile(resolve(siteRoot, "site.css"), "utf8"),
    readFile(resolve(siteRoot, "examples-shell-client.mjs"), "utf8"),
  ]);
  assert.match(shellRenderer, /class="examples-sidebar"/u);
  assert.match(shellRenderer, /\/landing\/sidebar\/\$\{project\.id\}\.webp/u);
  assert.match(shellRenderer, /class="examples-header"/u);
  assert.match(shellRenderer, /class="examples-wordmark"/u);
  assert.match(shellRenderer, /class="examples-wordmark-css"/u);
  assert.match(shellRenderer, /class="examples-wordmark-dot"/u);
  assert.match(shellRenderer, /class="examples-wordmark-graphics"/u);
  assert.doesNotMatch(shellRenderer, /<h1>examples<\/h1>/u);
  assert.doesNotMatch(shellRenderer, /class="examples-about-panel"/u);
  assert.doesNotMatch(shellRenderer, /class="examples-about-toggle"/u);
  assert.match(shellRenderer, /class="examples-search-panel"/u);
  assert.doesNotMatch(shellRenderer, /class="examples-search-toggle"/u);
  assert.match(shellRenderer, /class="examples-contact-link" href="mailto:agustin@lowpoly\.gg">Contact<\/a>/u);
  assert.match(shellRenderer, /class="examples-header-separator"[^>]*>·<\/span>/u);
  assert.match(shellRenderer, /class="examples-github-link"/u);
  assert.match(shellRenderer, />\s*GitHub\s*<\/a>/u);
  assert.match(shellRenderer, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.match(shellRenderer, /id="example-search"/u);
  assert.match(layout, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.match(layout, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-XV72TXWTM5/u);
  assert.match(layout, /gtag\("config", "G-XV72TXWTM5"\);/u);
  assert.equal(layout.match(/G-XV72TXWTM5/gu)?.length, 2);
  assert.doesNotMatch(shellRenderer, /class="examples-list-heading"/u);
  assert.doesNotMatch(shellRenderer, /cssgraphics-project-count/u);
  assert.match(layout, /class="example-stage"/u);
  assert.match(layout, /<body class="loading">/u);
  assert.match(layout, /css\.graphics - Powered by PolyCSS/u);
  assert.match(layout, /Self-contained 3D scenes rendered with HTML and CSS\./u);
  assert.match(layout, /property="og:image"/u);
  assert.match(layout, /home \? "\/og\/css-graphics\.png" : project\.preview/u);
  assert.match(layout, /const socialImageType = home \? "image\/png" : "image\/webp"/u);
  assert.match(layout, /const socialImageWidth = home \? 1200 : 960/u);
  assert.match(layout, /const socialImageHeight = home \? 630 : 540/u);
  assert.match(layout, /name="twitter:card" content="summary_large_image"/u);
  assert.match(shellRenderer, /id="asset-list"/u);
  assert.match(shellRenderer, /\$\{escapeText\(project\.name\)\} · <a[^>]+>PolyCSS \$\{polycssVersion\}<\/a> · \$\{renderCredits\(project\.credits\)\}/u);
  assert.doesNotMatch(shellRenderer, /<br>/u);
  assert.doesNotMatch(shellRenderer, /Source:/u);
  assert.doesNotMatch(`${layout}\n${shellRenderer}`, /code-panel|controls-panel|asset-stage|landing-mark/u);
  assert.doesNotMatch(siteCss, /\.project-thumbnail::after/u);
  assert.doesNotMatch(siteCss, /examples-loading-copy|Reticulating splines/u);
  assert.match(siteCss, /html body\.loading::after,[\s\S]*?width: 30px;[\s\S]*?height: 30px;[\s\S]*?border-width: 2px;[\s\S]*?border-color: rgb\(240 240 240 \/ 35%\);[\s\S]*?border-top-color: rgb\(240 240 240\);/u);
  assert.match(siteCss, /\.project-thumbnail img \{[\s\S]*?height: auto;[\s\S]*?object-fit: cover;/u);
  assert.match(siteCss, /\[hidden\] \{[\s\S]*?display: none !important;/u);
  assert.match(siteCss, /\.project-thumbnail\[aria-current="page"\]/u);
  assert.match(siteCss, /\.project-thumbnail \{[\s\S]*?border: 1px solid #282828;/u);
  assert.match(siteCss, /\.project-thumbnail \{[\s\S]*?opacity: 0\.6;/u);
  assert.match(siteCss, /\.project-thumbnail\[aria-current="page"\] \{[\s\S]*?border-color: #707070;/u);
  assert.match(siteCss, /\.project-thumbnail\[aria-current="page"\] \{[\s\S]*?opacity: 0\.96;/u);
  assert.match(siteCss, /\.examples-wordmark text \{[\s\S]*?font-size: 22px;/u);
  assert.match(siteCss, /\.examples-search-panel input \{[\s\S]*?font-size: 14px;/u);
  assert.match(siteCss, /\.project-title \{[\s\S]*?font-size: 14px;/u);
  assert.match(siteCss, /\.project-meta \{[\s\S]*?font-size: 14px;[\s\S]*?opacity: 0\.75;/u);
  assert.match(siteCss, /\.project-number \{[\s\S]*?font-size: 14px;/u);
  assert.match(siteCss, /#empty-results \{[\s\S]*?font-size: 14px;/u);
  assert.match(siteCss, /\.example-info \{[\s\S]*?font-size: 14px;/u);
  assert.doesNotMatch(siteCss, /font-size: (?:11|12)px;/u);
  assert.doesNotMatch(siteCss, /box-shadow: 0 0 0 1px #9d7cff/u);
  assert.doesNotMatch(siteCss, /(?:box|text)-shadow\s*:/u);
  assert.match(siteCss, /--examples-sidebar-width: 354px;/u);
  assert.equal(siteCss.match(/354px/gu)?.length, 1);
  assert.match(siteCss, /\.example-stage \{[\s\S]*?inset: 0 0 0 var\(--examples-sidebar-width\);/u);
  assert.match(siteCss, /\.example-stage \{[\s\S]*?pointer-events: none;/u);
  assert.match(siteCss, /\.example-info \{[\s\S]*?left: var\(--examples-sidebar-width\);/u);
  assert.doesNotMatch(siteCss, /\.example-info \{[\s\S]*?text-shadow:/u);
  assert.doesNotMatch(siteCss, /mix-blend-mode/u);
  assert.match(siteCss, /\.example-info-dark \{[\s\S]*?color: rgb\(40 40 40 \/ 80%\);/u);
  assert.match(siteCss, /\.example-info-dark a:hover \{[\s\S]*?color: #282828;/u);
  assert.match(siteCss, /\.example-info-light \{[\s\S]*?color: rgb\(223 223 223 \/ 80%\);/u);
  assert.match(siteCss, /\.example-info-light a:hover \{[\s\S]*?color: var\(--examples-shell-text\);/u);
  assert.match(siteCss, /\.example-info \{[\s\S]*?height: var\(--examples-header-height\);[\s\S]*?padding: calc\(\(var\(--examples-header-height\) - 24px\) \/ 2\) 10px;[\s\S]*?font-size: 14px;[\s\S]*?line-height: 24px;/u);
  assert.match(siteCss, /\.example-info a \{[\s\S]*?color: inherit;[\s\S]*?text-decoration: underline;/u);
  assert.doesNotMatch(siteCss, /color: #f00/u);
  assert.doesNotMatch(`${siteCss}\n${shellClient}`, /examples-performance|stats\.js|stats\.update/u);
  assert.doesNotMatch(siteCss, /iframe|example-frame|viewer-loading/u);
  assert.match(siteCss, /@media \(max-width: 760px\)/u);
  assert.match(siteCss, /--examples-header-height: 55px;/u);
  assert.match(siteCss, /@media \(max-width: 760px\) \{[\s\S]*?:root \{[\s\S]*?--examples-header-height: 50px;/u);
  assert.match(siteCss, /--examples-mobile-search-height: 42px;/u);
  assert.match(siteCss, /--examples-mobile-navigation-height: 134px;/u);
  assert.match(siteCss, /\.examples-sidebar \{[\s\S]*?inset: 0;[\s\S]*?grid-template-rows:[\s\S]*?minmax\(0, 1fr\)[\s\S]*?var\(--examples-mobile-search-height\)[\s\S]*?var\(--examples-mobile-navigation-height\);/u);
  assert.match(siteCss, /\.examples-search-panel \{[\s\S]*?grid-row: 3;/u);
  assert.match(siteCss, /#asset-list \{[\s\S]*?grid-row: 4;[\s\S]*?align-items: flex-start;[\s\S]*?gap: 8px;[\s\S]*?padding: 10px;[\s\S]*?overflow-x: auto;/u);
  assert.match(siteCss, /\.project-copy \{[\s\S]*?padding: 6px 10px;/u);
  assert.match(siteCss, /\.example-stage \{[\s\S]*?var\(--examples-header-height\)[\s\S]*?calc\(var\(--examples-mobile-search-height\) \+ var\(--examples-mobile-navigation-height\)\);/u);
  assert.match(siteCss, /\.example-info \{[\s\S]*?top: var\(--examples-header-height\);[\s\S]*?left: 0;/u);
  assert.doesNotMatch(siteCss, /(?:left|top|inset):\s*(?:354|220)px|calc\(50% \+ (?:177|110)px\)/u);
  assert.match(siteCss, /#asset-list \{[\s\S]*?overflow-x: auto;/u);
});

test("every deployed project owns the examples shell and direct scene host", async () => {
  for (const [id, adapterDirectory] of projectAdapterDirectories) {
    if (projectsExcludedFromLanding.includes(id)) continue;
    const adapterRoot = resolve(repositoryRoot, "src/adapters", adapterDirectory);
    const [html, main, viteConfig] = await Promise.all([
      readFile(resolve(adapterRoot, "index.html"), "utf8"),
      readFile(resolve(adapterRoot, "src/main.mjs"), "utf8"),
      readFile(resolve(adapterRoot, "vite.config.mjs"), "utf8"),
    ]);
    assert.match(html, /cssgraphics-examples-sidebar/u);
    assert.match(html, /class="example-stage"/u);
    assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
    assert.doesNotMatch(html, /iframe|site-header|window === window\.top|target="_top"/u);
    assert.doesNotMatch(main, /site\/site\.css/u);
    assert.match(main, /site\/examples-shell-client\.mjs/u);
    assert.match(viteConfig, new RegExp(`createExamplesShellPlugin\\("${id}"\\)`, "u"));
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
  const [netlify, packageManifest, astroConfig] = await Promise.all([
    readFile(resolve(repositoryRoot, "netlify.toml"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "astro.config.mjs"), "utf8"),
  ]);
  assert.doesNotMatch(netlify, /to\s*=\s*"\/pipes\/"/u);
  assert.match(
    packageManifest,
    /CSSGRAVITYWELL_DEPLOY_BUILD=1 pnpm build:gravitywell && CSSCYCLONE_DEPLOY_BUILD=1 pnpm build:cyclone && CSSGALAXY_DEPLOY_BUILD=1 pnpm build:galaxy && CSSMENGER_DEPLOY_BUILD=1 pnpm build:menger/u,
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
  assert.match(astroConfig, /emptyOutDir: process\.env\.CSSGRAPHICS_DEPLOY_BUILD !== "1"/u);
});
