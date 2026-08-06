const INLINE_ATLAS = /background-image:\s*url\(&quot;(data:image\/png;base64,[A-Za-z0-9+/=]+)&quot;\);\s*/gu;

export function hoistPreparedSnapshotAtlas(html, expectedWallLeafCount, backgroundSize) {
  if (typeof html !== "string" || !Number.isInteger(expectedWallLeafCount) ||
      expectedWallLeafCount < 1 || typeof backgroundSize !== "string") {
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
    `<style>` +
    `.polycss-scene > div > b { ` +
    `background-image: url("${atlas}"); ` +
    `background-color: transparent; background-repeat: no-repeat; ` +
    `background-position-y: 0; background-size: ${backgroundSize}; ` +
    `backface-visibility: visible; transition: none; }</style>`;
  return html
    .replace(INLINE_ATLAS, "")
    .replace(/\s*color:\s*rgb\(0, 0, 0\);/gu, "")
    .replace("</head>", `${sharedStyle}</head>`);
}
