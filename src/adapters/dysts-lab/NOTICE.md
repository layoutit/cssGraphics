# Chaos source notice

Chaos prepares trajectories from the continuous dynamical-system implementations in
[GilpinLab/dysts](https://github.com/GilpinLab/dysts) at commit
`2a03f1ae7b0680b0470458783dcb4664660e131a`, licensed under Apache-2.0. The upstream license is
included as `LICENSE.DYSTS-APACHE-2.0`; exact source identities and hashes are recorded in
`notes/references/source-lock.json`.

The per-system rigid prepared camera audit, higher-dimensional unscaled PCA projection, heuristic
visual ranking, 50-system visually curated and similarity-deduplicated motion shortlist, shared
spatial point assignment, and phase sampling are PolyCSS presentation decisions. The cyclic
green-to-white-to-yellow-to-red palette encodes prepared source trajectory phase rank and is
interpolated in OKLab before conversion to gamut-safe sRGB. The colors are not upstream metadata.
Source axes are not independently scaled.

Dimension, delay, Hamiltonian, nonautonomous, and measured-complexity fields shown by the adapter
are copied from the pinned upstream metadata.
