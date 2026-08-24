// SPDX-License-Identifier: HPND

export function createGalaxyColorProperties(galaxyCount, familyVariantCount) {
  assertCounts(galaxyCount, familyVariantCount);
  return Object.freeze(Array.from({ length: galaxyCount * familyVariantCount }, (_, index) => {
    const galaxyIndex = Math.floor(index / familyVariantCount);
    const variantIndex = index % familyVariantCount;
    return `--cssgalaxy-color-${galaxyIndex}-${variantIndex}`;
  }));
}

export function createGalaxyColorStylesheet(prefixStarCounts, familyVariantCount,
  preparedColors = null) {
  if (!Array.isArray(prefixStarCounts) || prefixStarCounts.length < 2 ||
      prefixStarCounts.some((count) => !Number.isSafeInteger(count) || count < 1)) {
    throw new RangeError("Galaxy color stylesheet requires positive source-family ranges");
  }
  assertCounts(prefixStarCounts.length, familyVariantCount);
  let rangeStart = 1;
  const rules = [];
  if (preparedColors !== null) {
    const properties = createGalaxyColorProperties(prefixStarCounts.length, familyVariantCount);
    if (!Array.isArray(preparedColors) || preparedColors.length !== properties.length ||
        preparedColors.some((color) => !/^#[0-9a-f]{6}$/u.test(color))) {
      throw new RangeError("Galaxy prepared color cohort is invalid");
    }
    rules.push(`.polycss-scene{${properties.map(
      (property, index) => `${property}:${preparedColors[index]}`).join(";")}}`);
  }
  for (let galaxyIndex = 0; galaxyIndex < prefixStarCounts.length; galaxyIndex += 1) {
    const rangeEnd = rangeStart + prefixStarCounts[galaxyIndex] - 1;
    for (let variantIndex = 0; variantIndex < familyVariantCount; variantIndex += 1) {
      const firstChild = rangeStart + variantIndex;
      const remainder = firstChild % familyVariantCount;
      const lane = remainder === 0 ? `${familyVariantCount}n` : `${familyVariantCount}n+${remainder}`;
      rules.push(`.polycss-scene>b:nth-child(n+${rangeStart}):nth-child(-n+${rangeEnd})` +
        `:nth-child(${lane}){color:var(--cssgalaxy-color-${galaxyIndex}-${variantIndex})}`);
    }
    rangeStart = rangeEnd + 1;
  }
  return Object.freeze({ stylesheet: rules.join(""), leafCount: rangeStart - 1 });
}

function assertCounts(galaxyCount, familyVariantCount) {
  if (!Number.isSafeInteger(galaxyCount) || galaxyCount < 2 ||
      !Number.isSafeInteger(familyVariantCount) || familyVariantCount < 1) {
    throw new RangeError("Galaxy color-family cardinality is invalid");
  }
}
