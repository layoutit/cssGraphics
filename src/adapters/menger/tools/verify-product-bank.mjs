#!/usr/bin/env node

import { resolve } from "node:path";
import { inspectCssmengerProductBank } from "./productBank.mjs";

const root = resolve(process.argv[2] ?? "build/generated/public/cssmenger");
const summary = await inspectCssmengerProductBank(root);
process.stdout.write(`${JSON.stringify({ status: "pass", root, ...summary }, null, 2)}\n`);
