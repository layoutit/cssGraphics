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
writes only the sparse prepared leaf-transform indices for each state; sparse
prepared visibility transitions suppress cells owning fewer than eight pixels
without scanning all 1,200 leaves per frame. A
deadline-aware scheduler sleeps until each 30 Hz prepared source update is near
and then presents it through `requestAnimationFrame`. The runtime does not
construct geometry, project vertices, calculate normals or lighting,
rasterize, or grow the DOM. The canonical page is the responsive `/` route;
there is no separate presentation or oracle mode. Its fixed css.graphics shell
matches the Pipes presentation with a `/flowerbox` wordmark and repository action,
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
The locked `cssflower-product-rounded-q83-sparse-runtime-v9` release is a
6,711,027-byte portable archive with a 6,732,455-byte nine-file product
closure. Its prepared lighting alpha clips true face boundaries through the
last conjoined state (`sf = 0x3f800001`), then preserves side-local sibling-edge
coverage while the lobes are separated. This removes the sparse internal black
gaps without growing the conjoined silhouette. Its exact sparse playback
schedule contains 166,886 selected transform indices and 8,310 visibility
changes for the complete 360-state animation. The portable archive uses
timestamp-free gzip and contains no AppleDouble entries or extended attributes.

The source profile is bound to `DigitalMars/dmc` revision
`9478d25a677f70dbe4fc0ed317cc5a5e5050ef8b`. Exact native-state qualification
was performed locally across 9,331 ticks. That evidence and the owned native
inputs are not part of the product bank; native/browser pixel parity is not
claimed.

The implementation is covered by the repository's [MIT license](../../../LICENSE).
Microsoft source, binaries, native captures, and oracle packets are not
included or downloaded. This independent experiment is not affiliated with or
endorsed by Microsoft.
