import { CssPipesContractError } from "./types.mjs";

export function resolveCssPipesRoute(input) {
  const url = input instanceof URL ? input : new URL(String(input), "http://127.0.0.1");
  const supportedPaths = new Set([
    "/", "/index.html", "/pipes", "/pipes/", "/pipes/index.html",
  ]);
  if (!supportedPaths.has(url.pathname)) {
    throw new CssPipesContractError(`Unsupported cssPipes route ${url.pathname}`);
  }
  if (url.hash) {
    throw new CssPipesContractError("cssPipes does not accept fragment scene selectors");
  }
  return Object.freeze({
    pathname: url.pathname.startsWith("/pipes") ? "/pipes/" : "/",
    manifestUrl: "/csspipes/manifest.json",
    selection: "manifest-default",
  });
}
