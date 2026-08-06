import { CssPipesContractError } from "./types.mjs";

export function resolveCssPipesRoute(input) {
  const url = input instanceof URL ? input : new URL(String(input), "http://127.0.0.1");
  if (url.pathname !== "/" && url.pathname !== "/index.html") {
    throw new CssPipesContractError(`Unsupported cssPipes route ${url.pathname}`);
  }
  if (url.search || url.hash) {
    throw new CssPipesContractError("cssPipes does not accept ad hoc scene selectors");
  }
  return Object.freeze({
    pathname: "/",
    manifestUrl: "/csspipes/manifest.json",
    selection: "manifest-default",
  });
}
