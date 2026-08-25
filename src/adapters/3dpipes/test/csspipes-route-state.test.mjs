import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { resolveCssPipesRoute } from "../src/csspipes/routeState.mjs";

const adapterRoot = resolve(import.meta.dirname, "..");

test("csspipes resolves its deployed route to the prepared manifest default", () => {
  assert.deepEqual(resolveCssPipesRoute("https://css.graphics/pipes/"), {
    pathname: "/pipes/",
    manifestUrl: "/csspipes/manifest.json",
    selection: "manifest-default",
  });
});

test("csspipes ignores referral query parameters", () => {
  assert.deepEqual(
    resolveCssPipesRoute("https://css.graphics/pipes/?ref=links.supply,"),
    resolveCssPipesRoute("https://css.graphics/pipes/"),
  );
});

test("csspipes query parameters cannot select an ad hoc scene", () => {
  assert.equal(
    resolveCssPipesRoute("https://css.graphics/pipes/?scene=unprepared").selection,
    "manifest-default",
  );
});

test("csspipes still rejects unsupported paths and fragment scene selectors", () => {
  assert.throws(() => resolveCssPipesRoute("https://css.graphics/not-pipes/"), {
    name: "CssPipesContractError",
    message: "Unsupported cssPipes route /not-pipes/",
  });
  assert.throws(() => resolveCssPipesRoute("https://css.graphics/pipes/#scene"), {
    name: "CssPipesContractError",
    message: "cssPipes does not accept fragment scene selectors",
  });
});

test("csspipes uses the shared body loading lifecycle", async () => {
  const [html, client, styles] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/csspipes/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/csspipes/styles.css"), "utf8"),
  ]);
  assert.match(html, /<body class="loading">/u);
  assert.match(client, /setBodyState\("loading"\)/u);
  assert.match(client, /setBodyState\("ready"\)/u);
  assert.match(client, /setBodyState\("error"\)/u);
  assert.doesNotMatch(styles, /csspipes-loading|prefers-reduced-motion/u);
});
