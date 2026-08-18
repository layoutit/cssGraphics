import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the DOMFORMAT-precedented elapsed deadline playback transport", async () => {
  const [client, player] = await Promise.all([
    readFile(new URL("../src/csscityflow/client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/preparedPlayback.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(client, /mountPolyMorphModel/u);
  assert.match(player, /domformat@0\/polycss-playback@0@cc8da736/u);
  assert.match(player, /requestAnimationFrame/u);
  assert.match(player, /setTimeout/u);
  assert.doesNotMatch(`${client}\n${player}`, /setInterval|canvas|getContext/u);
});

test("keeps the route shell minimal and source-named", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /site-wordmark-css/u);
  assert.match(html, /site-wordmark-graphics/u);
  assert.match(html, /\/cityflow/u);
  assert.equal((html.match(/<header\b/gu) ?? []).length, 1);
  assert.equal((html.match(/<main\b/gu) ?? []).length, 0);
  assert.equal((html.match(/<canvas\b/gu) ?? []).length, 0);
});
