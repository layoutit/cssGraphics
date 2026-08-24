// SPDX-License-Identifier: HPND

export const CSSGALAXY_ENCOUNTER_REEL = Object.freeze({
  schema: "cssgalaxy-prepared-encounter-reel@5",
  mode: "curated-native-generation-zero-with-prepared-identity-preserving-reformation",
  sourceFramesPerSecond: 50,
  presentationFramesPerSecond: 60,
  nativeProjectionFrameCount: 410,
  nativeMotionStartFrameIndex: 0,
  nativeMotionFrameSpan: 409,
  nativeMotionFrameStepNumerator: 409,
  nativeMotionFrameStepDenominator: 540,
  nativeMotionFrameCount: 540,
  reformationFrameCount: 180,
  reformationStartFrameIndex: 540,
  reformationTargetNativeFrameIndex: 0,
  reformationControlFrameScale: 60,
  reformationMaximumControlDisplacement: 560,
  encounterFrameCount: 720,
  bankFrameCount: 1440,
  bankCount: 5,
  encounterCount: 10,
  reformationStartsAtSeconds: 9,
  nextEncounterFullyVisibleAtSeconds: 12,
  resetPresentation: "same-retained-leaves-reform-from-outgoing-disc-roles-into-next-disc-roles",
  transitionMotion: "prepared-cubic-position-bridge-with-source-velocity-matched-capped-endpoints",
  particleIdentity: "stable-role-cohort-and-prefix-star-index-across-every-encounter",
  opacityOwner: "static-snapshot-one",
});

export function createEncounterSchedule(currentSeed, nextSeed) {
  if (!Number.isSafeInteger(currentSeed) || currentSeed < 1 ||
      !Number.isSafeInteger(nextSeed) || nextSeed < 1) {
    throw new RangeError("Galaxy encounter schedule requires positive source seeds");
  }
  const sourceEnd = CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameCount;
  const reformationEnd = sourceEnd + CSSGALAXY_ENCOUNTER_REEL.reformationFrameCount;
  if (reformationEnd !== CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount ||
      CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount * CSSGALAXY_ENCOUNTER_REEL.encounterCount !==
        CSSGALAXY_ENCOUNTER_REEL.bankFrameCount * CSSGALAXY_ENCOUNTER_REEL.bankCount ||
      CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount !==
        CSSGALAXY_ENCOUNTER_REEL.nativeMotionStartFrameIndex +
        CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameSpan + 1 ||
      CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameCount *
        CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepNumerator !==
        CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameSpan *
        CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepDenominator ||
      CSSGALAXY_ENCOUNTER_REEL.reformationStartFrameIndex !== sourceEnd ||
      CSSGALAXY_ENCOUNTER_REEL.reformationStartsAtSeconds *
        CSSGALAXY_ENCOUNTER_REEL.presentationFramesPerSecond !== sourceEnd ||
      CSSGALAXY_ENCOUNTER_REEL.nextEncounterFullyVisibleAtSeconds *
        CSSGALAXY_ENCOUNTER_REEL.presentationFramesPerSecond !== reformationEnd ||
      CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale * 3 !==
        CSSGALAXY_ENCOUNTER_REEL.reformationFrameCount ||
      CSSGALAXY_ENCOUNTER_REEL.bankCount !== 5) {
    throw new Error("Galaxy encounter schedule does not tile the prepared banks");
  }
  return Object.freeze({
    schema: "cssgalaxy-prepared-encounter@5",
    currentSeed,
    nextSeed,
    source: Object.freeze({ startFrameIndex: 0, endFrameIndexExclusive: sourceEnd,
      nativeStartFrameIndex: CSSGALAXY_ENCOUNTER_REEL.nativeMotionStartFrameIndex }),
    reformation: Object.freeze({
      startFrameIndex: sourceEnd,
      endFrameIndexExclusive: reformationEnd,
      outgoingNativeFrameIndex: CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount - 1,
      incomingNativeFrameIndex: CSSGALAXY_ENCOUNTER_REEL.reformationTargetNativeFrameIndex,
    }),
  });
}
