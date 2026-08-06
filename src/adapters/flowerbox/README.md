# Flower Box

An independently authored PolyCSS reconstruction of the classic 1995 Flower
Box. The complete default-cube bloom and rotation cycle is rendered through
1,200 stable retained HTML triangle leaves and one retained rotation root.

The browser loads one prepared snapshot and selects hash-bound prepared AVIF
pages, source-order leaf windows, and root transforms. It does not construct
geometry, project vertices, calculate normals or lighting, rasterize, or grow
the DOM at runtime.

From the repository root:

```sh
pnpm prepare:flowerbox:artifact
pnpm build:flowerbox
pnpm dev:flowerbox
```

The public q40 product bank is a content-addressed build artifact. Its lock
binds the archive and unpacked closure; generated output remains ignored under
`build/generated/`. A full source preparation is available separately through
`pnpm prepare:flowerbox:source` when the pinned `avifenc` is supplied.

The implementation is covered by the repository's [MIT license](../../../LICENSE).
Microsoft source, binaries, native captures, and oracle packets are not
included or downloaded. This independent experiment is not affiliated with or
endorsed by Microsoft.
