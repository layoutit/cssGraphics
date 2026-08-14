import type { LandingProject } from "./projects";

const SITE_URL = "https://css.graphics/";

export function renderLandingProjectCards(projects: readonly LandingProject[]): string {
  return projects.map((project, index) => {
    const number = String(project.number).padStart(3, "0");
    const date = project.date.replaceAll("-", ".");
    const priority = index === 0
      ? 'fetchpriority="high"'
      : 'loading="lazy" fetchpriority="low"';
    return `
        <a class="project-thumbnail" href="${escapeAttribute(project.route)}" aria-label="${escapeAttribute(project.name)}" title="${escapeAttribute(project.name)}">
          <span class="project-title">${escapeText(project.name)}</span>
          <span class="project-number" aria-hidden="true">#${number}</span>
          <span class="project-meta">
            <span class="project-source">${escapeText(project.source)}</span>
            <time class="project-date" datetime="${escapeAttribute(project.date)}">${date}</time>
          </span>
          <img src="${escapeAttribute(project.preview)}" alt="${escapeAttribute(project.description)}" width="960" height="960" decoding="async" ${priority}>
        </a>`;
  }).join("");
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
