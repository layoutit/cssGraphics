export type CssGraphicsDriverKind = "prepared-playback";
export type CssGraphicsExperienceMode = "animation" | "interaction";

export interface CssGraphicsDriver {
  readonly modelId: string;
  readonly kind: CssGraphicsDriverKind;
  readonly generationHash: string;
  readonly experienceModes: readonly CssGraphicsExperienceMode[];
  readonly experienceMode: CssGraphicsExperienceMode;
  readonly tick: number;
  readonly destroyed: boolean;
  setExperienceMode(mode: CssGraphicsExperienceMode): void;
  destroy(): void;
}

export interface CssGraphicsClientLifecycle {
  readonly tick: number;
  stop(): void;
  readonly scene: Readonly<{ destroy(): void }>;
  readonly presentation: Readonly<{ destroy(): void }>;
}

export interface WrapCssGraphicsClientOptions<Client extends CssGraphicsClientLifecycle> {
  readonly modelId: string;
  readonly kind: CssGraphicsDriverKind;
  readonly generationHash: string;
  readonly client: Client;
  readonly experienceModes?: readonly CssGraphicsExperienceMode[];
  readonly getExperienceMode?: () => CssGraphicsExperienceMode;
  readonly setExperienceMode?: (mode: CssGraphicsExperienceMode) => void;
  readonly onDestroy?: (client: Client) => void;
}

function normalizedId(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw new TypeError("cssGraphics driver id is not normalized.");
  return value;
}

function generationHash(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("cssGraphics driver generation hash is invalid.");
  return value;
}

export function wrapCssGraphicsClient<Client extends CssGraphicsClientLifecycle>(
  options: WrapCssGraphicsClientOptions<Client>,
): CssGraphicsDriver {
  const modelId = normalizedId(options.modelId);
  const hash = generationHash(options.generationHash);
  if (options.kind !== "prepared-playback") {
    throw new TypeError("cssGraphics driver kind is unsupported.");
  }
  if (!options.client || typeof options.client.stop !== "function"
    || typeof options.client.scene?.destroy !== "function"
    || typeof options.client.presentation?.destroy !== "function") {
    throw new TypeError("cssGraphics client lifecycle is incomplete.");
  }
  const experienceModes = Object.freeze(
    [...(options.experienceModes ?? ["interaction"])] as CssGraphicsExperienceMode[],
  );
  if (experienceModes.length === 0
    || new Set(experienceModes).size !== experienceModes.length
    || experienceModes.some((mode) => mode !== "animation" && mode !== "interaction")) {
    throw new TypeError("cssGraphics experience modes are invalid.");
  }
  const currentExperienceMode = (): CssGraphicsExperienceMode => (
    options.getExperienceMode?.() ?? experienceModes[0]
  );
  if (!experienceModes.includes(currentExperienceMode())) {
    throw new TypeError("The initial cssGraphics experience mode is unsupported.");
  }
  let destroyed = false;
  return Object.freeze({
    modelId,
    kind: options.kind,
    generationHash: hash,
    experienceModes,
    get experienceMode(): CssGraphicsExperienceMode { return currentExperienceMode(); },
    get tick(): number { return options.client.tick; },
    get destroyed(): boolean { return destroyed; },
    setExperienceMode(mode: CssGraphicsExperienceMode): void {
      if (destroyed) throw new Error(`cssGraphics driver ${modelId} is destroyed.`);
      if (!experienceModes.includes(mode)) {
        throw new TypeError(`cssGraphics driver ${modelId} does not support ${mode} mode.`);
      }
      options.setExperienceMode?.(mode);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      const errors: unknown[] = [];
      for (const action of [
        () => options.client.stop(),
        () => options.client.scene.destroy(),
        () => options.client.presentation.destroy(),
        () => options.onDestroy?.(options.client),
      ]) {
        try {
          action();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `Failed to destroy cssGraphics driver ${modelId}.`);
    },
  });
}
