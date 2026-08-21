import type { LandingProject } from "./projects";

const SITE_URL = "https://css.graphics/";

export function renderLandingProjectCards(projects: readonly LandingProject[]): string {
  return projects.map((project, index) => {
    const number = String(project.number).padStart(3, "0");
    const date = project.date.replaceAll("-", ".");
    const priority = index === 0
      ? 'fetchpriority="high"'
      : 'loading="lazy" fetchpriority="low"';
    const current = index === 0 ? ' aria-current="true"' : "";
    return `
        <a class="project-thumbnail" href="${escapeAttribute(project.route)}" data-project-id="${escapeAttribute(project.id)}" data-project-name="${escapeAttribute(project.name)}" data-project-source="${escapeAttribute(project.source)}"${current}>
          <img src="${escapeAttribute(project.preview)}" alt="${escapeAttribute(project.description)}" width="960" height="960" decoding="async" ${priority}>
          <span class="project-copy">
            <span class="project-title">${escapeText(project.name)}</span>
            <span class="project-meta"><span>${escapeText(project.source)}</span><time datetime="${escapeAttribute(project.date)}">${date}</time></span>
          </span>
          <span class="project-number" aria-hidden="true">#${number}</span>
        </a>`;
  }).join("");
}

export function renderLandingViewer(project: LandingProject): string {
  return `<main class="example-viewer" aria-label="Selected example">
        <div class="viewer-loading" role="status">Loading ${escapeText(project.name)}…</div>
        <iframe id="example-frame" src="${escapeAttribute(project.route)}" title="${escapeAttribute(project.name)} example"></iframe>
        <a class="open-example" href="${escapeAttribute(project.route)}" aria-label="Open ${escapeAttribute(project.name)} in this window">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg>
        </a>
      </main>`;
}

export function renderLandingStructuredData(projects: readonly LandingProject[]): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}#website`,
        name: "css.graphics",
        url: SITE_URL,
        description: "A gallery of self-contained 3D screensavers and scenes rendered with HTML and CSS, powered by PolyCSS.",
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}#projects`,
        name: "css.graphics projects",
        numberOfItems: projects.length,
        itemListElement: projects.map((project, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: new URL(project.route, SITE_URL).href,
          name: project.name,
          description: project.description,
          image: new URL(project.preview, SITE_URL).href,
        })),
      },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(graph).replaceAll("<", "\\u003c")}</script>`;
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function escapeText(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
