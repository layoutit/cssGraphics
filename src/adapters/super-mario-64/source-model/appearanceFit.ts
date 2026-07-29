export const TITLE_HEAD_APPEARANCE_FIT_SCHEMA = "cssgraphics.title-head-appearance-fit.v1" as const;

export interface TitleHeadAppearanceFit {
  readonly schema: typeof TITLE_HEAD_APPEARANCE_FIT_SCHEMA;
  readonly id: "identity" | "arrival-19" | "arrival-20" | "arrival-21";
  readonly scale: number;
  readonly translateYSourcePx: number;
}

const IDENTITY_FIT: TitleHeadAppearanceFit = Object.freeze({
  schema: TITLE_HEAD_APPEARANCE_FIT_SCHEMA,
  id: "identity",
  scale: 1,
  translateYSourcePx: 0,
});

// Product-authored fullscreen composition, baked once into the bundle. The
// source arrival briefly exceeds its 320x240 projection; these three retained
// camera states keep that motion visible without measuring DOM bounds,
// rebuilding geometry, or changing the source animation state at runtime.
const ARRIVAL_FITS: Readonly<Record<number, TitleHeadAppearanceFit>> = Object.freeze({
  19: Object.freeze({
    schema: TITLE_HEAD_APPEARANCE_FIT_SCHEMA,
    id: "arrival-19",
    scale: 0.9723,
    translateYSourcePx: -28.074,
  }),
  20: Object.freeze({
    schema: TITLE_HEAD_APPEARANCE_FIT_SCHEMA,
    id: "arrival-20",
    scale: 0.7824,
    translateYSourcePx: -20.14,
  }),
  21: Object.freeze({
    schema: TITLE_HEAD_APPEARANCE_FIT_SCHEMA,
    id: "arrival-21",
    scale: 0.9372,
    translateYSourcePx: -10.995,
  }),
});

export function titleHeadAppearanceFit(sampledFrame: number): TitleHeadAppearanceFit {
  if (!Number.isSafeInteger(sampledFrame) || sampledFrame < 1 || sampledFrame > 820) {
    throw new RangeError("The title-head appearance frame must be an integer in [1, 820].");
  }
  return ARRIVAL_FITS[sampledFrame] ?? IDENTITY_FIT;
}
