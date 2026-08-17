#include <OpenGL/OpenGL.h>
#include <errno.h>
#include <limits.h>
#include <sys/stat.h>
#include <unistd.h>

char *progname = "cssgravitywell-headless-native-oracle";

#define USE_GL 1
#include "gravitywell.c"

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static GLXContext capture_glx_context;

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static int write_ppm(const char *path, int width, int height);
static int write_renderer(const char *directory, int width, int height);
static void write_tick(FILE *stream, int tick, const ModeInfo *mi,
                       const gw_configuration *gw);
static long parse_positive(const char *text, const char *label);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  gw_configuration *gw;
  unsigned int seed;
  int width;
  int height;
  int capture_count;
  int *ticks;
  int tick;
  int capture_index = 0;
  FILE *states;
  char path[4096];
  char states_temporary[4096];

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
  if (snprintf(states_temporary, sizeof(states_temporary), "%s.tmp.%ld", argv[2], (long)getpid()) >=
      (int)sizeof(states_temporary)) {
    fprintf(stderr, "states path is too long\n");
    return 3;
  }
  states = fopen(states_temporary, "wb");
  if (!states) {
    perror("open states");
    return 3;
  }

  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  mi.count = 15;
  mi.wireframe_p = False;
  mi.fps_p = False;

  create_offscreen_context(width, height);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glClearColor(0, 0, 0, 1);

#undef ya_rand_init
  ya_rand_init(seed);
  speed = 1.0f;
  resolution = 1.0f;
  grid_size = 16.0f / 7.0f;
  init_gw(&mi);
  gw = &bps[0];

  if (!write_renderer(argv[1], width, height)) {
    fclose(states);
    remove(states_temporary);
    return 4;
  }
  for (tick = 0; tick <= ticks[capture_count - 1]; tick++) {
    draw_gw(&mi);
    if (tick == ticks[capture_index]) {
      snprintf(path, sizeof(path), "%s/frame_%04d.ppm", argv[1], capture_index);
      if (!write_ppm(path, width, height)) {
        fclose(states);
        remove(states_temporary);
        return 5;
      }
      write_tick(states, tick, &mi, gw);
      capture_index++;
      if (capture_index == capture_count) break;
    }
  }
  if (fclose(states) != 0 || rename(states_temporary, argv[2]) != 0) {
    perror("write states");
    remove(states_temporary);
    return 6;
  }
  free_gw(&mi);
  free(bps);
  bps = NULL;
  destroy_offscreen_context();
  free(ticks);
  return capture_index == capture_count ? 0 : 6;
}

static void
write_tick(FILE *stream, int tick, const ModeInfo *mi,
           const gw_configuration *gw)
{
  float quaternion[4];
  gltrackball_get_quaternion(gw->user_trackball, quaternion);
  fprintf(stream,
          "{\"tick\":%d,\"polygonCount\":%d,\"gridWidth\":%d,"
          "\"gridHeight\":%d,\"starCount\":%d,\"trackballQuaternion\":[%.9g,%.9g,%.9g,%.9g],\"stars\":[",
          tick, mi->polygon_count, gw->grid_w, gw->grid_h, gw->nstars,
          quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  for (int index = 0; index < gw->nstars; index++) {
    const star *body = &gw->stars[index];
    if (index) fputc(',', stream);
    fprintf(stream,
            "{\"x\":%.9g,\"y\":%.9g,\"radius\":%.9g,\"mass\":%.9g,\"depth\":%.9g}",
            body->x, body->y, body->radius, body->mass, body->depth);
  }
  fprintf(stream, "]}\n");
}

static int
write_renderer(const char *directory, int width, int height)
{
  char path[4096];
  char temporary[4096];
  FILE *stream;
  const unsigned char *vendor = glGetString(GL_VENDOR);
  const unsigned char *renderer = glGetString(GL_RENDERER);
  const unsigned char *version = glGetString(GL_VERSION);
  snprintf(path, sizeof(path), "%s/native-renderer.json", directory);
  if (snprintf(temporary, sizeof(temporary), "%s.tmp.%ld", path, (long)getpid()) >=
      (int)sizeof(temporary)) {
    return 0;
  }
  stream = fopen(temporary, "wb");
  if (!stream) return 0;
  fprintf(stream,
    "{\n  \"schema\": \"cssgravitywell-native-gl-renderer@1\",\n"
    "  \"vendor\": \"%s\",\n  \"renderer\": \"%s\",\n  \"version\": \"%s\",\n"
    "  \"width\": %d,\n  \"height\": %d,\n  \"pixelFormat\": \"rgba8-depth24-cgl-fbo\"\n}\n",
    vendor ? vendor : (const unsigned char *)"unknown",
    renderer ? renderer : (const unsigned char *)"unknown",
    version ? version : (const unsigned char *)"unknown",
    width, height);
  if (fclose(stream) != 0 || rename(temporary, path) != 0) {
    remove(temporary);
    return 0;
  }
  return 1;
}

static int
write_ppm(const char *path, int width, int height)
{
  unsigned char *rgba = malloc((size_t)width * (size_t)height * 4);
  unsigned char *row = malloc((size_t)width * 3);
  char temporary[4096];
  FILE *stream;
  if (!rgba || !row) abort();
  glFinish();
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  if (glGetError() != GL_NO_ERROR) {
    free(row);
    free(rgba);
    return 0;
  }
  if (snprintf(temporary, sizeof(temporary), "%s.tmp.%ld", path, (long)getpid()) >=
      (int)sizeof(temporary)) return 0;
  stream = fopen(temporary, "wb");
  if (!stream) {
    free(row);
    free(rgba);
    return 0;
  }
  fprintf(stream, "P6\n%d %d\n255\n", width, height);
  for (int y = height - 1; y >= 0; y--) {
    const unsigned char *source = rgba + (size_t)y * (size_t)width * 4;
    for (int x = 0; x < width; x++) {
      row[x * 3] = source[x * 4];
      row[x * 3 + 1] = source[x * 4 + 1];
      row[x * 3 + 2] = source[x * 4 + 2];
    }
    if (fwrite(row, 1, (size_t)width * 3, stream) != (size_t)width * 3) {
      fclose(stream);
      remove(temporary);
      free(row);
      free(rgba);
      return 0;
    }
  }
  free(row);
  free(rgba);
  if (fclose(stream) != 0 || rename(temporary, path) != 0) {
    remove(temporary);
    return 0;
  }
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
double current_device_rotation(void) { return 0; }

char *
get_string_resource(Display *display, char *name, char *class_name)
{
  (void)display;
  (void)class_name;
  return strdup(!strcmp(name, "gridColor2") ? "#FF0000" : "#00FF00");
}

int
XParseColor(Display *display, Colormap colormap, const char *specification,
            XColor *color)
{
  unsigned int red, green, blue;
  (void)display;
  (void)colormap;
  if (!specification || sscanf(specification, "#%2x%2x%2x", &red, &green, &blue) != 3)
    return 0;
  color->red = (unsigned short)(red * 257u);
  color->green = (unsigned short)(green * 257u);
  color->blue = (unsigned short)(blue * 257u);
  return 1;
}
