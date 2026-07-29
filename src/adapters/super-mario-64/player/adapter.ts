import {
  installLoadedModelStyles,
  type LoadedCssGraphicsModel,
} from "../../../runtime/shared/loader.js";
import type {
  CssGraphicsRuntimeAdapter,
  LoadedCssGraphicsModelBinding,
} from "../../../runtime/shared/session.js";
import { startMarioPlayerDriver } from "./client.js";
import {
  decodeMarioProgram,
  SUPER_MARIO_64_PROFILE,
  type MarioProgram,
} from "./model.js";

function bindMarioPlayer(
  loaded: LoadedCssGraphicsModel,
): LoadedCssGraphicsModelBinding {
  let program: MarioProgram;
  try {
    program = decodeMarioProgram(loaded);
  } catch (error) {
    loaded.assetOwner.destroy();
    throw error;
  }
  let started = false;
  let discarded = false;
  return Object.freeze({
    modelId: loaded.manifest.id,
    profile: SUPER_MARIO_64_PROFILE,
    start(host: HTMLElement) {
      if (discarded) throw new Error("The loaded Mario program was discarded.");
      if (started) throw new Error("The loaded Mario program was already started.");
      started = true;

      const hadModelAttribute = host.hasAttribute("data-cssgraphics-model");
      const previousModelId = host.getAttribute("data-cssgraphics-model");
      let styles;
      try {
        styles = installLoadedModelStyles(loaded, host);
      } catch (error) {
        loaded.assetOwner.destroy();
        throw error;
      }
      host.dataset.cssgraphicsModel = loaded.manifest.id;
      const release = (): void => {
        styles.destroy();
        loaded.assetOwner.destroy();
        if (hadModelAttribute && previousModelId !== null) {
          host.setAttribute("data-cssgraphics-model", previousModelId);
        } else {
          host.removeAttribute("data-cssgraphics-model");
        }
      };
      try {
        return startMarioPlayerDriver(host, program, release);
      } catch (error) {
        release();
        throw error;
      }
    },
    discard(): void {
      if (started || discarded) return;
      discarded = true;
      loaded.assetOwner.destroy();
    },
  });
}

export const superMario64PlayerAdapter: CssGraphicsRuntimeAdapter = Object.freeze({
  profile: SUPER_MARIO_64_PROFILE,
  bind: bindMarioPlayer,
});
