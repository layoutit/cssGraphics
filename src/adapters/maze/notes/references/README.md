# cssMaze references

This directory records the pinned references for the source-backed PolyCSS port
of XScreenSaver `maze3d`. It does not vendor the upstream checkout.

## Pinned reference

- Read-only mirror: <https://github.com/Zygo/xscreensaver>
- Commit: `906693799e4fb7581436590cf84ecb2d3c9186ba`
- Primary source: <https://github.com/Zygo/xscreensaver/blob/906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/glx/maze3d.c>
- Configuration: <https://github.com/Zygo/xscreensaver/blob/906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/config/maze3d.xml>
- Manual: <https://github.com/Zygo/xscreensaver/blob/906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/glx/maze3d.man>
- Copyright notice: <https://github.com/Zygo/xscreensaver/blob/906693799e4fb7581436590cf84ecb2d3c9186ba/debian/copyright>

Exact hashes, the three admitted default textures, the used public product
closure, and the still-open full native dependency gap are recorded in
`source-lock.json`.

## Handling rule

Keep any checkout, generated image headers, native build, captures, traces, or
frame sequences in ignored local storage when implementation begins. Do not
copy the Microsoft screensaver binary or textures into this project. Treat the
XScreenSaver implementation as the named source authority; the Windows 95
screensaver is historical context until separately byte-identified and rights
qualified.
