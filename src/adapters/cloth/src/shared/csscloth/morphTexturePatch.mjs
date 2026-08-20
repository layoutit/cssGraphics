const CLOTH_ATLAS_GUTTER = 1;

export function createPolyMorphPreparedCornerTextureTarget(
  mounted,
  resources,
  triangleCount,
  logoAtlas,
  lightingAtlas,
) {
  const handles = Array.from({ length: triangleCount }, (_, triangleIndex) =>
    mounted.leafHandles.get(`leaf-cloth-${String(triangleIndex).padStart(3, "0")}`));
  if (handles.some((handle) => !handle || handle.element.localName !== "u")) {
    throw new Error("Cloth requires PolyCSS corner-shape triangle leaves");
  }
  if (!CSS.supports("corner-top-left-shape", "bevel") ||
      !CSS.supports("corner-top-right-shape", "bevel")) {
    throw new Error("Cloth requires CSS corner-shape support");
  }
  const atlases = handles.map((handle) => handle.plan.fallback?.atlas);
  const resourcePath = atlases[0]?.resourcePath;
  if (!resourcePath || atlases.some((atlas) => !atlas || atlas.resourcePath !== resourcePath)) {
    throw new Error("Cloth prepared atlas binding is incomplete");
  }
  const resource = resources.get(resourcePath);
  if (!resource) throw new Error(`Cloth prepared atlas is missing: ${resourcePath}`);
  const logoResourcePath = resourcePath.replace(/\/cloth-(\d+)\.png$/u, "/cloth-logo-$1.png");
  const logoResource = resources.get(logoResourcePath);
  if (!logoResource) throw new Error(`Cloth prepared logo atlas is missing: ${logoResourcePath}`);
  const url = URL.createObjectURL(new Blob([resource.bytes], { type: resource.descriptor.mediaType }));
  const logoUrl = URL.createObjectURL(new Blob([
    logoResource.bytes,
  ], { type: logoResource.descriptor.mediaType }));
  const firstAtlas = atlases[0];
  const gutter = CLOTH_ATLAS_GUTTER;
  const stride = firstAtlas.width + gutter * 2;
  const columns = firstAtlas.pageWidth / stride;
  const rowCount = firstAtlas.pageHeight / stride;
  if (!Number.isSafeInteger(columns) || columns < 1 ||
      !Number.isSafeInteger(rowCount) || rowCount < 1 ||
      firstAtlas.height !== firstAtlas.width ||
      handles.some(({ plan }) => plan.width !== 28 || plan.height !== 28) ||
      atlases.some((atlas) => atlas.width !== firstAtlas.width || atlas.height !== firstAtlas.height ||
        atlas.pageWidth !== firstAtlas.pageWidth || atlas.pageHeight !== firstAtlas.pageHeight)) {
    URL.revokeObjectURL(url);
    URL.revokeObjectURL(logoUrl);
    throw new Error("Cloth prepared atlas grid is invalid");
  }
  const logoRasterScale = logoAtlas?.rasterScale;
  const logoStride = logoAtlas?.leafWidth + logoAtlas?.gutter * 2;
  const logoRowCount = logoAtlas?.pageHeight / logoStride;
  const logoSlotCount = logoAtlas?.columns * logoRowCount;
  const lightingPositions = Array.from({ length: columns * rowCount }, (_, slot) =>
    `${-(slot % columns * stride + gutter)}px ${-(Math.floor(slot / columns) * stride + gutter)}px`);
  if (!Number.isSafeInteger(logoRasterScale) || logoRasterScale < 1 ||
      !Number.isSafeInteger(logoAtlas?.pageWidth) || logoAtlas.pageWidth < 1 ||
      !Number.isSafeInteger(logoAtlas?.pageHeight) || logoAtlas.pageHeight < 1 ||
      logoAtlas.leafWidth !== firstAtlas.width * logoRasterScale ||
      logoAtlas.leafHeight !== firstAtlas.height * logoRasterScale ||
      logoAtlas.gutter !== gutter * logoRasterScale ||
      !Number.isSafeInteger(logoAtlas.columns) || logoAtlas.columns < 1 ||
      !Number.isSafeInteger(logoRowCount) || logoRowCount < 1 ||
      logoAtlas.pageWidth !== logoAtlas.columns * logoStride ||
      !Array.isArray(logoAtlas.triangleSlots) ||
      logoAtlas.triangleSlots.length !== handles.length ||
      logoAtlas.triangleSlots.some((slot) =>
        !Number.isSafeInteger(slot) || slot < 0 || slot >= logoSlotCount) ||
      !Array.isArray(lightingAtlas?.triangleSlots) ||
      lightingAtlas.triangleSlots.length !== handles.length ||
      lightingAtlas.triangleSlots.some((slots) => !Array.isArray(slots) || slots.length < 1 ||
        slots.some((slot) => !Number.isSafeInteger(slot) ||
          slot < 0 || slot >= lightingPositions.length))) {
    URL.revokeObjectURL(url);
    URL.revokeObjectURL(logoUrl);
    throw new Error("Cloth prepared logo atlas grid is invalid");
  }
  mounted.cameraElement.style.setProperty("--csscloth-atlas", `url("${url}")`);
  mounted.cameraElement.style.setProperty("--csscloth-logo-atlas", `url("${logoUrl}")`);
  mounted.cameraElement.style.setProperty(
    "--csscloth-atlas-size",
    `${firstAtlas.pageWidth}px ${firstAtlas.pageHeight}px`,
  );
  mounted.cameraElement.style.setProperty(
    "--csscloth-logo-atlas-size",
    `${logoAtlas.pageWidth / logoRasterScale}px ${logoAtlas.pageHeight / logoRasterScale}px`,
  );
  const currentSlots = new Int32Array(handles.length);
  currentSlots.fill(-1);
  const backgroundPositions = new Array(handles.length);

  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    const atlas = atlases[index];
    const { element } = handle;
    const slotColumn = (atlas.x - gutter) / stride;
    const slotRow = (atlas.y - gutter) / stride;
    const slot = slotRow * columns + slotColumn;
    if (!Number.isSafeInteger(slotColumn) || !Number.isSafeInteger(slotRow) ||
        slot < 0 || slot >= lightingPositions.length) {
      throw new Error("Cloth prepared atlas slot is invalid");
    }
    const logoSlot = logoAtlas.triangleSlots[index];
    const logoPosition = `${-(logoSlot % logoAtlas.columns * logoStride + logoAtlas.gutter) / logoRasterScale}px ${-(Math.floor(logoSlot / logoAtlas.columns) * logoStride + logoAtlas.gutter) / logoRasterScale}px`;
    const positions = new Map();
    for (const lightingSlot of lightingAtlas.triangleSlots[index]) {
      if (!positions.has(lightingSlot)) {
        positions.set(lightingSlot, `${logoPosition}, ${lightingPositions[lightingSlot]}`);
      }
    }
    const position = positions.get(slot);
    if (position === undefined) {
      throw new Error("Cloth prepared initial atlas slot is invalid");
    }
    currentSlots[index] = slot;
    backgroundPositions[index] = positions;
    element.style.backgroundPosition = position;
  }

  return Object.freeze({
    handles: Object.freeze(handles),
    writeSlot(index, slot) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= handles.length ||
          !Number.isSafeInteger(slot) || slot < 0) {
        throw new RangeError("Cloth prepared atlas slot is out of range");
      }
      if (currentSlots[index] === slot) return false;
      const position = backgroundPositions[index].get(slot);
      if (position === undefined) {
        throw new RangeError("Cloth prepared atlas slot is out of range");
      }
      handles[index].element.style.backgroundPosition = position;
      currentSlots[index] = slot;
      return true;
    },
    destroy() {
      mounted.cameraElement.style.removeProperty("--csscloth-atlas");
      mounted.cameraElement.style.removeProperty("--csscloth-logo-atlas");
      mounted.cameraElement.style.removeProperty("--csscloth-atlas-size");
      mounted.cameraElement.style.removeProperty("--csscloth-logo-atlas-size");
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(logoUrl);
    },
  });
}
