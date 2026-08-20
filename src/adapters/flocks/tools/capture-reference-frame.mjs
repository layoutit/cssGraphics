#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later

// Compatibility entrypoint: the qualified oracle is a sequence, so a
// reference-frame request captures the complete review set rather than a
// potentially misleading selected still.
await import("./capture-reference-frames.mjs");
