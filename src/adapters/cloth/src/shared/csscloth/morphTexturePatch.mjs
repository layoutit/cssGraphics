const CLOTH_ATLAS_GUTTER = 1;

export function createPolyMorphPreparedCornerTextureTarget(mounted, resources, triangleCount, logoAtlas) {
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
  if (!Number.isSafeInteger(columns) || columns < 1 || firstAtlas.height !== firstAtlas.width ||
      handles.some(({ plan }) => plan.width !== 28 || plan.height !== 28) ||
      atlases.some((atlas) => atlas.width !== firstAtlas.width || atlas.height !== firstAtlas.height ||
        atlas.pageWidth !== firstAtlas.pageWidth || atlas.pageHeight !== firstAtlas.pageHeight)) {
    URL.revokeObjectURL(url);
    URL.revokeObjectURL(logoUrl);
    throw new Error("Cloth prepared atlas grid is invalid");
  }
  if (!Number.isSafeInteger(logoAtlas?.pageWidth) || logoAtlas.pageWidth < 1 ||
      !Number.isSafeInteger(logoAtlas?.pageHeight) || logoAtlas.pageHeight < 1 ||
      logoAtlas.leafWidth !== firstAtlas.width || logoAtlas.leafHeight !== firstAtlas.height ||
      logoAtlas.gutter !== gutter || !Number.isSafeInteger(logoAtlas.columns) ||
      logoAtlas.columns < 1 || logoAtlas.pageWidth !== logoAtlas.columns * stride ||
      Math.ceil(handles.length / logoAtlas.columns) * stride !== logoAtlas.pageHeight) {
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
    `${logoAtlas.pageWidth}px ${logoAtlas.pageHeight}px`,
  );
  const positions = new Array(handles.length);
  const logoPositions = new Array(handles.length);

  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    const atlas = atlases[index];
    const { element } = handle;
    const position = `${-atlas.x}px ${-atlas.y}px`;
    const logoPosition = `${-(index % logoAtlas.columns * stride + gutter)}px ${-(Math.floor(index / logoAtlas.columns) * stride + gutter)}px`;
    positions[index] = position;
    logoPositions[index] = logoPosition;
    element.style.backgroundPosition = `${logoPosition}, ${position}`;
  }

  return Object.freeze({
    handles: Object.freeze(handles),
    writeSlot(index, slot) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= handles.length ||
          !Number.isSafeInteger(slot) || slot < 0) {
        throw new RangeError("Cloth prepared atlas slot is out of range");
      }
      const position = `${-(slot % columns * stride + gutter)}px ${-(Math.floor(slot / columns) * stride + gutter)}px`;
      if (positions[index] === position) return false;
      handles[index].element.style.backgroundPosition = `${logoPositions[index]}, ${position}`;
      positions[index] = position;
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
