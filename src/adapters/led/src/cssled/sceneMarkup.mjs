export const CSSLED_FACE_SIZE = 9;
export const CSSLED_RETAINED_LED_COUNT = CSSLED_FACE_SIZE * CSSLED_FACE_SIZE * 3;

const ACTIVE_CUES = Object.freeze({
  front: Object.freeze([
    [5, 2, 0, true], [6, 3, 120, true], [7, 4, 240, true],
    [8, 5, 360, true], [7, 6, 480, true], [6, 7, 600, true],
    [5, 8, 720, false], [4, 7, 840, false], [3, 6, 960, false],
    [2, 5, 1080, false], [3, 4, 1200, false], [4, 3, 1320, false],
  ]),
  right: Object.freeze([
    [5, 3, 0, true], [6, 2, 90, true], [7, 2, 180, true],
    [8, 3, 270, true], [8, 4, 360, true], [8, 5, 450, true],
    [7, 6, 540, true], [6, 7, 630, true], [5, 8, 720, false],
    [4, 7, 810, false], [3, 6, 900, false], [2, 5, 990, false],
    [2, 4, 1080, false], [2, 3, 1170, false], [3, 2, 1260, false],
    [4, 2, 1350, false],
  ]),
  top: Object.freeze([
    [5, 3, 0, true], [6, 3, 120, true], [7, 4, 240, true],
    [7, 5, 360, true], [7, 6, 480, true], [6, 7, 600, true],
    [5, 7, 720, false], [4, 7, 840, false], [3, 6, 960, false],
    [3, 5, 1080, false], [3, 4, 1200, false], [4, 3, 1320, false],
  ]),
});

export const CSSLED_SCENE_HTML = Object.freeze(renderScene());

function renderScene() {
  return `<section class="cssled-stage is-running" role="img" aria-label="A three-dimensional LED cube drawing cyan, magenta, and white light">
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
  const cells = [];
  for (let row = 1; row <= CSSLED_FACE_SIZE; row += 1) {
    for (let column = 1; column <= CSSLED_FACE_SIZE; column += 1) {
      const active = cues.get(`${column}:${row}`);
      const activeClasses = active
        ? ` is-active cue-${active.cue}${active.repeats ? " is-repeat" : ""}`
        : "";
      cells.push(`<u class="cssled-cell c${column} r${row}${activeClasses}"><i></i><b></b></u>`);
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
