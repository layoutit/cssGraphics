import "./csspipes/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { startCssPipesClient } from "./csspipes/client.mjs";
import { resolveCssPipesRoute } from "./csspipes/routeState.mjs";

await startCssPipesClient(requireExamplesStage(), resolveCssPipesRoute(globalThis.location.href));
