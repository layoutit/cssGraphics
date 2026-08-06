import "./csspipes/styles.css";
import { startCssPipesClient } from "./csspipes/client.mjs";
import { resolveCssPipesRoute } from "./csspipes/routeState.mjs";

const host = document.querySelector("#csspipes-root");
if (!(host instanceof HTMLElement)) throw new Error("Missing #csspipes-root host");
await startCssPipesClient(host, resolveCssPipesRoute(globalThis.location.href));
