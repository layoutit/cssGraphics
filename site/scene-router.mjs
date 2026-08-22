import { requireExamplesStage } from "./examples-shell-client.mjs";

let activeMount = null;
let navigationId = 0;

document.addEventListener("astro:before-swap", () => {
  navigationId += 1;
  destroyActiveScene();
});

document.addEventListener("astro:page-load", () => {
  syncActiveThumbnail();
  void mountActiveScene(++navigationId);
});

async function mountActiveScene(id) {
  const projectId = projectIdFromPath(location.pathname);
  const host = requireExamplesStage();
  const mount = await mountForProject(projectId, host);
  if (id !== navigationId) {
    mount?.destroy?.();
    return;
  }
  activeMount = mount;
}

async function mountForProject(projectId, host) {
  switch (projectId) {
    case "cloth": {
      const { mountClothClient } = await import("../src/adapters/cloth/src/csscloth/client.mjs");
      return mountClothClient(host);
    }
    case "solitaire": {
      const { mountCsssolitaireClient } = await import("../src/adapters/solitaire/src/csssolitaire/client.mjs");
      return mountCsssolitaireClient(host);
    }
    case "electropaint": {
      const { mountElectropaintClient } = await import("../src/adapters/electropaint/src/cssselectropaint/client.mjs");
      return mountElectropaintClient(host);
    }
    case "menger": {
      const { mountCssmengerClient } = await import("../src/adapters/menger/src/cssmenger/client.mjs");
      return mountCssmengerClient(host);
    }
    case "maze": {
      const { mountCssmazeClient } = await import("../src/adapters/maze/src/cssmaze/client.mjs");
      return mountCssmazeClient();
    }
    case "gears": {
      const { mountCssgearsClient } = await import("../src/adapters/gears/src/cssgears/client.mjs");
      return mountCssgearsClient();
    }
    case "pipes": {
      const { startCssPipesClient } = await import("../src/adapters/3dpipes/src/csspipes/client.mjs");
      const { resolveCssPipesRoute } = await import("../src/adapters/3dpipes/src/csspipes/routeState.mjs");
      return startCssPipesClient(host, resolveCssPipesRoute(location.href));
    }
    default:
      throw new Error(`Unknown css.graphics route: ${location.pathname}`);
  }
}

function destroyActiveScene() {
  activeMount?.destroy?.();
  activeMount = null;
}

function syncActiveThumbnail() {
  const projectId = projectIdFromPath(location.pathname);
  for (const thumbnail of document.querySelectorAll(".project-thumbnail")) {
    if (!(thumbnail instanceof HTMLAnchorElement)) continue;
    if (thumbnail.pathname === `/${projectId}/`) {
      thumbnail.setAttribute("aria-current", "page");
    } else {
      thumbnail.removeAttribute("aria-current");
    }
  }
}

function projectIdFromPath(pathname) {
  return pathname === "/" ? "cloth" : pathname.split("/").filter(Boolean)[0];
}
