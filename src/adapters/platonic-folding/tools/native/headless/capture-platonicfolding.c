#include <OpenGL/OpenGL.h>
#include <errno.h>
#include <limits.h>
#include <sys/stat.h>

char *progname = "cssplatonicfolding-headless-native-oracle";

#define USE_GL 1
#include "platonicfolding.c"

static CGLContextObj capture_context;
static CGLPixelFormatObj capture_pixel_format;
static GLuint capture_framebuffer;
static GLuint capture_colorbuffer;
static GLuint capture_depthbuffer;
static GLXContext capture_glx_context;

static const int source_order[] = {
  ICOSAHEDRON,
  DODECAHEDRON,
  HEXAHEDRON,
  OCTAHEDRON,
  TETRAHEDRON,
};

static void create_offscreen_context(int width, int height);
static void destroy_offscreen_context(void);
static void initialize_profile_shader(platonicfoldingstruct *pf);
static void destroy_profile_shader(platonicfoldingstruct *pf);
static void initialize_profile_solid(ModeInfo *mi, int sequence_index,
                                     float *initial_delta);
static void set_profile_frame(platonicfoldingstruct *pf, int sequence_index,
                              int local_frame, float initial_delta);
static int write_ppm(const char *path, int width, int height);
static long parse_nonnegative(const char *text, const char *label);
static long parse_positive(const char *text, const char *label);
static void assert_no_gl_errors(const char *stage);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  platonicfoldingstruct *pf;
  unsigned int seed;
  int width;
  int height;
  int capture_count;
  int current_sequence = -1;
  float initial_delta = 0;
  char path[4096];

  if (argc < 6) {
    fprintf(stderr, "usage: %s frames-directory seed width height frame [frame ...]\n", argv[0]);
    return 2;
  }
  seed = (unsigned int)parse_positive(argv[2], "seed");
  width = (int)parse_positive(argv[3], "width");
  height = (int)parse_positive(argv[4], "height");
  capture_count = argc - 5;
  if (mkdir(argv[1], 0777) != 0 && errno != EEXIST) {
    perror("mkdir frames");
    return 3;
  }

  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  create_offscreen_context(width, height);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, capture_framebuffer);
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);

  platonicfolding = calloc(1, sizeof(*platonicfolding));
  if (!platonicfolding) abort();
  pf = &platonicfolding[0];
  pf->WindW = width;
  pf->WindH = height;
  pf->aspect = (float)width / (float)height;
  pf->trackball = gltrackball_init(False);
  initialize_profile_shader(pf);
  assert_no_gl_errors("shader initialization");

#undef ya_rand_init
  ya_rand_init(seed);
  for (int capture_index = 0; capture_index < capture_count; capture_index++) {
    int global_frame = (int)parse_nonnegative(argv[capture_index + 5], "frame");
    int sequence_index = global_frame / 542;
    int local_frame = global_frame % 542;
    if (sequence_index < current_sequence || sequence_index >= (int)countof(source_order)) {
      fprintf(stderr, "frames must be ordered and within the prepared sequence\n");
      return 2;
    }
    while (current_sequence < sequence_index) {
      current_sequence++;
      initialize_profile_solid(&mi, current_sequence, &initial_delta);
    }
    set_profile_frame(pf, sequence_index, local_frame, initial_delta);
    mi.polygon_count = polygon_folding_pf(&mi);
    assert_no_gl_errors("source draw");
    snprintf(path, sizeof(path), "%s/frame_%04d.ppm", argv[1], capture_index);
    if (!write_ppm(path, width, height)) return 4;
  }

  gltrackball_free(pf->trackball);
  destroy_profile_shader(pf);
  free_base_polygons(pf->base_polygons);
  free_tree(pf->polygon_unfolding);
  free(platonicfolding);
  platonicfolding = NULL;
  destroy_offscreen_context();
  return 0;
}

static void
assert_no_gl_errors(const char *stage)
{
  GLenum error = glGetError();
  if (error != GL_NO_ERROR) {
    fprintf(stderr, "%s: OpenGL error 0x%x\n", stage, error);
    exit(4);
  }
}

static void
initialize_profile_shader(platonicfoldingstruct *pf)
{
  const GLubyte pixel[] = { 0, 0, 0, 0 };
  const GLchar *vertex_sources[] = { glsl_GetGLSLVersionString(), vertex_shader };
  const GLchar *fragment_sources[] = { glsl_GetGLSLVersionString(), fragment_shader };
  if (!glsl_CompileAndLinkShaders(2, vertex_sources, 2, fragment_sources,
                                  &pf->shader_program)) abort();
#define ATTRIBUTE(name, source_name) do { \
  pf->name = glGetAttribLocation(pf->shader_program, source_name); \
  if (pf->name < 0) abort(); \
} while (0)
#define UNIFORM(name, source_name) do { \
  pf->name = glGetUniformLocation(pf->shader_program, source_name); \
  if (pf->name < 0) abort(); \
} while (0)
  ATTRIBUTE(pos_index, "VertexPosition");
  ATTRIBUTE(normal_index, "VertexNormal");
  ATTRIBUTE(color_index, "VertexColor");
  ATTRIBUTE(tex_index, "VertexTexCoord");
  UNIFORM(mv_index, "MatModelView");
  UNIFORM(proj_index, "MatProj");
  UNIFORM(magma_offs_index, "TexOffsetMagma");
  UNIFORM(north_up_index, "NorthUp");
  UNIFORM(glbl_ambient_index, "LtGlblAmbient");
  UNIFORM(lt_ambient_index, "LtAmbient");
  UNIFORM(lt_diffuse_index, "LtDiffuse");
  UNIFORM(lt_specular_index, "LtSpecular");
  UNIFORM(lt_direction_index, "LtDirection");
  UNIFORM(lt_halfvect_index, "LtHalfVector");
  UNIFORM(ambient_index, "MatAmbient");
  UNIFORM(diffuse_index, "MatDiffuse");
  UNIFORM(specular_index, "MatSpecular");
  UNIFORM(shininess_index, "MatShininess");
  UNIFORM(bool_textures_index, "BoolTextures");
  UNIFORM(samp_mgm_index, "TextureSamplerMagma");
  UNIFORM(samp_day_index, "TextureSamplerDay");
  UNIFORM(samp_ngt_index, "TextureSamplerNight");
  UNIFORM(samp_wtr_index, "TextureSamplerWater");
#undef ATTRIBUTE
#undef UNIFORM
  glGenBuffers(1, &pf->vertex_buffer);
  glGenBuffers(1, &pf->normal_buffer);
  glGenBuffers(1, &pf->color_buffer);
  glGenBuffers(1, &pf->tex_buffer);
  glUseProgram(pf->shader_program);
  glUniform1i(pf->samp_mgm_index, 0);
  glUniform1i(pf->samp_day_index, 1);
  glUniform1i(pf->samp_ngt_index, 2);
  glUniform1i(pf->samp_wtr_index, 3);
  glUseProgram(0);
  glGenTextures(1, &pf->magma_tex);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_3D, pf->magma_tex);
  glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA, 1, 1, 1, 0, GL_RGBA,
               GL_UNSIGNED_BYTE, pixel);
  glGenTextures(3, pf->earth_tex);
  for (int index = 0; index < 3; index++) {
    glActiveTexture(GL_TEXTURE1 + index);
    glBindTexture(GL_TEXTURE_2D, pf->earth_tex[index]);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, pixel);
  }
  glActiveTexture(GL_TEXTURE0);
  pf->north_up = true;
  pf->use_shaders = true;
  pf->use_textures = false;
  pf->textures_supported = false;
  pf->use_vao = false;
}

static void
destroy_profile_shader(platonicfoldingstruct *pf)
{
  glDeleteBuffers(1, &pf->vertex_buffer);
  glDeleteBuffers(1, &pf->normal_buffer);
  glDeleteBuffers(1, &pf->color_buffer);
  glDeleteBuffers(1, &pf->tex_buffer);
  glDeleteTextures(1, &pf->magma_tex);
  glDeleteTextures(3, pf->earth_tex);
  glDeleteProgram(pf->shader_program);
}

static void
initialize_profile_solid(ModeInfo *mi, int sequence_index,
                         float *initial_delta)
{
  platonicfoldingstruct *pf = &platonicfolding[MI_SCREEN(mi)];
  int poly = source_order[sequence_index];
  init_color_matrix(pf->color_matrix);
  if (pf->base_polygons) free_base_polygons(pf->base_polygons);
  if (pf->polygon_unfolding) free_tree(pf->polygon_unfolding);
  pf->base_polygons = NULL;
  pf->polygon_unfolding = NULL;
  switch (poly) {
    case TETRAHEDRON:
      pf->polygon_unfolding = create_random_polyhedron_unfolding(
        TETRAHEDRON_NUM_FACES, TETRAHEDRON_NUM_EDGES, tetrahedron_edges);
      pf->max_angle = TETRAHEDRON_MAX_ANGLE;
      pf->num_fold_angles = TETRAHEDRON_NUM_FACES - 1;
      pf->eye_pos = tetrahedron_eye_pos;
      pf->base_polygons = init_base_polygons(pf->polygon_unfolding, &tetrahedron_triangle);
      break;
    case HEXAHEDRON:
      pf->polygon_unfolding = create_random_polyhedron_unfolding(
        HEXAHEDRON_NUM_FACES, HEXAHEDRON_NUM_EDGES, hexahedron_edges);
      pf->max_angle = HEXAHEDRON_MAX_ANGLE;
      pf->num_fold_angles = HEXAHEDRON_NUM_FACES - 1;
      pf->eye_pos = hexahedron_eye_pos;
      pf->base_polygons = init_base_polygons(pf->polygon_unfolding, &hexahedron_square);
      break;
    case OCTAHEDRON:
      pf->polygon_unfolding = create_random_polyhedron_unfolding(
        OCTAHEDRON_NUM_FACES, OCTAHEDRON_NUM_EDGES, octahedron_edges);
      pf->max_angle = OCTAHEDRON_MAX_ANGLE;
      pf->num_fold_angles = OCTAHEDRON_NUM_FACES - 1;
      pf->eye_pos = octahedron_eye_pos;
      pf->base_polygons = init_base_polygons(pf->polygon_unfolding, &octahedron_triangle);
      break;
    case DODECAHEDRON:
      pf->polygon_unfolding = create_random_polyhedron_unfolding(
        DODECAHEDRON_NUM_FACES, DODECAHEDRON_NUM_EDGES, dodecahedron_edges);
      pf->max_angle = DODECAHEDRON_MAX_ANGLE;
      pf->num_fold_angles = DODECAHEDRON_NUM_FACES - 1;
      pf->eye_pos = dodecahedron_eye_pos;
      pf->base_polygons = init_base_polygons(pf->polygon_unfolding, &dodecahedron_pentagon);
      break;
    case ICOSAHEDRON:
      pf->polygon_unfolding = create_random_polyhedron_unfolding(
        ICOSAHEDRON_NUM_FACES, ICOSAHEDRON_NUM_EDGES, icosahedron_edges);
      pf->max_angle = ICOSAHEDRON_MAX_ANGLE;
      pf->num_fold_angles = ICOSAHEDRON_NUM_FACES - 1;
      pf->eye_pos = icosahedron_eye_pos;
      pf->base_polygons = init_base_polygons(pf->polygon_unfolding, &icosahedron_triangle);
      break;
    default:
      abort();
  }
  determine_unfolding_poses(pf->polygon_unfolding, pf->base_polygons);
  determine_polygon_color_data(pf->polygon_unfolding, pf->base_polygons,
                               pf->max_angle, pf->color_matrix);
  *initial_delta = (float)frand(360.0);
}

static void
set_profile_frame(platonicfoldingstruct *pf, int sequence_index,
                  int local_frame, float initial_delta)
{
  float raw_angle = pf->max_angle;
  float travel = pf->eye_pos[2] * (2.0f / 3.0f);
  float t = 0;
  pf->poly_pos[0] = 0;
  pf->poly_pos[1] = 0;
  pf->poly_pos[2] = 0;
  if (local_frame <= 180) {
    t = ease((float)local_frame / 180.0f, 1.0f, EASING_DECEL);
    pf->poly_pos[1] = -travel + travel * t;
  } else if (local_frame <= 270) {
    raw_angle = pf->max_angle * (1.0f - (float)(local_frame - 180) / 90.0f);
  } else if (local_frame <= 360) {
    raw_angle = pf->max_angle * ((float)(local_frame - 270) / 90.0f);
  } else {
    t = ease((float)(local_frame - 361) / 180.0f, 1.0f, EASING_ACCEL);
    pf->poly_pos[1] = travel * t;
  }
  for (int index = 0; index < pf->num_fold_angles; index++) {
    pf->angle[index] = raw_angle;
  }
  pf->alpha = sequence_index % 2 == 0 ? 300.0f : 120.0f;
  pf->beta = 0;
  pf->delta = initial_delta + local_frame * (sequence_index % 2 == 0 ? 0.5f : -0.5f);
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
  if (CGLChoosePixelFormat(attributes, &capture_pixel_format, &count) != kCGLNoError) abort();
  if (CGLCreateContext(capture_pixel_format, NULL, &capture_context) != kCGLNoError) abort();
  if (CGLSetCurrentContext(capture_context) != kCGLNoError) abort();
  capture_glx_context = capture_context;
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
parse_nonnegative(const char *text, const char *label)
{
  char *end = NULL;
  long value;
  errno = 0;
  value = strtol(text, &end, 10);
  if (errno || !end || *end || value < 0 || value > INT_MAX) {
    fprintf(stderr, "%s must be a non-negative integer\n", label);
    exit(2);
  }
  return value;
}

static long
parse_positive(const char *text, const char *label)
{
  long value = parse_nonnegative(text, label);
  if (value == 0) {
    fprintf(stderr, "%s must be positive\n", label);
    exit(2);
  }
  return value;
}

GLXContext *init_GL(ModeInfo *mi) { (void)mi; return &capture_glx_context; }
Bool glXMakeCurrent(Display *display, Window window, GLXContext context) {
  (void)display;
  (void)window;
  (void)context;
  return True;
}
void glXSwapBuffers(Display *display, Window window) { (void)display; (void)window; }
void do_fps(ModeInfo *mi) { (void)mi; }
Bool screenhack_event_helper(Display *display, Window window, XEvent *event) {
  (void)display;
  (void)window;
  (void)event;
  return False;
}
double current_device_rotation(void) { return 0; }

const unsigned char earth_png[] = { 0 };
int earth_png_size = 1;
const unsigned char earth_night_png[] = { 0 };
int earth_night_png_size = 1;
const unsigned char earth_water_png[] = { 0 };
int earth_water_png_size = 1;

XImage *image_data_to_ximage(Display *display, Visual *visual,
                             const unsigned char *image_data,
                             unsigned long data_size) {
  (void)display;
  (void)visual;
  (void)image_data;
  (void)data_size;
  abort();
}

int XDestroyImage(XImage *image) { (void)image; return 0; }
