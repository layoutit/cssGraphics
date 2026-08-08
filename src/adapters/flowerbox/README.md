# Flower Box

An independently authored PolyCSS reconstruction of the classic 1995 Flower
Box. The rounded default-cube bloom, negative cube lobe, and complete rotation
cycle are rendered
through 1,200 stable retained HTML triangle leaves and one retained rotation
root.

The browser loads one prepared PolyCSS snapshot, pins five prepared matrix3d
blocks, and loads one flat q83 prepared space-texel lighting atlas containing
twelve horizontal page regions. The ordinary AVIF image avoids the unsupported
AVIF Grid container path in Firefox. As in the Mario adapter, each retained
leaf's rounded triangle coverage is a prepared 4-by-4 supersampled alpha raster;
the browser does not depend on Firefox implementing CSS `corner-shape`. PolyCSS Morph
writes only selected prepared leaf transforms; a prepared source-camera
visibility schedule suppresses cells owning fewer than eight pixels. A
deadline-aware scheduler sleeps until each 30 Hz prepared source update is near
and then presents it through `requestAnimationFrame`. The runtime does not
construct geometry, project vertices, calculate normals or lighting,
rasterize, or grow the DOM. The canonical page is the responsive `/` route;
there is no separate presentation or oracle mode. Its fixed css.graphics shell
matches the Pipes presentation with a `/flower` wordmark and repository action,
while the prepared PolyCSS camera remains an unchanged direct body child.

From the repository root:

```sh
pnpm prepare:flowerbox:artifact
pnpm build:flowerbox
pnpm dev:flowerbox
```

The public rounded q83 product bank is a content-addressed build artifact. It
omits only the positive petal states at `sf >= 2.5`, retains the source-derived
negative cube lobe through `sf = -1.1499998569488525`, and stays below the
8 MB product-bank budget. Its lock binds the archive and unpacked closure;
generated output remains ignored
under `build/generated/`. A full source preparation is available separately
through `pnpm prepare:flowerbox:source` when the pinned `avifenc` is supplied.
The locked `cssflower-product-rounded-q83-negative-cube-v5` release contains a
7,918,095-byte portable archive and a 7,939,543-byte nine-file product closure.
The archive uses timestamp-free gzip, has no AppleDouble entries or extended
attributes, and extracts equivalently with BSD tar and GNU tar.

The source profile is bound to `DigitalMars/dmc` revision
`9478d25a677f70dbe4fc0ed317cc5a5e5050ef8b`. Exact native-state qualification
was performed locally across 9,331 ticks. That evidence and the owned native
inputs are not part of the product bank; native/browser pixel parity is not
claimed.

The implementation is covered by the repository's [MIT license](../../../LICENSE).
Microsoft source, binaries, native captures, and oracle packets are not
included or downloaded. This independent experiment is not affiliated with or
endorsed by Microsoft.
