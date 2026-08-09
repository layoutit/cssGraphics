#!/usr/bin/env node
const headless = process.env.CSS_REFERENCE_CAPTURE_HEADLESS ?? "1";
const allowVisible = process.env.CSS_REFERENCE_CAPTURE_ALLOW_VISIBLE ?? "0";
if (headless !== "1" || allowVisible === "1") {
  throw new Error("cssMaze reference capture is headless-only; visible-window opt-in is blocked");
}
console.error("cssMaze native visual capture is UNQUALIFIED: the current C harness is exact state evidence only, and no pinned headless XScreenSaver pixel renderer is bound yet.");
process.exitCode = 2;
