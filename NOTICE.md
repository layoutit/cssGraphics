# Source-only notice

The MIT license in this repository applies only to original cssGraphics source,
documentation, and site presentation. Each public distribution asset and
preview retains the source, attribution, and license declared in
`site/public/catalog.json`; those third-party materials are not relicensed as
cssGraphics code. The catalog also identifies the conversion from each source
format into prepared PolyCSS DOM/CSS resources.

It does **not** grant rights to Super Mario 64, Nintendo-owned game content, a
Nintendo 64 ROM, or data extracted or generated from one. In particular,
textures, models, level geometry, collision, animation data, audio, dialogue,
fonts, screenshots, captures, and prepared bundles derived from the game stay
on the user's machine under ignored local paths.

Upstream repositories used for local preparation remain pinned reference inputs
under `.local/upstreams/`. Cleared public distribution outputs are limited to
the catalog-bound files and retain their upstream licenses. The sibling PolyCSS
checkout is the renderer API authority; other sibling ports were studied only
as read-only architectural precedent. No code or assets from those ports are
included.

Preparation reads the user-supplied ROM in place and writes only to ignored
generated roots. The ROM is never downloaded, copied, committed, published,
or deployed by this project.

A locally prepared Mario package remains generated user data and is never part
of the cssGraphics package tarball. The tarball contains only original runtime,
preparation, and packaging code compiled for the cssGraphics command.
