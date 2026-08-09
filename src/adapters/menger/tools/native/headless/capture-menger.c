#include <OpenGL/OpenGL.h>
#include <errno.h>
#include <limits.h>
#include <sys/stat.h>

#define USE_GL 1
#define get_rotation cssmenger_capture_get_rotation
#include "menger.c"
#undef get_rotation

extern void get_rotation(rotator *, double *, double *, double *, int);

char *progname = "cssmenger-headless-native-oracle";

struct trackball_state { int identity; };

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static GLXContext capture_glx_context;
static double capture_rotation[3];

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static int write_ppm(const char *path, int width, int height);
static int write_renderer(const char *directory, int width, int height);
static void write_tick(FILE *stream, int tick, const ModeInfo *mi, const sponge_configuration *sp);
static long parse_positive(const char *text, const char *label);

void
cssmenger_capture_get_rotation(rotator *rot, double *x, double *y, double *z,
                               int update_p)
{
  get_rotation(rot, x, y, z, update_p);
  capture_rotation[0] = x ? *x : 0;
  capture_rotation[1] = y ? *y : 0;
  capture_rotation[2] = z ? *z : 0;
}

int
main(int argc, char **argv)
{
  ModeInfo mi;
  sponge_configuration *sp;
  unsigned int seed;
  int width;
  int height;
  int capture_count;
  int *ticks;
  int tick;
  int capture_index = 0;
  FILE *states;
  char path[4096];

  if (argc < 7) {
    fprintf(stderr, "usage: %s frames-directory states.jsonl seed width height tick [tick ...]\n", argv[0]);
    return 2;
  }
  seed = (unsigned int)parse_positive(argv[3], "seed");
  width = (int)parse_positive(argv[4], "width");
  height = (int)parse_positive(argv[5], "height");
  capture_count = argc - 6;
  ticks = calloc((size_t)capture_count, sizeof(*ticks));
  if (!ticks) abort();
  for (int index = 0; index < capture_count; index++) {
    ticks[index] = (int)parse_positive(argv[index + 6], "tick plus one") - 1;
    if (ticks[index] < 0 || (index > 0 && ticks[index] <= ticks[index - 1])) {
      fprintf(stderr, "capture ticks must be strictly increasing non-negative integers\n");
      return 2;
    }
  }
  if (mkdir(argv[1], 0777) != 0 && errno != EEXIST) {
    perror("mkdir frames");
    return 3;
  }
  states = fopen(argv[2], "wb");
  if (!states) {
    perror("open states");
    return 3;
  }

  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  mi.wireframe_p = False;
  mi.fps_p = False;

  create_offscreen_context(width, height);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glClearColor(0, 0, 0, 1);

#undef ya_rand_init
  ya_rand_init(seed);
  do_spin = True;
  do_wander = False;
  speed = 1000000;
  max_depth = 3;
  init_sponge(&mi);
  sp = &sps[0];
  sp->current_depth = 2;
  sp->draw_tick = speed;

  if (!write_renderer(argv[1], width, height)) return 4;
  for (tick = 0; tick <= ticks[capture_count - 1]; tick++) {
    draw_sponge(&mi);
    if (tick == ticks[capture_index]) {
      snprintf(path, sizeof(path), "%s/frame_%04d.ppm", argv[1], capture_index);
      if (!write_ppm(path, width, height)) return 5;
      write_tick(states, tick, &mi, sp);
      capture_index++;
      if (capture_index == capture_count) break;
    }
  }
  fclose(states);
  free_sponge(&mi);
  free(sps);
  sps = NULL;
  destroy_offscreen_context();
  free(ticks);
  return capture_index == capture_count ? 0 : 6;
}

static void
write_tick(FILE *stream, int tick, const ModeInfo *mi, const sponge_configuration *sp)
{
  int indices[3] = {
    (sp->ccolor0 + sp->ncolors - 1) % sp->ncolors,
    (sp->ccolor1 + sp->ncolors - 1) % sp->ncolors,
    (sp->ccolor2 + sp->ncolors - 1) % sp->ncolors,
  };
  fprintf(stream, "{\"tick\":%d,\"depth\":%d,\"polygonCount\":%d,", tick, mi->recursion_depth, mi->polygon_count);
  fprintf(stream, "\"rotationFractions\":[%.17g,%.17g,%.17g],", capture_rotation[0], capture_rotation[1], capture_rotation[2]);
  fprintf(stream, "\"paletteIndices\":[%d,%d,%d],\"paletteSource16\":[", indices[0], indices[1], indices[2]);
  for (int axis = 0; axis < 3; axis++) {
    const XColor color = sp->colors[indices[axis]];
    if (axis) fputc(',', stream);
    fprintf(stream, "[%u,%u,%u]", color.red, color.green, color.blue);
  }
  fprintf(stream, "]}\n");
}

static int
write_renderer(const char *directory, int width, int height)
{
  char path[4096];
  FILE *stream;
  const unsigned char *vendor = glGetString(GL_VENDOR);
  const unsigned char *renderer = glGetString(GL_RENDERER);
  const unsigned char *version = glGetString(GL_VERSION);
  snprintf(path, sizeof(path), "%s/native-renderer.json", directory);
  stream = fopen(path, "wb");
  if (!stream) return 0;
  fprintf(stream,
    "{\n  \"schema\": \"cssmenger-native-gl-renderer@1\",\n"
    "  \"vendor\": \"%s\",\n  \"renderer\": \"%s\",\n  \"version\": \"%s\",\n"
    "  \"width\": %d,\n  \"height\": %d,\n  \"pixelFormat\": \"rgba8-depth24-cgl-fbo\"\n}\n",
    vendor ? vendor : (const unsigned char *)"unknown",
    renderer ? renderer : (const unsigned char *)"unknown",
    version ? version : (const unsigned char *)"unknown",
    width, height);
  return fclose(stream) == 0;
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
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  if (glGetError() != GL_NO_ERROR) return 0;
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
    if (fwrite(row, 1, (size_t)width * 3, stream) != (size_t)width * 3) return 0;
  }
  free(row);
  free(rgba);
  return fclose(stream) == 0;
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
  CGLError error = CGLChoosePixelFormat(attributes, &capture_pixel_format, &count);
  if (error != kCGLNoError || !capture_pixel_format) abort();
  error = CGLCreateContext(capture_pixel_format, NULL, &capture_context);
  if (error != kCGLNoError || !capture_context) abort();
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
  long value;
  errno = 0;
  value = strtol(text, &end, 10);
  if (errno || !end || *end || value <= 0 || value > INT_MAX) {
    fprintf(stderr, "%s must be a positive integer\n", label);
    exit(2);
  }
  return value;
}

GLXContext *init_GL(ModeInfo *mi) { (void)mi; return &capture_glx_context; }
Bool glXMakeCurrent(Display *display, Window window, GLXContext context) { (void)display; (void)window; (void)context; return True; }
void glXSwapBuffers(Display *display, Window window) { (void)display; (void)window; }
void do_fps(ModeInfo *mi) { (void)mi; }
Bool screenhack_event_helper(Display *display, Window window, XEvent *event) { (void)display; (void)window; (void)event; return False; }
trackball_state *gltrackball_init(int ignored) { (void)ignored; return calloc(1, sizeof(trackball_state)); }
void gltrackball_free(trackball_state *state) { free(state); }
void gltrackball_rotate(trackball_state *state) { (void)state; }
Bool gltrackball_event_handler(XEvent *event, trackball_state *state, int width, int height, Bool *down) { (void)event; (void)state; (void)width; (void)height; (void)down; return False; }
