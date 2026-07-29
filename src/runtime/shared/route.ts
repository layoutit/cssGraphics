import {
  InvalidCssGraphicsRouteError,
} from "../../public-contract.js";

export const CSSGRAPHICS_MODEL_QUERY_PARAMETER = "model" as const;

const NORMALIZED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface CssGraphicsRouteState {
  readonly canonical: true;
  readonly route: "/";
  readonly modelId: string;
  readonly modelWasRequested: boolean;
}

function normalizedModelId(value: string): string {
  if (!NORMALIZED_ID.test(value)) {
    throw new InvalidCssGraphicsRouteError("The requested model id is not normalized.");
  }
  return value;
}

export function resolveCssGraphicsRoute(
  url: URL,
  defaultModelId: string,
): CssGraphicsRouteState {
  if (url.pathname !== "/") {
    throw new InvalidCssGraphicsRouteError("cssGraphics has one canonical product route: '/'.");
  }
  if (url.hash.length !== 0) {
    throw new InvalidCssGraphicsRouteError("The cssGraphics route accepts no fragment selectors.");
  }
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== CSSGRAPHICS_MODEL_QUERY_PARAMETER)) {
    throw new InvalidCssGraphicsRouteError("The cssGraphics route accepts only the model query selector.");
  }
  const values = url.searchParams.getAll(CSSGRAPHICS_MODEL_QUERY_PARAMETER);
  if (values.length > 1) {
    throw new InvalidCssGraphicsRouteError("The model query selector may appear only once.");
  }
  const modelWasRequested = values.length === 1;
  const modelId = normalizedModelId(values[0] ?? defaultModelId);
  return Object.freeze({
    canonical: true,
    route: "/",
    modelId,
    modelWasRequested,
  });
}

export function cssGraphicsModelUrl(modelId: string, defaultModelId: string): string {
  const normalizedModel = normalizedModelId(modelId);
  const normalizedDefault = normalizedModelId(defaultModelId);
  const url = new URL(globalThis.location.href);
  url.pathname = "/";
  url.hash = "";
  url.search = "";
  if (normalizedModel !== normalizedDefault) {
    url.searchParams.set(CSSGRAPHICS_MODEL_QUERY_PARAMETER, normalizedModel);
  }
  return `${url.pathname}${url.search}`;
}
