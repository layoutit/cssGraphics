# Cityflow source notice

The Cityflow adapter derives its preparation-time initialization, wave motion,
box geometry, palette, lighting, camera, cadence, and three-face rendering from
XScreenSaver's `hacks/glx/cityflow.c`, revision
`906693799e4fb7581436590cf84ecb2d3c9186ba`, with SHA-256
`9113c9f3214ba6c1f350b3863c306e6015e47a856a17bbe24d597f909dfa027b`.
The exact source and native-oracle support inputs are bound in
`notes/references/source-lock.json` and recorded as HPND.

The desktop and mobile products select the source-supported `count` option at
200 and 100 boxes respectively. The XScreenSaver default remains 800. Their
deterministic authoring seed and 251-frame exact source-state banks are product
preparation choices. The normal browser presentation is a prepared 301-state
periodic uniform cubic B-spline C2
reconstruction over the same real-time span, followed by documented zero-phase
filters, short-direction-run folding, and an adaptive smooth-sine extrema refit.
Preparation also interpolates browser face colors between adjacent source
palette entries and emits complete prepared transform dictionaries, final
three-face color dictionaries, and packed indices. Exact
source-frame seeking remains available to the native visual oracle. The source
bank is the nearest whole-frame approximation to the source wave period; the
smooth periodic browser cycle is a documented presentation adaptation and does
not claim that the continuously advancing source has an exact finite loop.

## Upstream attribution and permission notice

The replacement mobile product is an authored isometric adaptation with 72
touching towers, static face colors, and a six-second prepared height loop. It
does not reproduce native depth-buffer rendering or source wave simulation.
The 100-box mobile bank described above remains only for cached-client compatibility.

The following notice is reproduced from the pinned `hacks/glx/cityflow.c`
source:

> cityflow, Copyright (c) 2014-2017 Jamie Zawinski <jwz@jwz.org>
>
> Permission to use, copy, modify, distribute, and sell this software and its
> documentation for any purpose is hereby granted without fee, provided that
> the above copyright notice appear in all copies and that both that copyright
> notice and this permission notice appear in supporting documentation. No
> representations are made about the suitability of this software for any
> purpose. It is provided "as is" without express or implied warranty.
