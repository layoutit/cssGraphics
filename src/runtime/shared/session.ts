import {
  CssGraphicsPackageError,
} from "../../model-package/modelPackage.mjs";
import {
  resolveCssGraphicsPackageCatalogEntry,
  type ValidatedCssGraphicsPackageCatalog,
} from "./catalog.mjs";
import type { CssGraphicsDriver } from "./driver.js";
import {
  mountCssGraphicsExperienceModePicker,
  type CssGraphicsExperienceModePicker,
} from "./experienceModePicker.js";
import {
  loadSelectedCssGraphicsModel,
  type LoadedCssGraphicsModel,
} from "./loader.js";
import {
  cssGraphicsModelUrl,
  resolveCssGraphicsRoute,
} from "./route.js";

type HistoryMode = "push" | "none";

export interface LoadedCssGraphicsModelBinding {
  readonly modelId: string;
  readonly profile: string;
  start(host: HTMLElement): CssGraphicsDriver;
  discard(): void;
}

export interface CssGraphicsRuntimeAdapter {
  readonly profile: string;
  bind(loaded: LoadedCssGraphicsModel): LoadedCssGraphicsModelBinding;
}

export interface CssGraphicsSessionStats {
  readonly mounts: number;
  readonly teardowns: number;
  readonly switches: number;
  readonly liveDrivers: number;
  readonly maxConcurrentDrivers: number;
  readonly failedSwitches: number;
}

export interface CssGraphicsSession {
  readonly root: HTMLElement;
  readonly modelHost: HTMLElement;
  readonly currentModelId: string;
  readonly currentDriver: CssGraphicsDriver;
  readonly experienceModePicker?: CssGraphicsExperienceModePicker;
  readonly stats: CssGraphicsSessionStats;
  readonly destroyed: boolean;
  switchModel(modelId: string, historyMode?: HistoryMode): Promise<void>;
  destroy(): void;
}

export interface StartCssGraphicsSessionOptions {
  readonly host: HTMLElement;
  readonly catalog: ValidatedCssGraphicsPackageCatalog;
  readonly initialModelId: string;
  readonly adapters: ReadonlyMap<string, CssGraphicsRuntimeAdapter>;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly experienceControls?: boolean;
}

function runtimeAdapter(
  adapters: ReadonlyMap<string, CssGraphicsRuntimeAdapter>,
  profile: string,
): CssGraphicsRuntimeAdapter {
  const adapter = adapters.get(profile);
  if (!adapter || adapter.profile !== profile) {
    throw new CssGraphicsPackageError(
      "unsupported-profile",
      `No cssGraphics runtime adapter is registered for ${profile}.`,
    );
  }
  return adapter;
}

function bindLoadedCssGraphicsModel(
  adapters: ReadonlyMap<string, CssGraphicsRuntimeAdapter>,
  loaded: LoadedCssGraphicsModel,
): LoadedCssGraphicsModelBinding {
  let binding: LoadedCssGraphicsModelBinding;
  try {
    binding = runtimeAdapter(adapters, loaded.manifest.profile).bind(loaded);
  } catch (error) {
    loaded.assetOwner.destroy();
    throw error;
  }
  if (binding.modelId !== loaded.manifest.id
    || binding.profile !== loaded.manifest.profile) {
    binding.discard();
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      "The cssGraphics runtime adapter bound the wrong model or profile.",
    );
  }
  return binding;
}

export async function startCssGraphicsSession(
  options: StartCssGraphicsSessionOptions,
): Promise<CssGraphicsSession> {
  if (!options.host || !options.host.ownerDocument) {
    throw new TypeError("The cssGraphics session requires an HTMLElement host.");
  }
  resolveCssGraphicsPackageCatalogEntry(options.catalog, options.initialModelId);
  if (!(options.adapters instanceof Map) || options.adapters.size === 0) {
    throw new TypeError("The cssGraphics session requires runtime adapters.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const root = options.host;
  const modelHost = options.host;
  const baseUrl = options.baseUrl ?? "/cssgraphics/";
  const hadHostClass = root.classList.contains("cssgraphics-host");
  root.classList.add("cssgraphics-host");
  options.host.replaceChildren();

  let currentModelId = options.initialModelId;
  let currentDriver: CssGraphicsDriver | undefined;
  let destroyed = false;
  let mounts = 0;
  let teardowns = 0;
  let switches = 0;
  let liveDrivers = 0;
  let maxConcurrentDrivers = 0;
  let failedSwitches = 0;
  let switchChain = Promise.resolve();
  let experienceModePicker: CssGraphicsExperienceModePicker | undefined;

  const loadBinding = async (modelId: string): Promise<LoadedCssGraphicsModelBinding> => {
    const loaded = await loadSelectedCssGraphicsModel(
      fetchImpl,
      options.catalog,
      modelId,
      baseUrl,
    );
    if (destroyed) {
      loaded.assetOwner.destroy();
      throw new Error("The cssGraphics session was destroyed during loading.");
    }
    return bindLoadedCssGraphicsModel(options.adapters, loaded);
  };

  const mountBinding = (
    binding: LoadedCssGraphicsModelBinding,
  ): CssGraphicsDriver => {
    try {
      const driver = binding.start(modelHost);
      mounts += 1;
      liveDrivers += 1;
      maxConcurrentDrivers = Math.max(maxConcurrentDrivers, liveDrivers);
      return driver;
    } catch (error) {
      binding.discard();
      throw error;
    }
  };

  try {
    currentDriver = mountBinding(await loadBinding(currentModelId));
    if (options.experienceControls !== false) {
      experienceModePicker = mountCssGraphicsExperienceModePicker({
        host: root,
        getDriver: () => {
          if (!currentDriver) throw new Error("The cssGraphics session has no live driver.");
          return currentDriver;
        },
      });
    }
  } catch (error) {
    options.host.replaceChildren();
    if (!hadHostClass) root.classList.remove("cssgraphics-host");
    throw error;
  }

  const performSwitch = async (
    modelId: string,
    historyMode: HistoryMode,
  ): Promise<void> => {
    if (destroyed) throw new Error("The cssGraphics session is destroyed.");
    if (modelId === currentModelId && currentDriver && !currentDriver.destroyed) return;
    resolveCssGraphicsPackageCatalogEntry(options.catalog, modelId);
    let binding: LoadedCssGraphicsModelBinding;
    try {
      binding = await loadBinding(modelId);
    } catch (error) {
      failedSwitches += 1;
      throw error;
    }

    const oldDriver = currentDriver;
    currentDriver = undefined;
    if (oldDriver) {
      try {
        oldDriver.destroy();
      } catch (teardownError) {
        failedSwitches += 1;
        try {
          binding.discard();
        } catch (discardError) {
          throw new AggregateError(
            [teardownError, discardError],
            `Failed to replace cssGraphics model ${currentModelId}.`,
          );
        } finally {
          teardowns += 1;
          liveDrivers -= 1;
        }
        throw teardownError;
      }
      teardowns += 1;
      liveDrivers -= 1;
    }
    try {
      currentDriver = mountBinding(binding);
      currentModelId = modelId;
      switches += 1;
      experienceModePicker?.sync();
      if (historyMode === "push") {
        globalThis.history.pushState(
          { modelId },
          "",
          cssGraphicsModelUrl(modelId, options.catalog.defaultId),
        );
      }
    } catch (error) {
      failedSwitches += 1;
      throw error;
    }
  };

  const enqueueSwitch = (
    modelId: string,
    historyMode: HistoryMode = "push",
  ): Promise<void> => {
    const next = switchChain.then(() => performSwitch(modelId, historyMode));
    switchChain = next.catch(() => {});
    return next;
  };

  const onPopState = (): void => {
    try {
      const route = resolveCssGraphicsRoute(
        new URL(globalThis.location.href),
        options.catalog.defaultId,
      );
      void enqueueSwitch(route.modelId, "none").catch(
        (error: unknown) => globalThis.console.error(error),
      );
    } catch (error) {
      globalThis.console.error(error);
    }
  };
  globalThis.addEventListener("popstate", onPopState);

  return Object.freeze({
    root,
    modelHost,
    get currentModelId(): string { return currentModelId; },
    get currentDriver(): CssGraphicsDriver {
      if (!currentDriver) throw new Error("The cssGraphics session has no live driver.");
      return currentDriver;
    },
    get experienceModePicker(): CssGraphicsExperienceModePicker | undefined {
      return experienceModePicker;
    },
    get stats(): CssGraphicsSessionStats {
      return Object.freeze({
        mounts,
        teardowns,
        switches,
        liveDrivers,
        maxConcurrentDrivers,
        failedSwitches,
      });
    },
    get destroyed(): boolean { return destroyed; },
    switchModel(
      modelId: string,
      historyMode: HistoryMode = "push",
    ): Promise<void> {
      return enqueueSwitch(modelId, historyMode);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      const errors: unknown[] = [];
      globalThis.removeEventListener("popstate", onPopState);
      try {
        experienceModePicker?.destroy();
      } catch (error) {
        errors.push(error);
      }
      experienceModePicker = undefined;
      if (currentDriver) {
        const driver = currentDriver;
        currentDriver = undefined;
        try {
          driver.destroy();
        } catch (error) {
          errors.push(error);
        } finally {
          teardowns += 1;
          liveDrivers -= 1;
        }
      }
      try {
        options.host.replaceChildren();
        if (!hadHostClass) root.classList.remove("cssgraphics-host");
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to destroy the cssGraphics session.");
      }
    },
  });
}
