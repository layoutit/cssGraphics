function preparedResponse(response, encoding) {
  if (response.headers?.get("content-encoding")?.includes(encoding)) return response;
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new Error(`This browser cannot read prepared cssMaze ${encoding} assets`);
  }
  const stream = response.body?.pipeThrough(new DecompressionStream(encoding));
  if (!stream) throw new Error(`Prepared cssMaze ${encoding} body is missing`);
  return new Response(stream);
}

export function readPreparedJson(response, encoding = "gzip") {
  return preparedResponse(response, encoding).json();
}

export function readPreparedText(response, encoding = "gzip") {
  return preparedResponse(response, encoding).text();
}
