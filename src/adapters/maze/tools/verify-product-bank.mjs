#!/usr/bin/env node
import { resolve } from "node:path";
import { inspectCssmazeProductBank } from "./productBank.mjs";

const root = resolve(process.argv[2] ?? "build/generated/public/cssmaze");
const summary = await inspectCssmazeProductBank(root);
process.stdout.write(`${JSON.stringify({ status: "pass", root, ...summary }, null, 2)}\n`);
