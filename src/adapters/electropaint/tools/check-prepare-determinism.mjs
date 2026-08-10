#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { createHash } from "node:crypto";
import { buildPreparedElectropaintScene } from "../src/prepare/cssselectropaint/sceneBuilder.mjs";
import { verifyElectropaintAuthorities } from "../src/prepare/cssselectropaint/dataSource.mjs";

const authorities = await verifyElectropaintAuthorities();
const first = Buffer.from(`${JSON.stringify(buildPreparedElectropaintScene(authorities))}\n`);
const second = Buffer.from(`${JSON.stringify(buildPreparedElectropaintScene(authorities))}\n`);
const firstHash = createHash("sha256").update(first).digest("hex");
const secondHash = createHash("sha256").update(second).digest("hex");
if (!first.equals(second) || firstHash !== secondHash) {
  throw new Error("ElectroPaint source preparation is nondeterministic");
}
console.log(JSON.stringify({ status: "deterministic", bytes: first.length, sha256: firstHash }, null, 2));
