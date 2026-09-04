// SPDX-License-Identifier: HPND
import { mobileFaceTransforms } from "../../csscityflow/mobileTransforms.mjs";

// Authored mobile composition, not a native Cityflow reconstruction.
// Disjoint ground footprints and this fixed isometric view have a fixed painter order.
export function buildCityflowMobileProduct() {
  const boxes = [];
  // Stretch heights, not footprints or the camera. Keep compact base samples;
  // the loader applies this fixed scale while expanding the prepared states.
  const heightScale = 2;
  const rowDepths = [44, 72, 48, 60, 36, 80, 54, 66, 40, 100].map((value) => value * 1.2);
  const columnWidths = [72, 44, 84, 52, 64, 36, 76, 48, 60, 64].map((value) => value * 1.2);
  let worldY = -360;
  for (let row = 0; row < 10; row += 1) {
    const depth = rowDepths[row];
    let worldX = -360;
    for (let column = 0; column < 10; column += 1) {
      const width = columnWidths[(column + row * 3) % columnWidths.length];
      const x = worldX - worldY * 0.36;
      const y = worldX * 0.22 + worldY * 0.6;
      // All viewports crop inside this fixed camera. Omit plots that can never
      // touch its bounds at any height; no runtime visibility work is needed.
      if (!(x + width < -256 || x - depth * 0.36 > 256 ||
          y + width * 0.22 + depth * 0.6 < -170 || y - 62 * heightScale > 170)) {
        boxes.push({ row, column, x, y, width, depth, worldX, worldY });
      }
      worldX += width;
    }
    worldY += depth;
  }
  // Contiguous row bands are painted far-to-near, then left-to-right within
  // each band. This order remains correct at every independently moving height.
  const heights = new Uint16Array(360 * boxes.length);
  const bytes = Buffer.alloc(heights.length * 2);
  for (let frame = 0; frame < 360; frame += 1) {
    for (let box = 0; box < boxes.length; box += 1) {
      const { row, column } = boxes[box];
      const phase = (row + column) * 0.56 + (column - row) * 0.19;
      const time = frame * 2 * Math.PI / 360;
      const height = Math.round((40 + 18 * Math.sin(time - phase) +
        4 * Math.sin(time * 2 - row * 0.9 + column * 0.4)) * 1000);
      heights[frame * boxes.length + box] = height;
      bytes.writeUInt16LE(height, (frame * boxes.length + box) * 2);
    }
  }
  const colors = [
    ["#608519", "#304810", "#1d340a"],
    ["#578c1a", "#294811", "#16320b"],
    ["#6e8b1a", "#3b4b10", "#253409"],
    ["#45931b", "#244a12", "#13310c"],
  ];
  const snapshotHtml = `<main class="polycss-camera cityflow-mobile"><div class="polycss-scene">${boxes.map((box, index) => {
    const transforms = mobileFaceTransforms(heights[index], box.width, box.depth, heightScale);
    const palette = colors[(box.row * 3 + box.column) % colors.length];
    return `<div style="transform:translate(${box.x}px,${box.y}px)">${transforms.map((transform, face) =>
      `<b style="transform:${transform};background-color:${palette[face]}"></b>`).join("")}</div>`;
  }).join("")}</div></main>`;
  const css = `/* Authored Cityflow mobile: ordinary 2D faces, no depth sorting. */
.example-stage>.polycss-camera.cityflow-mobile{
  position:absolute;left:50%;top:50%;width:512px;height:340px;
  overflow:hidden;contain:layout paint style;perspective:none!important;
  transform:scale(max(calc(100cqw / 512px),calc(100cqh / 340px))) translate(-50%,-50%);
  transform-origin:0 0;
}
.example-stage>.polycss-camera.cityflow-mobile>.polycss-scene{
  position:absolute;left:256px;top:170px;width:0;height:0;
  transform:none!important;transform-style:flat;transform-origin:0 0;
}
.example-stage>.polycss-camera.cityflow-mobile>.polycss-scene>div{
  position:absolute;left:0;top:0;width:0;height:0;
  transform-style:flat;transform-origin:0 0;
}
.example-stage>.polycss-camera.cityflow-mobile>.polycss-scene>div>b{
  display:block;position:absolute;left:0;top:0;width:1px;height:1px;
  margin:0;padding:0;border:0;transform-origin:0 0;transform-style:flat;
  backface-visibility:visible;
}
`;
  return {
    boxes, snapshotHtml, css,
    playback: {
      schema: "csscityflow-mobile-playback@1", bankId: "mobile", modelId: "cityflow-mobile",
      provenance: "authored-isometric-mobile-composition-not-native-parity",
      boxCount: boxes.length, facesPerBox: 3, frameCount: 360, framesPerSecond: 60,
      heightScale,
      footprints: boxes.map(({ width, depth }) => [width, depth]),
      heightEncoding: "uint16-le-millipixels-base64", heightsBase64: bytes.toString("base64"),
    },
  };
}
