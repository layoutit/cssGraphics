export const CSSLED_FACE_SIZE = 9;
export const CSSLED_RETAINED_LED_COUNT = CSSLED_FACE_SIZE * CSSLED_FACE_SIZE * 3;

const ACTIVE_CUES = Object.freeze({
  front: Object.freeze([
    [5, 3, 0, true], [6, 2, 90, true], [7, 2, 180, true],
    [8, 3, 270, true], [8, 4, 360, true], [8, 5, 450, true],
    [7, 6, 540, true], [6, 7, 630, true], [5, 8, 720, false],
    [4, 7, 810, false], [3, 6, 900, false], [2, 5, 990, false],
    [2, 4, 1080, false], [2, 3, 1170, false], [3, 2, 1260, false],
    [4, 2, 1350, false],
  ]),
  right: Object.freeze([
    [3, 2, 0, false], [2, 2, 60, false], [1, 2, 120, false],
    [1, 3, 180, false], [1, 4, 240, false], [1, 5, 300, false],
    [1, 6, 360, false], [1, 7, 420, false], [1, 8, 480, false],
    [2, 8, 540, false], [3, 8, 600, false],
    [6, 2, 660, false], [5, 2, 720, false], [5, 3, 780, false],
    [5, 4, 840, false], [5, 5, 900, false], [6, 5, 960, false],
    [6, 6, 1020, false], [6, 7, 1080, false], [6, 8, 1140, false],
    [5, 8, 1200, false],
    [9, 2, 1260, false], [8, 2, 1320, false], [8, 3, 1380, false],
    [8, 4, 1440, false], [8, 5, 1500, false], [9, 5, 1560, false],
    [9, 6, 1620, false], [9, 7, 1680, false], [9, 8, 1740, false],
    [8, 8, 1800, false],
  ]),
  top: Object.freeze([]),
});

const TOP_TRAIL = Object.freeze([
  [5, 5], [4, 5], [3, 5], [3, 6], [3, 7], [4, 7],
  [5, 7], [6, 7], [7, 7], [7, 6], [7, 5], [7, 4],
  [7, 3], [6, 3], [5, 3], [4, 3], [3, 3], [2, 3],
  [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8],
  [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9],
  [7, 9], [8, 9], [9, 9], [9, 8], [9, 7], [9, 6],
  [9, 5], [9, 4], [9, 3], [9, 2], [9, 1], [8, 1],
  [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1],
  [1, 1],
]);

export const CSSLED_SCENE_HTML = Object.freeze(renderScene());

function renderScene() {
  return `<section class="cssled-stage is-running" role="img" aria-label="A three-dimensional LED cube displaying a magenta heart, cyan CSS, and a spiraling white trail">
    <main class="cssled-loop">
      <foreground></foreground>
      <shadow></shadow>
      <background></background>
      <div class="cssled-cube">${renderGrid("front")}${renderGrid("right")}${renderGrid("top")}</div>
      <room><spill class="front">${renderLights()}</spill><spill class="right">${renderLights()}</spill></room>
      <backlight>${renderLights()}</backlight>
      <surfacelight>${renderLights()}</surfacelight>
    </main>
  </section>`;
}

function renderGrid(face) {
  const cues = new Map(ACTIVE_CUES[face].map(([column, row, cue, repeats]) => [
    `${column}:${row}`,
    { cue, repeats },
  ]));
  const trail = face === "top"
    ? new Map(TOP_TRAIL.map(([column, row], index) => [`${column}:${row}`, index]))
    : new Map();
  const cells = [];
  for (let row = 1; row <= CSSLED_FACE_SIZE; row += 1) {
    for (let column = 1; column <= CSSLED_FACE_SIZE; column += 1) {
      const active = cues.get(`${column}:${row}`);
      const activeClasses = active
        ? ` is-active cue-${active.cue}${active.repeats ? " is-repeat" : ""}`
        : "";
      const trailIndex = trail.get(`${column}:${row}`);
      const trailClasses = trailIndex === undefined ? "" : ` is-trailing trail-${trailIndex}`;
      cells.push(`<u class="cssled-cell c${column} r${row}${activeClasses}${trailClasses}"><i></i><b></b></u>`);
    }
  }
  return `<pixel-grid class="cssled-grid ${face}">${cells.join("")}</pixel-grid>`;
}

function renderLights() {
  return Array.from(
    { length: CSSLED_FACE_SIZE },
    (unused, index) => `<u class="cssled-light l${index + 1}"></u>`,
  ).join("");
}
