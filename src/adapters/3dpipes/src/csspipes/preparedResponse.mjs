import { CssPipesContractError } from "./types.mjs";

function preparedResponse(response, encoding) {
  if (response.headers?.get("content-encoding")?.includes(encoding)) return response;
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new CssPipesContractError(`This browser cannot read prepared ${encoding} assets`);
  }
  const stream = response.body?.pipeThrough(new DecompressionStream(encoding));
  if (!stream) throw new CssPipesContractError(`Prepared ${encoding} body is missing`);
  return new Response(stream);
}

export function readPreparedJson(response, encoding = "gzip") {
  return preparedResponse(response, encoding).json();
}

export function readPreparedText(response, encoding = "gzip") {
  return preparedResponse(response, encoding).text();
}
