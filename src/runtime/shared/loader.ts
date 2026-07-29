import type {
  CssGraphicsAssetDescriptor,
  CssGraphicsModelData,
  CssGraphicsModelManifest,
} from "../../model-package/modelPackage.mjs";
import {
  CssGraphicsPackageError,
  validateCssGraphicsModelPackage,
} from "../../model-package/modelPackage.mjs";
import {
  modelPackageBaseUrl,
  resolveCssGraphicsPackageCatalogEntry,
  type ValidatedCssGraphicsPackageCatalog,
} from "./catalog.mjs";

export interface LoadedCssGraphicsModel {
  readonly manifest: CssGraphicsModelManifest;
  readonly model: CssGraphicsModelData;
  readonly assetOwner: LoadedModelAssetOwner;
  readonly styles: string;
}

export interface LoadedModelAsset {
  readonly role: string;
  readonly path: string;
  readonly mediaType: "image/webp";
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly url: string;
}

export interface LoadedModelAssetOwner {
  readonly assets: Readonly<Record<string, LoadedModelAsset>>;
  readonly destroyed: boolean;
  get(role: string): LoadedModelAsset;
  destroy(): void;
}

export interface LoadedModelStyleOwner {
  readonly element: HTMLStyleElement;
  readonly destroyed: boolean;
  destroy(): void;
}

async function requestBytes(fetchImpl: typeof fetch, path: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(path, { cache: "no-store" });
  } catch {
    throw new CssGraphicsPackageError("missing-artifact", `cssGraphics could not request ${path}.`);
  }
  if (!response.ok) {
    throw new CssGraphicsPackageError(
      response.status === 404 ? "missing-artifact" : "invalid-artifact-request",
      `cssGraphics request ${path} returned HTTP ${response.status}.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createLoadedModelAssetOwner(
  descriptors: Readonly<Record<string, CssGraphicsAssetDescriptor>>,
  bytesByRole: ReadonlyMap<string, Uint8Array>,
): LoadedModelAssetOwner {
  const assets: Record<string, LoadedModelAsset> = {};
  const createdUrls: string[] = [];
  try {
    for (const [role, descriptor] of Object.entries(descriptors)) {
      const bytes = bytesByRole.get(role);
      if (!bytes) {
        throw new CssGraphicsPackageError(
          "asset-binding-mismatch",
          `Validated asset bytes for ${role} are absent.`,
        );
      }
      const blob = new Blob(
        [Uint8Array.from(bytes).buffer],
        { type: descriptor.mediaType },
      );
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      assets[role] = Object.freeze({
        role,
        path: descriptor.path,
        mediaType: descriptor.mediaType,
        bytes: descriptor.bytes,
        sha256: descriptor.sha256,
        width: descriptor.width,
        height: descriptor.height,
        url,
      });
    }
  } catch (error) {
    for (const url of createdUrls) URL.revokeObjectURL(url);
    throw error;
  }
  const bindings = Object.freeze(assets);
  let destroyed = false;
  return Object.freeze({
    assets: bindings,
    get destroyed(): boolean { return destroyed; },
    get(role: string): LoadedModelAsset {
      if (destroyed) throw new Error("Loaded model assets are destroyed.");
      const asset = bindings[role];
      if (!asset) {
        throw new CssGraphicsPackageError(
          "asset-binding-mismatch",
          `Validated asset binding ${role} is absent.`,
        );
      }
      return asset;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const asset of Object.values(bindings)) {
        URL.revokeObjectURL(asset.url);
      }
    },
  });
}

export async function loadSelectedCssGraphicsModel(
  fetchImpl: typeof fetch,
  catalog: ValidatedCssGraphicsPackageCatalog,
  modelId: string,
  baseUrl = "/cssgraphics/",
): Promise<LoadedCssGraphicsModel> {
  if (typeof fetchImpl !== "function") throw new TypeError("A model fetch function is required.");
  const entry = resolveCssGraphicsPackageCatalogEntry(catalog, modelId);
  const assetBase = modelPackageBaseUrl(entry, baseUrl);
  const manifestBytes = await requestBytes(fetchImpl, `${assetBase}manifest.json`);
  const validated = await validateCssGraphicsModelPackage({
    manifestBytes,
    loadResource: (path) => requestBytes(fetchImpl, `${assetBase}${path}`),
    catalogEntry: entry,
  });
  const assetOwner = createLoadedModelAssetOwner(
    validated.manifest.resources.assets,
    validated.assets,
  );
  return Object.freeze({
    manifest: validated.manifest,
    model: validated.model,
    assetOwner,
    styles: validated.styles,
  });
}

export function installLoadedModelStyles(
  loaded: LoadedCssGraphicsModel,
  host: HTMLElement,
): LoadedModelStyleOwner {
  if (!host?.ownerDocument) {
    throw new TypeError("Loaded model styles require an HTMLElement host.");
  }
  const document = host.ownerDocument;
  const modelScope = `[data-cssgraphics-model="${loaded.manifest.id}"]`;
  const documentScope = `html:has(${modelScope})`;
  const style = document.createElement("style");
  style.dataset.cssgraphicsModelStyle = loaded.manifest.contentHash;
  let css = loaded.styles
    .replaceAll(`${documentScope} > body`, modelScope)
    .replaceAll(documentScope, modelScope);
  for (const asset of Object.values(loaded.assetOwner.assets)) {
    css = css
      .replaceAll(`url("./${asset.path}")`, `url("${asset.url}")`)
      .replaceAll(`url('./${asset.path}')`, `url('${asset.url}')`)
      .replaceAll(`url(./${asset.path})`, `url("${asset.url}")`);
  }
  if (/url\((?:"|')?\.\/assets\//u.test(css)) {
    throw new CssGraphicsPackageError(
      "asset-binding-mismatch",
      "Model CSS contains an unowned asset URL.",
    );
  }
  style.textContent = css;
  document.head.appendChild(style);
  let destroyed = false;
  return Object.freeze({
    element: style,
    get destroyed(): boolean { return destroyed; },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      style.remove();
    },
  });
}
