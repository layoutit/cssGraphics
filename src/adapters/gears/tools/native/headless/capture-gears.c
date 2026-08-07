#include <OpenGL/OpenGL.h>
#include <errno.h>

#define USE_GL 1
#define get_rotation cssgears_capture_get_rotation
#include "gears.c"
#undef get_rotation

extern void get_rotation(rotator *, double *, double *, double *, int);

static int capture_rotation_override_p;
static double capture_rotation_override[3];

void
cssgears_capture_get_rotation(rotator *rot, double *x, double *y, double *z,
                              int update_p)
{
  if (!capture_rotation_override_p) {
    get_rotation(rot, x, y, z, update_p);
    return;
  }
  if (x) *x = capture_rotation_override[0];
  if (y) *y = capture_rotation_override[1];
  if (z) *z = capture_rotation_override[2];
}

const char *progname = "cssgears-headless-native-capture";

struct trackball_state { int identity; };

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static int capture_width;
static int capture_height;
static GLXContext capture_glx_context;

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static void write_ppm(const char *path, int width, int height);
static void write_state(const char *path, unsigned int seed, const ModeInfo *mi,
                        double px, double py, double pz,
                        double rx, double ry, double rz);
static void write_tick(FILE *out, int tick, const gears_configuration *bp);
static void frame_path(char *path, size_t size, const char *pattern, int frame);
static void print_number(FILE *out, double value);
static long parse_positive(const char *text, const char *label);
static double parse_number(const char *text, const char *label);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  gears_configuration *bp;
  unsigned int seed;
  double px, py, pz, rx, ry, rz;
  Bool sequence_p;
  Bool presentation_p;
  int frame_count = 1;
  FILE *ticks = NULL;

  sequence_p = (argc == 8 || argc == 11);
  presentation_p = (argc == 9 || argc == 11);
  if (argc != 6 && argc != 8 && argc != 9 && argc != 11) {
    fprintf(stderr, "usage: %s seed width height frame.ppm state.json\n"
                    "       %s seed width height frame.ppm state.json rot-x rot-y rot-z\n"
                    "       %s seed width height frame-pattern state.json frame-count ticks.jsonl\n"
                    "       %s seed width height frame-pattern state.json frame-count ticks.jsonl rot-x rot-y rot-z\n",
            argv[0], argv[0], argv[0], argv[0]);
    return 2;
  }

  seed = (unsigned int) parse_positive(argv[1], "seed");
  capture_width = (int) parse_positive(argv[2], "width");
  capture_height = (int) parse_positive(argv[3], "height");
  if (sequence_p)
    frame_count = (int) parse_positive(argv[6], "frame count");

  memset(&mi, 0, sizeof(mi));
  mi.width = capture_width;
  mi.height = capture_height;
  mi.count = 0;
  mi.wireframe_p = False;
  mi.fps_p = False;

  create_offscreen_context(capture_width, capture_height);
  glClearColor(0, 0, 0, 1);

#undef ya_rand_init
  ya_rand_init(seed);

  do_spin = False;
  do_wander = False;
  speed = 1.0f;
  init_gears(&mi);

  bp = &bps[0];
  if (!bp || !bp->gears || bp->ngears <= 0) {
    fprintf(stderr, "pinned gears.c did not produce a gear assembly\n");
    return 3;
  }
  if (bp->planetary_p) {
    fprintf(stderr, "seed %u selected the planetary path; choose a non-planetary seed\n", seed);
    return 4;
  }

  /* Advance the real source rotator once, exactly where draw_gears would.
     Then hold the button flag so draw_gears consumes that state without
     advancing it a second time or mutating the tick-zero gear angles. */
  get_position(bp->rot, &px, &py, &pz, True);
  get_rotation(bp->rot, &rx, &ry, &rz, True);
  bp->button_down_p = True;

  if (presentation_p) {
    int rotation_arg = sequence_p ? 8 : 6;
    capture_rotation_override[0] = parse_number(argv[rotation_arg], "rotation x") / 360.0 + 0.14;
    capture_rotation_override[1] = parse_number(argv[rotation_arg + 1], "rotation y") / 360.0 + 0.06;
    capture_rotation_override[2] = parse_number(argv[rotation_arg + 2], "rotation z") / 360.0;
    capture_rotation_override_p = True;
  }

  draw_gears(&mi);
  if (sequence_p) {
    char path[4096];
    ticks = fopen(argv[7], "wb");
    if (!ticks) {
      fprintf(stderr, "unable to write %s: %s\n", argv[7], strerror(errno));
      return 6;
    }
    write_tick(ticks, 0, bp);
    frame_path(path, sizeof(path), argv[4], 0);
    write_ppm(path, capture_width, capture_height);
  } else {
    write_ppm(argv[4], capture_width, capture_height);
  }
  write_state(argv[5], seed, &mi, px, py, pz, rx, ry, rz);

  if (sequence_p && frame_count > 1) {
    char path[4096];
    bp->button_down_p = False;

    /* The held tick-zero capture above did not execute the source's
       post-draw angle update. Execute that exact draw once without writing
       a duplicate frame, then every following draw presents tick N and
       performs the source update for tick N+1. */
    draw_gears(&mi);
    for (int frame = 1; frame < frame_count; frame++) {
      write_tick(ticks, frame, bp);
      draw_gears(&mi);
      frame_path(path, sizeof(path), argv[4], frame);
      write_ppm(path, capture_width, capture_height);
    }
  }
  if (ticks) fclose(ticks);

  free_gears(&mi);
  free(bps);
  bps = NULL;
  destroy_offscreen_context();
  return 0;
}

static void
write_tick(FILE *out, int tick, const gears_configuration *bp)
{
  fprintf(out, "{\"tick\":%d,\"theta\":[", tick);
  for (int index = 0; index < bp->ngears; index++) {
    if (index) fputc(',', out);
    print_number(out, bp->gears[index]->th);
  }
  fprintf(out, "]}\n");
}

static void
frame_path(char *path, size_t size, const char *pattern, int frame)
{
  int written = snprintf(path, size, pattern, frame);
  if (written < 0 || (size_t) written >= size) {
    fprintf(stderr, "frame path is too long\n");
    exit(6);
  }
}

static void
create_offscreen_context(int width, int height)
{
  CGLPixelFormatAttribute attributes[] = {
    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute) kCGLOGLPVersion_Legacy,
    kCGLPFAAccelerated,
    kCGLPFAColorSize, (CGLPixelFormatAttribute) 24,
    kCGLPFAAlphaSize, (CGLPixelFormatAttribute) 8,
    kCGLPFADepthSize, (CGLPixelFormatAttribute) 24,
    (CGLPixelFormatAttribute) 0,
  };
  GLint renderer_count = 0;
  CGLError error = CGLChoosePixelFormat(attributes, &capture_pixel_format, &renderer_count);
  if (error != kCGLNoError || !capture_pixel_format) {
    fprintf(stderr, "CGLChoosePixelFormat failed: %d\n", error);
    exit(5);
  }
  error = CGLCreateContext(capture_pixel_format, NULL, &capture_context);
  if (error != kCGLNoError || !capture_context) {
    fprintf(stderr, "CGLCreateContext failed: %d\n", error);
    exit(5);
  }
  error = CGLSetCurrentContext(capture_context);
  if (error != kCGLNoError) {
    fprintf(stderr, "CGLSetCurrentContext failed: %d\n", error);
    exit(5);
  }

  glGenFramebuffersEXT(1, &capture_framebuffer);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);

  glGenRenderbuffersEXT(1, &capture_colorbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, capture_colorbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_RGBA8, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT,
                               GL_RENDERBUFFER_EXT, capture_colorbuffer);

  glGenRenderbuffersEXT(1, &capture_depthbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, capture_depthbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_DEPTH_COMPONENT24, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_DEPTH_ATTACHMENT_EXT,
                               GL_RENDERBUFFER_EXT, capture_depthbuffer);

  if (glCheckFramebufferStatusEXT(GL_FRAMEBUFFER_EXT) != GL_FRAMEBUFFER_COMPLETE_EXT) {
    fprintf(stderr, "headless OpenGL framebuffer is incomplete\n");
    exit(5);
  }
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

static void
write_ppm(const char *path, int width, int height)
{
  FILE *out;
  unsigned char *rgba = malloc((size_t) width * (size_t) height * 4);
  unsigned char *row = malloc((size_t) width * 3);
  if (!rgba || !row) abort();

  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  check_gl_error("glReadPixels");

  out = fopen(path, "wb");
  if (!out) {
    fprintf(stderr, "unable to write %s: %s\n", path, strerror(errno));
    exit(6);
  }
  fprintf(out, "P6\n%d %d\n255\n", width, height);
  for (int y = height - 1; y >= 0; y--) {
    const unsigned char *source = rgba + (size_t) y * (size_t) width * 4;
    for (int x = 0; x < width; x++) {
      row[x * 3 + 0] = source[x * 4 + 0];
      row[x * 3 + 1] = source[x * 4 + 1];
      row[x * 3 + 2] = source[x * 4 + 2];
    }
    fwrite(row, 1, (size_t) width * 3, out);
  }
  fclose(out);
  free(row);
  free(rgba);
}

static void
write_state(const char *path, unsigned int seed, const ModeInfo *mi,
            double px, double py, double pz,
            double rx, double ry, double rz)
{
  FILE *out = fopen(path, "wb");
  gears_configuration *bp = &bps[0];
  double width = bp->bbox.x2 - bp->bbox.x1;
  double height = bp->bbox.y2 - bp->bbox.y1;
  double fit = 10.0 / (width > height ? width : height);
  if (!out) {
    fprintf(stderr, "unable to write %s: %s\n", path, strerror(errno));
    exit(6);
  }

  fprintf(out, "{\n  \"schema\": \"cssgears-native-state@1\",\n");
  fprintf(out, "  \"seed\": %u,\n", seed);
  fprintf(out, "  \"sourceConfig\": {\"count\": 0, \"speed\": 1, \"spin\": false, \"wander\": false, \"wireframe\": false},\n");
  fprintf(out, "  \"viewport\": {\"width\": %d, \"height\": %d},\n", mi->width, mi->height);
  fprintf(out, "  \"planetary\": false,\n  \"gearCount\": %d,\n", bp->ngears);
  fprintf(out, "  \"polygonCount\": %d,\n", mi->polygon_count);
  fprintf(out, "  \"bbox\": {\"minX\": "); print_number(out, bp->bbox.x1);
  fprintf(out, ", \"minY\": "); print_number(out, bp->bbox.y1);
  fprintf(out, ", \"maxX\": "); print_number(out, bp->bbox.x2);
  fprintf(out, ", \"maxY\": "); print_number(out, bp->bbox.y2);
  fprintf(out, ", \"fitScale\": "); print_number(out, fit); fprintf(out, "},\n");
  fprintf(out, "  \"scene\": {\n    \"positionFractions\": [");
  print_number(out, px); fputc(',', out); print_number(out, py); fputc(',', out); print_number(out, pz);
  fprintf(out, "],\n    \"translation\": [");
  print_number(out, (px - 0.5) * 4); fputc(',', out);
  print_number(out, (py - 0.5) * 4); fputc(',', out);
  print_number(out, (pz - 0.5) * 7);
  fprintf(out, "],\n    \"rotationFractions\": [");
  print_number(out, rx); fputc(',', out); print_number(out, ry); fputc(',', out); print_number(out, rz);
  fprintf(out, "],\n    \"rotationDegrees\": [");
  print_number(out, (rx - 0.14) * 360); fputc(',', out);
  print_number(out, (ry - 0.06) * 360); fputc(',', out);
  print_number(out, rz * 360);
  fprintf(out, "],\n    \"trackball\": \"identity\"\n  },\n");

  fprintf(out, "  \"gears\": [\n");
  for (int i = 0; i < bp->ngears; i++) {
    gear *g = bp->gears[i];
    fprintf(out, "    {\"index\":%d,\"id\":%lu,\"parentIndex\":%d,", i, g->id, i ? i - 1 : -1);
    fprintf(out, "\"position\":["); print_number(out, g->x); fputc(',', out); print_number(out, g->y); fputc(',', out); print_number(out, g->z);
    fprintf(out, "],\"theta\":"); print_number(out, g->th);
    fprintf(out, ",\"radius\":"); print_number(out, g->r);
    fprintf(out, ",\"ratio\":"); print_number(out, g->ratio);
    fprintf(out, ",\"rpm\":"); print_number(out, g->rpm);
    fprintf(out, ",\"nteeth\":%d", g->nteeth);
    fprintf(out, ",\"toothWidth\":"); print_number(out, g->tooth_w);
    fprintf(out, ",\"toothHeight\":"); print_number(out, g->tooth_h);
    fprintf(out, ",\"toothSlope\":"); print_number(out, g->tooth_slope);
    fprintf(out, ",\"innerRadius\":"); print_number(out, g->inner_r);
    fprintf(out, ",\"innerRadius2\":"); print_number(out, g->inner_r2);
    fprintf(out, ",\"innerRadius3\":"); print_number(out, g->inner_r3);
    fprintf(out, ",\"thickness\":"); print_number(out, g->thickness);
    fprintf(out, ",\"thickness2\":"); print_number(out, g->thickness2);
    fprintf(out, ",\"thickness3\":"); print_number(out, g->thickness3);
    fprintf(out, ",\"spokes\":%d,\"nubs\":%d", g->spokes, g->nubs);
    fprintf(out, ",\"spokeThickness\":"); print_number(out, g->spoke_thickness);
    fprintf(out, ",\"wobble\":"); print_number(out, g->wobble);
    fprintf(out, ",\"motionBlur\":%s,\"inverted\":%s,\"base\":%s,\"coax\":%d",
            g->motion_blur_p ? "true" : "false", g->inverted_p ? "true" : "false",
            g->base_p ? "true" : "false", g->coax_p);
    fprintf(out, ",\"coaxDisplacement\":"); print_number(out, g->coax_displacement);
    fprintf(out, ",\"coaxThickness\":"); print_number(out, g->coax_thickness);
    fprintf(out, ",\"size\":%d,\"polygons\":%d,\"color\":[", g->size, g->polygons);
    for (int c = 0; c < 4; c++) { if (c) fputc(',', out); print_number(out, g->color[c]); }
    fprintf(out, "],\"color2\":[");
    for (int c = 0; c < 4; c++) { if (c) fputc(',', out); print_number(out, g->color2[c]); }
    fprintf(out, "]}%s\n", i + 1 == bp->ngears ? "" : ",");
  }
  fprintf(out, "  ]\n}\n");
  fclose(out);
}

static void
print_number(FILE *out, double value)
{
  if (value == 0) value = 0;
  fprintf(out, "%.17g", value);
}

static long
parse_positive(const char *text, const char *label)
{
  char *end = NULL;
  long value;
  errno = 0;
  value = strtol(text, &end, 10);
  if (errno || !end || *end || value <= 0) {
    fprintf(stderr, "invalid %s: %s\n", label, text);
    exit(2);
  }
  return value;
}

static double
parse_number(const char *text, const char *label)
{
  char *end = NULL;
  double value;
  errno = 0;
  value = strtod(text, &end);
  if (errno || !end || *end || !isfinite(value)) {
    fprintf(stderr, "invalid %s: %s\n", label, text);
    exit(2);
  }
  return value;
}

GLXContext *
init_GL(ModeInfo *mi)
{
  (void) mi;
  capture_glx_context = capture_context;
  return &capture_glx_context;
}

Bool glXMakeCurrent(Display *display, Window window, GLXContext context)
{ (void) display; (void) window; (void) context; return True; }
void glXSwapBuffers(Display *display, Window window)
{ (void) display; (void) window; }
void do_fps(ModeInfo *mi) { (void) mi; }
Bool screenhack_event_helper(Display *display, Window window, XEvent *event)
{ (void) display; (void) window; (void) event; return False; }

void
check_gl_error(const char *label)
{
  GLenum error = glGetError();
  if (error != GL_NO_ERROR) {
    fprintf(stderr, "%s: OpenGL error 0x%x\n", label, error);
    abort();
  }
}

trackball_state *gltrackball_init(int ignore_device_rotation_p)
{ (void) ignore_device_rotation_p; return calloc(1, sizeof(trackball_state)); }
void gltrackball_free(trackball_state *state) { free(state); }
void gltrackball_start(trackball_state *state, int x, int y, int w, int h)
{ (void) state; (void) x; (void) y; (void) w; (void) h; }
void gltrackball_track(trackball_state *state, int x, int y, int w, int h)
{ (void) state; (void) x; (void) y; (void) w; (void) h; }
void gltrackball_stop(trackball_state *state) { (void) state; }
void gltrackball_rotate(trackball_state *state) { (void) state; }
void gltrackball_mousewheel(trackball_state *state, int button, int percent, int flip_p)
{ (void) state; (void) button; (void) percent; (void) flip_p; }
quat gltrackball_get_quat(trackball_state *state)
{ (void) state; return (quat) {0, 0, 0, 1}; }
void gltrackball_get_quaternion(trackball_state *state, float q[4])
{ (void) state; q[0] = q[1] = q[2] = 0; q[3] = 1; }
void gltrackball_reset(trackball_state *state, float x, float y)
{ (void) state; (void) x; (void) y; }
Bool gltrackball_event_handler(XEvent *event, trackball_state *state,
                               int width, int height, Bool *button_down_p)
{ (void) event; (void) state; (void) width; (void) height; (void) button_down_p; return False; }

int
tube(GLfloat x1, GLfloat y1, GLfloat z1,
     GLfloat x2, GLfloat y2, GLfloat z2,
     GLfloat diameter, GLfloat cap_size,
     int faces, int smooth, int caps_p, int wire_p)
{
  (void) x1; (void) y1; (void) z1; (void) x2; (void) y2; (void) z2;
  (void) diameter; (void) cap_size; (void) faces; (void) smooth;
  (void) caps_p; (void) wire_p;
  return 0;
}

int
cone(GLfloat x1, GLfloat y1, GLfloat z1,
     GLfloat x2, GLfloat y2, GLfloat z2,
     GLfloat diameter, GLfloat cap_size,
     int faces, int smooth, int cap_p, int wire_p)
{
  return tube(x1, y1, z1, x2, y2, z2, diameter, cap_size,
              faces, smooth, cap_p, wire_p);
}
