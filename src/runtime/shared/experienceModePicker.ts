import type {
  CssGraphicsDriver,
  CssGraphicsExperienceMode,
} from "./driver.js";

const MODES = Object.freeze([
  Object.freeze({ id: "animation", label: "Animation" }),
  Object.freeze({ id: "interaction", label: "Interaction" }),
] as const);
let nextPickerId = 0;

export interface CssGraphicsExperienceModePicker {
  readonly root: HTMLElement;
  readonly selectedMode: CssGraphicsExperienceMode;
  readonly destroyed: boolean;
  sync(): void;
  destroy(): void;
}

export interface MountCssGraphicsExperienceModePickerOptions {
  readonly host: HTMLElement;
  readonly getDriver: () => CssGraphicsDriver;
}

export function mountCssGraphicsExperienceModePicker(
  options: MountCssGraphicsExperienceModePickerOptions,
): CssGraphicsExperienceModePicker {
  if (!options.host?.ownerDocument || typeof options.getDriver !== "function") {
    throw new TypeError("The cssGraphics mode picker requires a host and driver.");
  }
  const document = options.host.ownerDocument;
  const root = document.createElement("aside");
  root.className = "cssgraphics-experience-control";
  root.dataset.cssgraphicsControl = "experience-mode";

  const logo = document.createElement("div");
  logo.className = "cssgraphics-wordmark";
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", "cssGraphics");
  const cssText = document.createElement("span");
  cssText.className = "cssgraphics-wordmark-css";
  cssText.textContent = "CSS";
  const graphicsText = document.createElement("span");
  graphicsText.className = "cssgraphics-wordmark-graphics";
  graphicsText.textContent = "GRAPHICS";
  logo.append(cssText, graphicsText);
  root.appendChild(logo);

  const fieldset = document.createElement("fieldset");
  fieldset.className = "cssgraphics-experience-modes";
  const legend = document.createElement("legend");
  legend.className = "cssgraphics-visually-hidden";
  legend.textContent = "Experience mode";
  fieldset.appendChild(legend);

  const inputs = new Map<CssGraphicsExperienceMode, HTMLInputElement>();
  const radioGroupName = `cssgraphics-experience-mode-${nextPickerId}`;
  nextPickerId += 1;
  for (const mode of MODES) {
    const label = document.createElement("label");
    label.className = "cssgraphics-experience-mode";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = radioGroupName;
    input.value = mode.id;
    const text = document.createElement("span");
    text.textContent = mode.label;
    label.append(input, text);
    fieldset.appendChild(label);
    inputs.set(mode.id, input);
  }
  root.appendChild(fieldset);
  options.host.appendChild(root);

  let destroyed = false;
  let selectedMode: CssGraphicsExperienceMode = "animation";
  const sync = (): void => {
    if (destroyed) throw new Error("The cssGraphics mode picker is destroyed.");
    const driver = options.getDriver();
    selectedMode = driver.experienceMode;
    for (const mode of MODES) {
      const input = inputs.get(mode.id);
      if (!input) throw new Error(`The ${mode.id} radio is missing.`);
      input.disabled = !driver.experienceModes.includes(mode.id);
      input.checked = selectedMode === mode.id;
    }
  };
  const onChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.checked) return;
    const mode = input.value as CssGraphicsExperienceMode;
    options.getDriver().setExperienceMode(mode);
    sync();
  };
  fieldset.addEventListener("change", onChange);
  sync();

  return Object.freeze({
    root,
    get selectedMode(): CssGraphicsExperienceMode { return selectedMode; },
    get destroyed(): boolean { return destroyed; },
    sync,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      fieldset.removeEventListener("change", onChange);
      root.remove();
    },
  });
}
