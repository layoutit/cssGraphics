import { PINNED_XSCREENSAVER_COMMIT } from "./dataSource.mjs";

export function sourceProvenanceFor(dataSource, nativeCapture) {
  return Object.freeze({
    authority: "XScreenSaver maze3d",
    repository: "https://github.com/Zygo/xscreensaver",
    mirrorRole: "read-only mirror",
    commit: PINNED_XSCREENSAVER_COMMIT,
    primarySource: "hacks/glx/maze3d.c",
    configSource: "hacks/config/maze3d.xml",
    manualSource: "hacks/glx/maze3d.man",
    usedTextures: Object.freeze(dataSource.verifiedFiles
      .filter((entry) => entry.output)
      .map((entry) => Object.freeze({ path: entry.path, sha256: entry.sha256 }))),
    sourceStateDump: Object.freeze({
      path: "native/maze3d-state.c",
      helperSha256: nativeCapture.helperSha256,
      outputSha256: nativeCapture.stateSha256,
      status: "exact-source-algorithm-state-evidence",
      visualOracle: false,
    }),
    rights: Object.freeze({
      status: "qualified-for-used-first-slice",
      noticePath: "debian/copyright",
      noticeSha256: "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9",
      redistribution: "permitted-with-copyright-and-permission-notice",
    }),
  });
}

export function assertNoBrowserPathLeaks(value) {
  const json = JSON.stringify(value);
  if (/\/(?:Users|home)\//u.test(json) || /[A-Za-z]:\\/u.test(json)) {
    throw new Error("Generated cssMaze browser JSON contains a local absolute path");
  }
}
