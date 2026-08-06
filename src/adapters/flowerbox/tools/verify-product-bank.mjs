#!/usr/bin/env node

import { resolve } from "node:path";
import { inspectFlowerboxProductBank } from "./productBank.mjs";

const root = resolve(process.argv[2] ?? "build/generated/public/cssflower");
const summary = await inspectFlowerboxProductBank(root);
process.stdout.write(`${JSON.stringify({ status: "pass", root, ...summary }, null, 2)}\n`);
