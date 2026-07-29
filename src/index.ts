import {
  loadCssGraphicsPackageCatalog,
  normalizeCssGraphicsPackageBaseUrl,
} from "./runtime/shared/catalog.mjs";
import {
  startCssGraphicsSession,
  type CssGraphicsRuntimeAdapter,
} from "./runtime/shared/session.js";
import {
  resolveCssGraphicsRoute,
} from "./runtime/shared/route.js";
import {
  superMario64PlayerAdapter,
} from "./adapters/super-mario-64/player/adapter.js";
import {
  CSSGRAPHICS_DEFAULT_BASE_URL,
  type CssGraphicsExperience,
  type CssGraphicsMountOptions,
  type CssGraphicsPackageCatalog,
} from "./public-contract.js";

const CSSGRAPHICS_RUNTIME_ADAPTERS: ReadonlyMap<string, CssGraphicsRuntimeAdapter> =
  new Map([[superMario64PlayerAdapter.profile, superMario64PlayerAdapter]]);

export * from "./public-contract.js";

export async function loadCssGraphicsCatalog(
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = CSSGRAPHICS_DEFAULT_BASE_URL,
): Promise<CssGraphicsPackageCatalog> {
  return loadCssGraphicsPackageCatalog(fetchImpl, baseUrl);
}

export async function mountCssGraphics(
  host: HTMLElement,
  options: CssGraphicsMountOptions = {},
): Promise<CssGraphicsExperience> {
  if (!host || !host.ownerDocument) throw new TypeError("cssGraphics requires an HTMLElement host.");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = normalizeCssGraphicsPackageBaseUrl(
    options.baseUrl ?? CSSGRAPHICS_DEFAULT_BASE_URL,
  );
  const catalog = await loadCssGraphicsCatalog(fetchImpl, base);
  const selected = options.modelId ?? resolveCssGraphicsRoute(
    new URL(globalThis.location.href),
    catalog.defaultId,
  ).modelId;
  return startCssGraphicsSession({
    host,
    catalog,
    initialModelId: selected,
    adapters: CSSGRAPHICS_RUNTIME_ADAPTERS,
    fetchImpl,
    baseUrl: base,
    experienceControls: options.experienceControls,
  });
}
