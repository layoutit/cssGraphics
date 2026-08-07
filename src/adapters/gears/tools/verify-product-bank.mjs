#!/usr/bin/env node

import { resolve } from "node:path";
import { inspectCssgearsProductBank } from "./productBank.mjs";

const root = resolve(process.argv[2] ?? "build/generated/public/cssgears");
const summary = await inspectCssgearsProductBank(root);
process.stdout.write(`${JSON.stringify({ status: "pass", root, ...summary }, null, 2)}\n`);
