#ifndef CSSPLATONICFOLDING_HEADLESS_XIMAGE_LOADER_H
#define CSSPLATONICFOLDING_HEADLESS_XIMAGE_LOADER_H

typedef struct {
  int width;
  int height;
  char *data;
} XImage;

XImage *image_data_to_ximage(Display *display, Visual *visual,
                             const unsigned char *image_data,
                             unsigned long data_size);
int XDestroyImage(XImage *image);

#endif
