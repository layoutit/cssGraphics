const INLINE_ATLAS = /background-image:\s*url\(&quot;(data:image\/png;base64,[A-Za-z0-9+/=]+)&quot;\);\s*/gu;

export function hoistPreparedSnapshotAtlas(html, expectedWallLeafCount) {
  if (typeof html !== "string" || !Number.isInteger(expectedWallLeafCount) ||
      expectedWallLeafCount < 1) {
    throw new TypeError("Prepared snapshot atlas input is invalid");
  }
  const matches = [...html.matchAll(INLINE_ATLAS)];
  const atlases = new Set(matches.map((match) => match[1]));
  if (matches.length !== expectedWallLeafCount || atlases.size !== 1) {
    throw new Error(
      `Prepared snapshot expected one atlas on ${expectedWallLeafCount} wall leaves`,
    );
  }
  const [atlas] = atlases;
  const sharedStyle =
    `<style data-csspipes-prepared-shared-atlas="true">` +
    `[data-csspipes-surface="wall"][data-csspipes-material-binding="prepared-clip"] { ` +
    `background-image: url("${atlas}"); }</style>`;
  return html.replace(INLINE_ATLAS, "").replace("</head>", `${sharedStyle}</head>`);
}
