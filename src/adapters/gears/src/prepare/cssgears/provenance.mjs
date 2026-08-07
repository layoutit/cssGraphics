export function sourceProvenanceFor(dataSource) {
  return {
    project: "cssGears — XScreenSaver Gears",
    dataKind: dataSource.kind,
    repository: "https://github.com/Zygo/xscreensaver",
    repositoryRole: "read-only mirror",
    sourceRevision: dataSource.sourceCommit,
    sourceRoot: dataSource.publicLabel,
    sourceFiles: dataSource.verifiedFiles,
    legal: dataSource.legalLabel,
    redistribution: dataSource.redistribution,
    implementation: "independently-authored-prepare-runtime-consuming-pinned-seeded-source-native-state-and-geometry-captures",
  };
}

export function assertNoBrowserPathLeaks(value) {
  const text = JSON.stringify(value);
  if (/\/Users\/|\\\\Users\\\\|file:\/\//.test(text)) {
    throw new Error("Generated browser JSON contains a local absolute path.");
  }
}
