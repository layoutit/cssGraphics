# Flower Box

An independently authored PolyCSS reconstruction of the classic 1995 Flower
Box. The rounded default-cube bloom and complete rotation cycle are rendered
through 1,200 stable retained HTML triangle leaves and one retained rotation
root.

The browser loads one prepared PolyCSS snapshot, three prepared matrix3d
blocks, and one q60 prepared space-texel lighting grid. PolyCSS Morph writes
only selected prepared leaf transforms; a prepared source-camera visibility
schedule suppresses cells owning fewer than eight pixels. The runtime does not
construct geometry, project vertices, calculate normals or lighting,
rasterize, or grow the DOM. The canonical page is the responsive `/` route;
there is no separate presentation or oracle mode.

From the repository root:

```sh
pnpm prepare:flowerbox:artifact
pnpm build:flowerbox
pnpm dev:flowerbox
```

The public rounded q60 product bank is a content-addressed build artifact. Its
lock binds the archive and unpacked closure; generated output remains ignored
under `build/generated/`. A full source preparation is available separately
through `pnpm prepare:flowerbox:source` when the pinned `avifenc` is supplied.

The source profile is bound to `DigitalMars/dmc` revision
`9478d25a677f70dbe4fc0ed317cc5a5e5050ef8b`. Exact native-state qualification
was performed locally across 9,331 ticks. That evidence and the owned native
inputs are not part of the product bank; native/browser pixel parity is not
claimed.

The implementation is covered by the repository's [MIT license](../../../LICENSE).
Microsoft source, binaries, native captures, and oracle packets are not
included or downloaded. This independent experiment is not affiliated with or
endorsed by Microsoft.
