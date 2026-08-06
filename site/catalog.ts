import catalogData from "./public/catalog.json";

export type DistributionMediaType =
  | "application/xml"
  | "application/json"
  | "image/png"
  | "image/webp"
  | "text/css"
  | "text/plain";

export type DistributionResourceRole =
  | "animation-plan"
  | "image"
  | "presentation"
  | "runtime"
  | "stylesheet";

export interface DistributionResource {
  readonly role: DistributionResourceRole;
  readonly path: string;
  readonly mediaType: DistributionMediaType;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DistributionSource {
  readonly authors: readonly string[];
  readonly url: string;
  readonly sha256: string;
  readonly changes: string;
  readonly license: string;
  readonly licenseUrl: string;
}

export interface DistributionRuntime {
  readonly package: string;
  readonly version: string;
  readonly license: string;
}

export interface DistributedAsset {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly mode: "animated-clips" | "animation-clip" | "morph-targets";
  readonly clipId?: string;
  readonly kind: string;
  readonly polygons: number;
  readonly preview: Omit<DistributionResource, "role">;
  readonly previewTimeMs: number;
  readonly previewZoom: number;
  readonly resources: readonly DistributionResource[];
  readonly source: DistributionSource;
}

export interface DistributionCatalog {
  readonly schema: "cssgraphics.distribution@1";
  readonly runtime: DistributionRuntime;
  readonly assets: readonly DistributedAsset[];
}

if (catalogData.schema !== "cssgraphics.distribution@1") {
  throw new Error(`Unsupported css.graphics distribution: ${catalogData.schema}.`);
}

export const DISTRIBUTION_CATALOG =
  catalogData as unknown as DistributionCatalog;

export const DISTRIBUTED_ASSETS = DISTRIBUTION_CATALOG.assets;

export function distributionResource(
  asset: DistributedAsset,
  role: Exclude<DistributionResourceRole, "image">,
): DistributionResource {
  const matches = asset.resources.filter((resource) => resource.role === role);
  if (matches.length !== 1) {
    throw new Error(`${asset.id} must declare exactly one ${role} resource.`);
  }
  return matches[0]!;
}

export function distributionResourceUrl(
  asset: DistributedAsset,
  resource: DistributionResource,
): string {
  return `/${asset.root}/${resource.path}`;
}
