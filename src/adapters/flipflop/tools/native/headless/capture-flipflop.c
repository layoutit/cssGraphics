#include <OpenGL/OpenGL.h>
#include <errno.h>
#include <sys/stat.h>
#include <unistd.h>

char *progname = "cssflipflop-headless-native-oracle";

#define USE_GL 1
#include "flipflop.c"

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static GLXContext capture_glx_context;

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static int write_ppm(const char *path, int width, int height);
static void write_state(FILE *stream, int tick, const Flipflopcreen *screen);
static long parse_positive(const char *text, const char *label);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  unsigned int seed;
  int width;
  int height;
  int board_width;
  int board_depth;
  int capture_count;
  int *ticks;
  int capture_index = 0;
  FILE *states;
  char path[4096];

  if (argc < 9) {
    fprintf(stderr, "usage: %s frames-directory states.jsonl seed width height board-width board-depth tick [tick ...]\n", argv[0]);
    return 2;
  }
  seed = (unsigned int)parse_positive(argv[3], "seed");
  width = (int)parse_positive(argv[4], "width");
  height = (int)parse_positive(argv[5], "height");
  board_width = (int)parse_positive(argv[6], "board width");
  board_depth = (int)parse_positive(argv[7], "board depth");
  capture_count = argc - 8;
  ticks = calloc((size_t)capture_count, sizeof(*ticks));
  if (!ticks) abort();
  for (int index = 0; index < capture_count; index++) {
    ticks[index] = (int)parse_positive(argv[index + 8], "tick plus one") - 1;
    if (ticks[index] < 0 || (index > 0 && ticks[index] <= ticks[index - 1])) return 2;
  }
  if (mkdir(argv[1], 0777) != 0 && errno != EEXIST) return 3;
  states = fopen(argv[2], "wb");
  if (!states) return 3;

  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  create_offscreen_context(width, height);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glClearColor(0, 0, 0, 1);

#undef ya_rand_init
  ya_rand_init(seed);
  board_x_size_arg = board_width;
  board_y_size_arg = board_depth;
  board_avg_size_arg = 0;
  numsquares_arg = 0;
  freesquares_arg = 0;
  spin_arg = 0.1f;
  flipflopmode_str_arg = "tiles";
  textured_arg = 0;
  init_flipflop(&mi);

  for (int tick = 0; tick <= ticks[capture_count - 1]; tick++) {
    draw_flipflop(&mi);
    if (tick != ticks[capture_index]) continue;
    snprintf(path, sizeof(path), "%s/frame_%04d.ppm", argv[1], capture_index);
    if (!write_ppm(path, width, height)) return 4;
    write_state(states, tick, &qs[0]);
    capture_index++;
    if (capture_index == capture_count) break;
  }
  fclose(states);
  free_flipflop(&mi);
  free(qs);
  qs = NULL;
  destroy_offscreen_context();
  free(ticks);
  return capture_index == capture_count ? 0 : 5;
}

static void
write_state(FILE *stream, int tick, const Flipflopcreen *screen)
{
  fprintf(stream, "{\"tick\":%d,\"theta\":%.9g,\"polygonCount\":%d,\"tiles\":[",
          tick, screen->theta - 0.01f * screen->spin, screen->numsquares * 6);
  for (int index = 0; index < screen->numsquares; index++) {
    if (index) fputc(',', stream);
    fprintf(stream, "{\"index\":%d,\"x\":%d,\"z\":%d,\"direction\":%d,\"angle\":%.9g}",
            index, screen->sheet->xpos[index], screen->sheet->ypos[index],
            screen->sheet->direction[index], screen->sheet->angle[index]);
  }
  fprintf(stream, "]}\n");
}

static int
write_ppm(const char *path, int width, int height)
{
  unsigned char *rgba = malloc((size_t)width * (size_t)height * 4);
  unsigned char *row = malloc((size_t)width * 3);
  FILE *stream;
  if (!rgba || !row) abort();
  glFinish();
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  stream = fopen(path, "wb");
  if (!stream) return 0;
  fprintf(stream, "P6\n%d %d\n255\n", width, height);
  for (int y = height - 1; y >= 0; y--) {
    const unsigned char *source = rgba + (size_t)y * (size_t)width * 4;
    for (int x = 0; x < width; x++) {
      row[x * 3] = source[x * 4];
      row[x * 3 + 1] = source[x * 4 + 1];
      row[x * 3 + 2] = source[x * 4 + 2];
    }
    fwrite(row, 1, (size_t)width * 3, stream);
  }
  fclose(stream);
  free(row);
  free(rgba);
  return 1;
}

static void
create_offscreen_context(int width, int height)
{
  CGLPixelFormatAttribute attributes[] = {
    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_Legacy,
    kCGLPFAAccelerated,
    kCGLPFAAllowOfflineRenderers,
    kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
    kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
    kCGLPFADepthSize, (CGLPixelFormatAttribute)24,
    (CGLPixelFormatAttribute)0,
  };
  GLint count = 0;
  if (CGLChoosePixelFormat(attributes, &capture_pixel_format, &count) != kCGLNoError) abort();
  if (CGLCreateContext(capture_pixel_format, NULL, &capture_context) != kCGLNoError) abort();
  if (CGLSetCurrentContext(capture_context) != kCGLNoError) abort();
  capture_glx_context = capture_context;
  glGenFramebuffersEXT(1, &capture_framebuffer);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glGenRenderbuffersEXT(1, &capture_colorbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, capture_colorbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_RGBA8, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT, GL_RENDERBUFFER_EXT, capture_colorbuffer);
  glGenRenderbuffersEXT(1, &capture_depthbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, capture_depthbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_DEPTH_COMPONENT24, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_DEPTH_ATTACHMENT_EXT, GL_RENDERBUFFER_EXT, capture_depthbuffer);
  if (glCheckFramebufferStatusEXT(GL_FRAMEBUFFER_EXT) != GL_FRAMEBUFFER_COMPLETE_EXT) abort();
}

static void
destroy_offscreen_context(void)
{
  if (capture_depthbuffer) glDeleteRenderbuffersEXT(1, &capture_depthbuffer);
  if (capture_colorbuffer) glDeleteRenderbuffersEXT(1, &capture_colorbuffer);
  if (capture_framebuffer) glDeleteFramebuffersEXT(1, &capture_framebuffer);
  CGLSetCurrentContext(NULL);
  if (capture_context) CGLDestroyContext(capture_context);
  if (capture_pixel_format) CGLDestroyPixelFormat(capture_pixel_format);
}

static long
parse_positive(const char *text, const char *label)
{
  char *end = NULL;
  long value = strtol(text, &end, 10);
  if (!text[0] || *end || value <= 0) {
    fprintf(stderr, "invalid %s\n", label);
    exit(2);
  }
  return value;
}

GLXContext *init_GL(ModeInfo *mi) { (void)mi; return &capture_glx_context; }
Bool glXMakeCurrent(Display *display, Window window, GLXContext context) { (void)display; (void)window; (void)context; return True; }
void glXSwapBuffers(Display *display, Window window) { (void)display; (void)window; }
void do_fps(ModeInfo *mi) { (void)mi; }
Bool screenhack_event_helper(Display *display, Window window, XEvent *event) { (void)display; (void)window; (void)event; return False; }
double current_device_rotation(void) { return 0; }
void load_texture_async(Screen *screen, Window window, GLXContext context,
                        int width, int height, Bool mipmap, GLuint texture,
                        void (*callback)(const char *, XRectangle *, int, int, int, int, void *),
                        void *closure) {
  (void)screen; (void)window; (void)context; (void)width; (void)height;
  (void)mipmap; (void)texture; (void)callback; (void)closure;
}
