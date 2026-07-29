#!/usr/bin/env node

import { resolve } from "node:path";

import { main } from "./executable.mjs";

const packageRoot = resolve(import.meta.dirname, "../../../..");
await main({ packageRoot });
