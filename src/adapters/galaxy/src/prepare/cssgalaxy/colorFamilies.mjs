// SPDX-License-Identifier: HPND

export const CSSGALAXY_THREE_GALAXY_ROLES = Object.freeze(["magenta", "cyan", "off-white"]);

export const CSSGALAXY_COLOR_FAMILY = Object.freeze({
  schema: "cssgalaxy-source-derived-color-family@2",
  mode: "native-source-hues-with-prepared-perceptual-variance-and-balanced-three-role-lightness",
  signedOklabDistanceSteps: Object.freeze([-0.08, -0.04, 0, 0.04, 0.08]),
  maximumHueShiftDegrees: 30,
  threeGalaxyPresentation: Object.freeze({
    schema: "cssgalaxy-qualified-three-role-presentation@1",
    roles: CSSGALAXY_THREE_GALAXY_ROLES,
    roleAssignment: "minimum-circular-native-hue-distance-to-qualified-lead-source-anchors",
    magentaTargetHueDegrees: 300,
    cyanTargetHueDegrees: 180,
    chromaticOklabLightness: 0.78,
    offWhiteOklabLightness: 0.9,
    offWhiteOklabChroma: 0.008,
    offWhiteHueOffsetsDegrees: Object.freeze([-48, -24, 0, 24, 48]),
    minimumBlackContrastRatio: 7,
    maximumChromaticCenterOklabLightnessDelta: 0.005,
    minimumOffWhiteOklabLightnessLead: 0.1,
    maximumOffWhiteOklabLightnessLead: 0.13,
  }),
});

export function createGalaxyColorFamilies(galaxies) {
  if (!Array.isArray(galaxies) || galaxies.length < 2) {
    throw new RangeError("Galaxy color families require at least two source galaxies");
  }
  return Object.freeze(galaxies.map(({ color }) => createSourceHueFamily(color)));
}

export function createThreeGalaxyRolePalette(anchorGalaxies) {
  validateThreeGalaxies(anchorGalaxies);
  const anchorIndices = selectLeadRoleAnchorIndices(anchorGalaxies);
  const nativeAnchorColors = Object.freeze(Object.fromEntries(
    CSSGALAXY_THREE_GALAXY_ROLES.map((role) => [
    role, anchorGalaxies[anchorIndices[role]].color,
  ])));
  const chromaticLightness = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation.chromaticOklabLightness;
  const roleCenters = Object.freeze({
    magenta: balanceSourceColorLightness(nativeAnchorColors.magenta, chromaticLightness),
    cyan: balanceSourceColorLightness(nativeAnchorColors.cyan, chromaticLightness),
    "off-white": createSourceTintedOffWhite(nativeAnchorColors["off-white"]),
  });
  const roleFamilies = Object.freeze({
    magenta: createPerceptualHueFamily(roleCenters.magenta),
    cyan: createPerceptualHueFamily(roleCenters.cyan),
    "off-white": createOffWhiteHueFamily(roleCenters["off-white"]),
  });
  const contrastFloor = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation.minimumBlackContrastRatio;
  for (const family of Object.values(roleFamilies)) {
    if (family.some((color) => blackContrastRatio(color) < contrastFloor)) {
      throw new Error("Galaxy three-role family fell below the prepared black-contrast floor");
    }
  }
  const centerLightnesses = Object.fromEntries(CSSGALAXY_THREE_GALAXY_ROLES.map((role) => [
    role, hexToOklab(roleCenters[role])[0],
  ]));
  const chromaticDelta = Math.abs(centerLightnesses.magenta - centerLightnesses.cyan);
  const offWhiteLead = centerLightnesses["off-white"] -
    Math.max(centerLightnesses.magenta, centerLightnesses.cyan);
  const contract = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation;
  if (chromaticDelta > contract.maximumChromaticCenterOklabLightnessDelta + 1e-6 ||
      offWhiteLead < contract.minimumOffWhiteOklabLightnessLead - 1e-6 ||
      offWhiteLead > contract.maximumOffWhiteOklabLightnessLead + 1e-6) {
    throw new Error("Galaxy three-role center lightness balance drifted");
  }
  return Object.freeze({
    schema: "cssgalaxy-prepared-three-role-palette@1",
    anchorIndices,
    nativeAnchorColors,
    roleCenters,
    roleFamilies,
    centerBlackContrastRatios: Object.freeze(Object.fromEntries(
      CSSGALAXY_THREE_GALAXY_ROLES.map((role) => [
      role, rounded(blackContrastRatio(roleCenters[role])),
    ]))),
    centerOklabLightnesses: Object.freeze(Object.fromEntries(
      CSSGALAXY_THREE_GALAXY_ROLES.map((role) => [
      role, rounded(centerLightnesses[role]),
    ]))),
  });
}

export function createThreeGalaxyPresentation(galaxies, rolePalette) {
  validateThreeGalaxies(galaxies);
  if (rolePalette?.schema !== "cssgalaxy-prepared-three-role-palette@1") {
    throw new TypeError("Galaxy three-role presentation requires a prepared role palette");
  }
  const roles = assignGalaxiesToRoles(galaxies, rolePalette.nativeAnchorColors);
  return Object.freeze({
    schema: "cssgalaxy-prepared-three-role-assignment@1",
    roles,
    nativeSourceColors: Object.freeze(galaxies.map(({ color }) => color)),
    presentationCenters: Object.freeze(roles.map((role) => rolePalette.roleCenters[role])),
    families: Object.freeze(roles.map((role) => rolePalette.roleFamilies[role])),
  });
}

export function createSourceHueFamily(sourceColor) {
  const { hue, saturation, value } = readHexHsv(sourceColor);
  const sourceOklab = hexToOklab(sourceColor);
  return Object.freeze(CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.map((signedDistance) => {
    if (signedDistance === 0) return sourceColor;
    const direction = Math.sign(signedDistance);
    const targetDistance = Math.abs(signedDistance);
    let lowerShift = 0;
    let upperShift = CSSGALAXY_COLOR_FAMILY.maximumHueShiftDegrees;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const shift = (lowerShift + upperShift) / 2;
      const candidate = hsvToHex(hue + direction * shift, saturation, value);
      if (oklabDistance(sourceOklab, hexToOklab(candidate)) < targetDistance) lowerShift = shift;
      else upperShift = shift;
    }
    return hsvToHex(hue + direction * upperShift, saturation, value);
  }));
}

export function readHexHue(color) {
  return readHexHsv(color).hue;
}

function balanceSourceColorLightness(sourceColor, targetLightness) {
  const source = hexToOklab(sourceColor);
  const chroma = Math.hypot(source[1], source[2]);
  const hueRadians = Math.atan2(source[2], source[1]);
  return oklchToGamutMappedHex(targetLightness, chroma, hueRadians);
}

function createSourceTintedOffWhite(sourceColor) {
  const source = hexToOklab(sourceColor);
  const hueRadians = Math.atan2(source[2], source[1]);
  const contract = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation;
  return oklchToGamutMappedHex(
    contract.offWhiteOklabLightness, contract.offWhiteOklabChroma, hueRadians);
}

function createPerceptualHueFamily(centerColor) {
  const center = hexToOklab(centerColor);
  const lightness = center[0];
  const chroma = Math.hypot(center[1], center[2]);
  const hueRadians = Math.atan2(center[2], center[1]);
  return Object.freeze(CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.map((signedDistance) => {
    if (signedDistance === 0) return centerColor;
    const direction = Math.sign(signedDistance);
    const targetDistance = Math.abs(signedDistance);
    let lowerShift = 0;
    let upperShift = CSSGALAXY_COLOR_FAMILY.maximumHueShiftDegrees;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const shift = (lowerShift + upperShift) / 2;
      const candidate = oklchToGamutMappedHex(
        lightness, chroma, hueRadians + direction * shift * Math.PI / 180);
      if (oklabDistance(center, hexToOklab(candidate)) < targetDistance) lowerShift = shift;
      else upperShift = shift;
    }
    return oklchToGamutMappedHex(
      lightness, chroma, hueRadians + direction * upperShift * Math.PI / 180);
  }));
}

function createOffWhiteHueFamily(centerColor) {
  const center = hexToOklab(centerColor);
  const lightness = center[0];
  const chroma = Math.hypot(center[1], center[2]);
  const hueRadians = Math.atan2(center[2], center[1]);
  return Object.freeze(CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation.offWhiteHueOffsetsDegrees
    .map((offset) => offset === 0 ? centerColor : oklchToGamutMappedHex(
      lightness, chroma, hueRadians + offset * Math.PI / 180)));
}

function selectLeadRoleAnchorIndices(galaxies) {
  const hues = galaxies.map(({ color }) => readHexHue(color));
  const magentaTarget = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation.magentaTargetHueDegrees;
  const cyanTarget = CSSGALAXY_COLOR_FAMILY.threeGalaxyPresentation.cyanTargetHueDegrees;
  let best = null;
  for (let magenta = 0; magenta < galaxies.length; magenta += 1) {
    for (let cyan = 0; cyan < galaxies.length; cyan += 1) {
      if (cyan === magenta) continue;
      const score = circularHueDistance(hues[magenta], magentaTarget) +
        circularHueDistance(hues[cyan], cyanTarget);
      if (best === null || score < best.score) best = { magenta, cyan, score };
    }
  }
  const offWhite = [0, 1, 2].find((index) => index !== best.magenta && index !== best.cyan);
  return Object.freeze({ magenta: best.magenta, cyan: best.cyan, "off-white": offWhite });
}

function assignGalaxiesToRoles(galaxies, nativeAnchorColors) {
  const permutations = [
    ["magenta", "cyan", "off-white"],
    ["magenta", "off-white", "cyan"],
    ["cyan", "magenta", "off-white"],
    ["cyan", "off-white", "magenta"],
    ["off-white", "magenta", "cyan"],
    ["off-white", "cyan", "magenta"],
  ];
  const anchorHues = Object.fromEntries(CSSGALAXY_THREE_GALAXY_ROLES.map((role) => [
    role, readHexHue(nativeAnchorColors[role]),
  ]));
  return Object.freeze(permutations.reduce((best, roles) => {
    const score = roles.reduce((sum, role, galaxyIndex) => sum + circularHueDistance(
      readHexHue(galaxies[galaxyIndex].color), anchorHues[role]), 0);
    return best === null || score < best.score ? { roles, score } : best;
  }, null).roles);
}

function circularHueDistance(left, right) {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

function validateThreeGalaxies(galaxies) {
  if (!Array.isArray(galaxies) || galaxies.length !== 3 ||
      galaxies.some((galaxy) => !/^#[0-9a-f]{6}$/u.test(galaxy?.color ?? ""))) {
    throw new RangeError("Galaxy three-role presentation requires three native RGB galaxies");
  }
}

function readHexHsv(color) {
  if (!/^#[0-9a-f]{6}$/u.test(color)) throw new TypeError("Galaxy source color must be lowercase RGB8");
  const [red, green, blue] = readHexRgb(color).map((component) => component / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return Object.freeze({
    hue: (hue + 360) % 360,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  });
}

function hsvToHex(hue, saturation, value) {
  const wrappedHue = ((hue % 360) + 360) % 360;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((wrappedHue / 60) % 2 - 1));
  const offset = value - chroma;
  const sector = Math.floor(wrappedHue / 60);
  const rgb = sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
      : sector === 2 ? [0, chroma, x]
        : sector === 3 ? [0, x, chroma]
          : sector === 4 ? [x, 0, chroma]
            : [chroma, 0, x];
  return rgbToHex(rgb.map((component) => component + offset));
}

function hexToOklab(color) {
  const [red, green, blue] = readHexRgb(color)
    .map((component) => component / 255)
    .map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return Object.freeze([
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]);
}

function oklchToGamutMappedHex(lightness, chroma, hueRadians) {
  let lower = 0;
  let upper = chroma;
  let rgb = oklabToSrgb(lightness, Math.cos(hueRadians) * chroma, Math.sin(hueRadians) * chroma);
  if (rgb.every((component) => component >= 0 && component <= 1)) return rgbToHex(rgb);
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const candidateChroma = (lower + upper) / 2;
    const candidate = oklabToSrgb(
      lightness, Math.cos(hueRadians) * candidateChroma, Math.sin(hueRadians) * candidateChroma);
    if (candidate.every((component) => component >= 0 && component <= 1)) {
      lower = candidateChroma;
      rgb = candidate;
    } else {
      upper = candidateChroma;
    }
  }
  return rgbToHex(rgb);
}

function oklabToSrgb(lightness, a, b) {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb);
}

function blackContrastRatio(color) {
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = readHexRgb(color).map((component) => srgbToLinear(component / 255))
    .reduce((sum, component, index) => sum + component * weights[index], 0);
  return (luminance + 0.05) / 0.05;
}

function readHexRgb(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function rgbToHex(rgb) {
  return `#${rgb.map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255)
    .toString(16).padStart(2, "0")).join("")}`;
}

function srgbToLinear(component) {
  return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(component) {
  return component <= 0.0031308 ? component * 12.92 : 1.055 * component ** (1 / 2.4) - 0.055;
}

function oklabDistance(left, right) {
  return Math.hypot(...left.map((coordinate, index) => coordinate - right[index]));
}

function rounded(value) {
  return Number(value.toFixed(6));
}
