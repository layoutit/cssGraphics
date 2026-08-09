export function sourceProvenanceFor(dataSource) {
  return Object.freeze({
    project: "cssMenger — XScreenSaver Menger",
    repository: "https://github.com/Zygo/xscreensaver",
    repositoryRole: "read-only mirror of XScreenSaver 6.15",
    sourceRevision: dataSource.sourceCommit,
    sourceTree: dataSource.sourceTree,
    sourceRoot: dataSource.publicLabel,
    primaryFile: dataSource.primaryPath,
    primarySha256: dataSource.primarySha256,
    implementation: "independently-authored-prepare-runtime-consuming-pinned-source-semantics",
  });
}

export function assertNoBrowserPathLeaks(value) {
  const text = JSON.stringify(value);
  if (/\/Users\/|\\\\Users\\\\|file:\/\//.test(text)) {
    throw new Error("Generated browser JSON contains a local absolute path.");
  }
}
