#ifndef CSSPLATONICFOLDING_HEADLESS_VISUAL_H
#define CSSPLATONICFOLDING_HEADLESS_VISUAL_H

#include "xlockmore.h"

static inline Bool has_writable_cells(Screen *screen, Visual *visual) {
  (void)screen;
  (void)visual;
  return False;
}

#endif
