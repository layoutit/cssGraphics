#!/usr/bin/env node

import { resolve } from "node:path";
import { inspectCssgravitywellProductBank } from "./productBank.mjs";

const root = resolve(process.argv[2] ?? "build/generated/public/cssgravitywell");
const summary = await inspectCssgravitywellProductBank(root);
process.stdout.write(`${JSON.stringify({ status: "pass", root, ...summary }, null, 2)}\n`);
