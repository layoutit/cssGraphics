#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later

// Keep the singular public command useful without maintaining a second
// capture path: it records the same complete browser sequence used by the
// native/browser comparison.
await import("./capture-browser-frames.mjs");
