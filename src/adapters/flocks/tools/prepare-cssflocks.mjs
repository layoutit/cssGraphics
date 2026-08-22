#!/usr/bin/env node
import { prepareFlocks } from "../src/prepare/cssflocks/prepare.mjs";

const result = await prepareFlocks();
console.log(JSON.stringify(result, null, 2));
