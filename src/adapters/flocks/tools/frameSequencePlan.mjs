// SPDX-License-Identifier: GPL-2.0-or-later

function inclusive(start, end) {
  return Object.freeze(Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

export const CSSFLOCKS_FRAME_SEQUENCE_PLAN = Object.freeze([
  Object.freeze({
    id: "startup",
    label: "fixed source-114s startup",
    authority: "exact-source",
    frames: inclusive(6_840, 6_848),
  }),
  Object.freeze({
    id: "ordinary-block-handoff",
    label: "source blocks 114 to 115",
    authority: "exact-source",
    frames: inclusive(6_896, 6_904),
  }),
  Object.freeze({
    id: "color-wrap",
    label: "visible retained root 88 crosses hue one to zero on its publication phase",
    authority: "exact-source",
    focusRootIndex: 88,
    focusFrameIndex: 17,
    frames: inclusive(13, 21),
  }),
  Object.freeze({
    id: "extreme-stretch-orientation",
    label: "maximum visible source stretch in the desktop product prefix",
    authority: "exact-source",
    focusRootIndex: 173,
    focusFrameIndex: 147,
    frames: inclusive(143, 151),
  }),
  Object.freeze({
    id: "terminal-seam",
    label: "last four bridge frames through correspondence-composed loop start",
    authority: "prepared-terminal-deviation",
    frames: Object.freeze([13_436, 13_437, 13_438, 13_439, 0, 1, 2, 3, 4]),
    wrapsAfterOrdinal: 3,
  }),
]);

export const CSSFLOCKS_FRAME_SEQUENCE_COUNT = CSSFLOCKS_FRAME_SEQUENCE_PLAN
  .reduce((count, segment) => count + segment.frames.length, 0);

export function flattenFlocksFrameSequencePlan() {
  let ordinal = 0;
  return Object.freeze(CSSFLOCKS_FRAME_SEQUENCE_PLAN.flatMap((segment) => segment.frames.map((streamFrameIndex, segmentOrdinal) =>
    Object.freeze({
      ordinal: ordinal++,
      segmentId: segment.id,
      segmentOrdinal,
      streamFrameIndex,
      authority: segment.authority,
    }))));
}
