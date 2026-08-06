import "./csspipes/styles.css";
import { startCssPipesClient } from "./csspipes/client.mjs";
import { resolveCssPipesRoute } from "./csspipes/routeState.mjs";

await startCssPipesClient(document.body, resolveCssPipesRoute(globalThis.location.href));
