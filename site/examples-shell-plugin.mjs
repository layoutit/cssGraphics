import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import packageManifest from "../package.json" with { type: "json" };
import manifest from "./public/projects.json" with { type: "json" };

const siteRoot = import.meta.dirname;
const publicRoot = resolve(siteRoot, "public");
const polycssVersion = packageManifest.dependencies?.["@layoutit/polycss"];

if (manifest.schema !== "cssgraphics.projects@2" || !Array.isArray(manifest.projects)) {
  throw new Error("Invalid css.graphics project manifest.");
}
if (manifest.projects.some(({ credits }) =>
  !Array.isArray(credits) || credits.length === 0 ||
  credits.some(({ relation, name, url }) =>
    typeof relation !== "string" || relation.length === 0 ||
    typeof name !== "string" || name.length === 0 ||
    (url !== undefined && !/^https:\/\//u.test(url))))) {
  throw new Error("Invalid css.graphics project attribution.");
}
if (typeof polycssVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(polycssVersion)) {
  throw new Error("Invalid PolyCSS package version.");
}

const projects = Object.freeze(manifest.projects);
const routeProjects = Object.freeze([...projects, ...(manifest.unlistedProjects ?? [])]);
const localAssets = new Map([
  ["/site.css", Object.freeze({ path: resolve(siteRoot, "site.css"), mediaType: "text/css" })],
  ["/favicon.ico", Object.freeze({ path: resolve(publicRoot, "favicon.ico"), mediaType: "image/x-icon" })],
  ...routeProjects.map((project) => [
    project.preview,
    Object.freeze({ path: resolve(publicRoot, project.preview.replace(/^\//u, "")), mediaType: "image/webp" }),
  ]),
]);

export function createExamplesShellPlugin(activeProjectId) {
  if (!routeProjects.some((project) => project.id === activeProjectId)) {
    throw new Error(`Unknown css.graphics project: ${activeProjectId}`);
  }

  const serveLocalAssets = (server) => {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url || !["GET", "HEAD"].includes(request.method ?? "GET")) {
          next();
          return;
        }
        const pathname = new URL(request.url, "http://css.graphics").pathname;
        const asset = localAssets.get(pathname);
        if (!asset) {
          next();
          return;
        }
        try {
          const bytes = await readFile(asset.path);
          response.statusCode = 200;
          response.setHeader("Content-Type", asset.mediaType);
          response.setHeader("Content-Length", bytes.byteLength);
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          next(error);
        }
      });
  };

  return {
    name: `cssgraphics-examples-shell-${activeProjectId}`,
    configureServer: serveLocalAssets,
    configurePreviewServer: serveLocalAssets,
    transformIndexHtml(html) {
      const marker = "<!-- cssgraphics-examples-sidebar -->";
      if (!html.includes(marker)) {
        return html;
      }
      return html.replace(
        marker,
        `${renderExamplesSidebar(activeProjectId)}\n    ${renderExamplesInfo(activeProjectId)}`,
      );
    },
  };
}

export function renderExamplesSidebar(activeProjectId) {
  return `<aside class="examples-sidebar">
      <header class="examples-header">
        <a class="examples-wordmark" href="/" aria-label="css.graphics home">
          <svg viewBox="0 0 130 30" aria-hidden="true" focusable="false">
            <text x="0" y="23"><tspan class="examples-wordmark-css">css</tspan><tspan class="examples-wordmark-dot">.</tspan><tspan class="examples-wordmark-graphics">graphics</tspan></text>
          </svg>
        </a>
        <a class="examples-contact-link" href="mailto:agustin@lowpoly.gg">Contact</a>
        <span class="examples-header-separator" aria-hidden="true">·</span>
        <a class="examples-github-link" href="https://github.com/layoutit/cssGraphics" aria-label="View cssGraphics on GitHub" target="_blank" rel="noopener">
          GitHub
        </a>
      </header>
      <label class="examples-search-panel" id="examples-search-panel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <span class="visually-hidden">Search examples</span>
        <input id="example-search" type="search" placeholder="Search examples" autocomplete="off">
      </label>
      <nav id="asset-list" aria-label="Examples">${renderProjectCards(activeProjectId)}</nav>
      <p id="empty-results" hidden>No examples match your search.</p>
    </aside>`;
}

export function renderExamplesInfo(activeProjectId) {
  const project = routeProjects.find(({ id }) => id === activeProjectId);
  if (!project) {
    throw new Error(`Unknown css.graphics project: ${activeProjectId}`);
  }
  return `<div class="example-info example-info-${project.numberTone}">${escapeText(project.name)} · <a href="https://github.com/layoutit/polycss" target="_blank" rel="noopener">PolyCSS ${polycssVersion}</a> · ${renderCredits(project.credits)}</div>`;
}

function renderCredits(credits) {
  return credits.map(({ relation, name, url }, index) => {
    const credit = url
      ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener">${escapeText(name)}</a>`
      : escapeText(name);
    const prefix = relation === "and" ? "" : `${escapeText(relation)} `;
    return `${index === 0 ? "" : " · "}${prefix}${credit}`;
  }).join("");
}

function renderProjectCards(activeProjectId) {
  return projects.map((project, index) => {
    const number = String(project.number).padStart(3, "0");
    const date = project.date.replaceAll("-", ".");
    const priority = index === 0 ? 'fetchpriority="high"' : 'loading="lazy" fetchpriority="low"';
    const current = project.id === activeProjectId ? ' aria-current="page"' : "";
    return `<a class="project-thumbnail" href="${escapeAttribute(project.route)}" data-project-name="${escapeAttribute(project.name)}" data-project-source="${escapeAttribute(project.source)}"${current}>
          <img src="${escapeAttribute(project.preview)}" alt="${escapeAttribute(project.description)}" width="960" height="540" decoding="async" ${priority}>
          <span class="project-copy"><span class="project-title">${escapeText(project.name)}</span><span class="project-meta"><time datetime="${escapeAttribute(project.date)}">${date}</time></span></span>
          <span class="project-number project-number-${project.numberTone}" aria-hidden="true">#${number}</span>
        </a>`;
  }).join("");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
