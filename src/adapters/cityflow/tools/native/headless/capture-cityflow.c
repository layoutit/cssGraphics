#include <OpenGL/OpenGL.h>
#include <errno.h>
#include <limits.h>
#include <sys/stat.h>

char *progname = "csscityflow-headless-native-oracle";

#define USE_GL 1
#include "cityflow.c"

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static GLXContext capture_glx_context;

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static int write_ppm(const char *path, int width, int height);
static long parse_positive(const char *text, const char *label);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  unsigned int seed;
  int width;
  int height;
  int frame_count;
  char path[4096];

  if (argc != 7) {
    fprintf(stderr, "usage: %s frames-directory seed count width height frames\n", argv[0]);
    return 2;
  }
  seed = (unsigned int)parse_positive(argv[2], "seed");
  width = (int)parse_positive(argv[4], "width");
  height = (int)parse_positive(argv[5], "height");
  frame_count = (int)parse_positive(argv[6], "frames");
  if (mkdir(argv[1], 0777) != 0 && errno != EEXIST) {
    perror("mkdir frames");
    return 3;
  }

  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  mi.count = (int)parse_positive(argv[3], "count");
  mi.wireframe_p = False;
  mi.fps_p = False;

  create_offscreen_context(width, height);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);

#undef ya_rand_init
  ya_rand_init(seed);
  wave_count = 6;
  wave_speed = 25;
  wave_radius = 256;
  skew = 12;
  init_cube(&mi);

  for (int frame = 0; frame < frame_count; frame++) {
    draw_cube(&mi);
    snprintf(path, sizeof(path), "%s/frame_%04d.ppm", argv[1], frame);
    if (!write_ppm(path, width, height)) return 4;
  }

  free_cube(&mi);
  free(ccs);
  ccs = NULL;
  destroy_offscreen_context();
  return 0;
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
  if (CGLChoosePixelFormat(attributes, &capture_pixel_format, &count) != kCGLNoError || !capture_pixel_format) abort();
  if (CGLCreateContext(capture_pixel_format, NULL, &capture_context) != kCGLNoError || !capture_context) abort();
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
  errno = 0;
  long value = strtol(text, &end, 10);
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
