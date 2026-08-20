#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildClothLogoImage } from "../src/prepare/csscloth/rasterAtlas.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolveRequiredSourceRoot();
const sourcePath = join(sourceRoot, "examples/webgl_animation_cloth.html");
const outputPath = join(sourceRoot, "examples/csscloth-state-oracle.html");
const texturePath = join(sourceRoot, "examples/textures/css-logo-purple.png");
const source = await readFile(sourcePath, "utf8");
const marker = "const cloth = new Cloth( xSegs, ySegs );";
const startup = "init();\n\t\t\tanimate( 0 );";
if (!source.includes(marker) || !source.includes(startup)) {
  throw new Error("Pinned cloth source no longer matches the state harness seam");
}
const exposure = `${marker}\n\n\t\t\twindow.__cssClothSource = {\n\t\t\t\tstep( now ) {\n\t\t\t\t\tsimulate( now );\n\t\t\t\t\trender();\n\t\t\t\t\treturn this.snapshot();\n\t\t\t\t},\n\t\t\t\tsetView( view ) {\n\t\t\t\t\tconst ground = scene.children.find( ( child ) => child.isMesh && child.geometry?.parameters?.width === 20000 );\n\t\t\t\t\tconst fixtures = scene.children.filter( ( child ) => child.isMesh && child.geometry?.type === 'BoxGeometry' );\n\t\t\t\t\tconst all = view.startsWith( 'all-' );\n\t\t\t\t\tif ( ! ground || fixtures.length !== 5 ) throw new Error( 'Pinned cloth source component binding drifted' );\n\t\t\t\t\tground.visible = view === 'ground' || all;\n\t\t\t\t\tobject.visible = view === 'flag' || all;\n\t\t\t\t\tfor ( const fixture of fixtures ) fixture.visible = view === 'structure' || all;\n\t\t\t\t\trenderer.shadowMap.enabled = view === 'all-shadows-on';\n\t\t\t\t\trender();\n\t\t\t\t},\n\t\t\t\tsnapshot() {\n\t\t\t\t\treturn cloth.particles.map( ( particle ) => [ particle.position.x, particle.position.y, particle.position.z ] );\n\t\t\t\t}\n\t\t\t};`;
const output = source
  .replace(marker, exposure)
  .replace(startup, "init();")
  .replace("textures/patterns/circuit_pattern.png", "textures/css-logo-purple.png")
  .replace("clothTexture.anisotropy = 16;", "clothTexture.anisotropy = 16;\n\t\t\t\tclothTexture.encoding = THREE.sRGBEncoding;")
  .replace("alphaMap: clothTexture,", "map: clothTexture,")
  .replace(
    "ground.visible = view === 'ground' || all;",
    "ground.visible = view === 'ground' || all;\n\t\t\t\t\tground.receiveShadow = view === 'all-shadows-on';",
  );
const logo = await buildClothLogoImage(await readFile(join(adapterRoot, "assets/css.svg")));
await mkdir(dirname(texturePath), { recursive: true });
await sharp(logo.data, {
  raw: { width: logo.width, height: logo.height, channels: 3 },
}).flip().png().toFile(texturePath);
await writeFile(outputPath, output);
console.log(JSON.stringify({ outputPath, texturePath }, null, 2));

function resolveRequiredSourceRoot() {
  const value = process.env.CSSCLOTH_SOURCE_ROOT;
  if (!value) throw new Error("Set CSSCLOTH_SOURCE_ROOT to the pinned Three.js r132 checkout");
  return resolve(value);
}
