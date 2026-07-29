export const CSSGRAPHICS_DEFAULT_BASE_URL = "/cssgraphics/" as const;

export class InvalidCssGraphicsRouteError extends Error {
  readonly code = "invalid-route" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidCssGraphicsRouteError";
  }
}

export interface CssGraphicsPackageCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
}

export interface CssGraphicsPackageCatalog {
  readonly schema: "cssgraphics.catalog@1";
  readonly generationHash: string;
  readonly defaultId: string;
  readonly models: readonly CssGraphicsPackageCatalogRow[];
  readonly contentHash: string;
}

export type CssGraphicsExperienceMode = "animation" | "interaction";

export interface CssGraphicsDriver {
  readonly modelId: string;
  readonly generationHash: string;
  readonly experienceModes: readonly CssGraphicsExperienceMode[];
  readonly experienceMode: CssGraphicsExperienceMode;
  readonly tick: number;
  readonly destroyed: boolean;
  setExperienceMode(mode: CssGraphicsExperienceMode): void;
  destroy(): void;
}

export interface CssGraphicsExperience {
  readonly root: HTMLElement;
  readonly currentModelId: string;
  readonly currentDriver: CssGraphicsDriver;
  readonly destroyed: boolean;
  switchModel(modelId: string, historyMode?: "push" | "none"): Promise<void>;
  destroy(): void;
}

export interface CssGraphicsMountOptions {
  readonly baseUrl?: string;
  readonly modelId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly experienceControls?: boolean;
}
