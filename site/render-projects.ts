import type { LandingProject } from "./projects";

const SITE_URL = "https://css.graphics/";

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
