export function sourceProvenanceFor(dataSource) {
  return {
    project: "cssFlower — Microsoft Flower Box",
    dataKind: dataSource.kind,
    behaviorAuthority: "src/adapters/flowerbox/README.md",
    sourceRevision: "DigitalMars/dmc@9478d25a677f70dbe4fc0ed317cc5a5e5050ef8b",
    sourceFiles: [
      { id: "GEOM.C", sha256: "7689779fd3e37a06245f38a0190b863a8ee4c4ed0364d8799206c37f549a69ff" },
      { id: "GEOM.H", sha256: "6d8d179530db1bc26ed2f30430f3280cafe8cb598aa671aa57a4121bed3edadf" },
      { id: "SSFLWBOX.C", sha256: "5322ab133840f5fbd7a4de2d1d701f7c5f333295442c8d728409869bec95d168" },
      { id: "SSFLWBOX.H", sha256: "dfcb99b876480ee5e29b0f72ac9650fb8e2790e8efa023154f974c12cd2ad822" },
    ],
    localAuthorityLabel: dataSource.publicLabel,
    nativeAuthorityStatus: dataSource.nativeAuthorityStatus,
    nativeQualification: dataSource.nativeQualification ?? null,
    legal: dataSource.legalLabel ?? "user-supplied-data-not-redistributed",
    acquisition: dataSource.nativeQualification
      ? "explicit-user-authorized-local-git-fetch-ignored-not-redistributed"
      : "none",
    redistributableUpstreamBytes: false,
  };
}

export function assertNoBrowserPathLeaks(value) {
  const text = JSON.stringify(value);
  if (/\/Users\/|\\\\Users\\\\|file:\/\//.test(text)) {
    throw new Error("Generated browser JSON contains a local absolute path.");
  }
}
