export const CSSSATURN_GLOBE_FACE_COUNT = 448;
export const CSSSATURN_CAP_FACE_COUNT = 4;
export const CSSSATURN_MOONS = Object.freeze(["Mimas", "Enceladus", "Tethys", "Dione", "Rhea"]);

export const CSSSATURN_SCENE_HTML = Object.freeze(renderScene());

function renderScene() {
  return `<section class="csssaturn-stage">
    <main role="img" aria-label="3D CSS view of Saturn">
      <div class="layer"><div class="rings far"><s></s><s></s></div></div>
      <div class="layer"><s class="fill"></s></div>
      <div class="layer">
        <div class="caps">${"<s></s>".repeat(CSSSATURN_CAP_FACE_COUNT)}</div>
        <div class="globe">${"<s></s>".repeat(CSSSATURN_GLOBE_FACE_COUNT)}</div>
      </div>
      <div class="layer"><s class="limb"></s></div>
      <div class="layer"><div class="rings near"><s></s><s></s></div></div>
      <div class="layer">${CSSSATURN_MOONS.map(renderMoon).join("")}</div>
    </main>
    <div class="zoom" role="group" aria-label="Scroll to zoom"><span aria-hidden="true"></span></div>
  </section>`;
}

function renderMoon(name) {
  return `<div class="orbit"><i></i><div><span>${name}</span></div></div>`;
}
