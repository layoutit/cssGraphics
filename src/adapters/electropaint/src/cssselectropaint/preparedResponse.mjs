// SPDX-License-Identifier: GPL-2.0-only
export async function readPreparedText(response) {
  return new TextDecoder().decode(await readPreparedBytes(response));
}

export async function readPreparedBytes(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pathname = new URL(response.url, globalThis.location?.href ?? "http://localhost/").pathname;
  const isGzip = pathname.endsWith(".gz") && response.headers.get("content-encoding") !== "gzip";
  if (!isGzip) return bytes;
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decode prepared ElectroPaint gzip assets");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readPreparedJson(response) {
  return JSON.parse(await readPreparedText(response));
}
