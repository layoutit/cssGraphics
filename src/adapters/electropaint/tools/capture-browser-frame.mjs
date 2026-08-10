#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
process.argv.push("--capture");
await import("./smoke-browser.mjs");
