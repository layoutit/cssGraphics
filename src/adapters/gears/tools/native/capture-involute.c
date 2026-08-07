#include "screenhackI.h"
#include "involute.h"

#define MATRIX_STACK_LIMIT 32

typedef struct {
  double position[3];
  double normal[3];
} captured_vertex;

typedef struct {
  int vertex_count;
  captured_vertex vertices[4];
  GLfloat color[4];
} captured_polygon;

const char *progname = "cssgears-capture-involute";

static captured_vertex *primitive_vertices;
static size_t primitive_count;
static size_t primitive_capacity;
static captured_polygon *polygons;
static size_t polygon_count;
static size_t polygon_capacity;
static GLenum primitive_mode;
static GLenum front_face = GL_CCW;
static GLfloat material_color[4] = {1, 1, 1, 1};
static double current_normal[3] = {0, 0, 1};
static double matrix_stack[MATRIX_STACK_LIMIT][16];
static int matrix_depth;

static void identity(double *matrix);
static void multiply(double *left, const double *right);
static void emit_polygon(const int *indices, int count);
static void reserve_primitive(void);
static void reserve_polygon(void);
static double parsed_double(const char *text, const char *label);
static long parsed_long(const char *text, const char *label);
static void print_number(double value);

int
main(int argc, char **argv)
{
  gear g;
  int source_polygons;
  int arg = 1;

  if (argc != 28) {
    fprintf(stderr,
            "usage: %s id teeth radius tooth_w tooth_h slope inner_r inner_r2 inner_r3 "
            "thickness thickness2 thickness3 spokes nubs spoke_thickness wobble inverted base size "
            "r g b a r2 g2 b2 a2\n",
            argv[0]);
    return 2;
  }

  memset(&g, 0, sizeof(g));
  g.id = (unsigned long) parsed_long(argv[arg++], "id");
  g.nteeth = (GLint) parsed_long(argv[arg++], "teeth");
  g.r = parsed_double(argv[arg++], "radius");
  g.tooth_w = parsed_double(argv[arg++], "tooth_w");
  g.tooth_h = parsed_double(argv[arg++], "tooth_h");
  g.tooth_slope = parsed_double(argv[arg++], "slope");
  g.inner_r = parsed_double(argv[arg++], "inner_r");
  g.inner_r2 = parsed_double(argv[arg++], "inner_r2");
  g.inner_r3 = parsed_double(argv[arg++], "inner_r3");
  g.thickness = parsed_double(argv[arg++], "thickness");
  g.thickness2 = parsed_double(argv[arg++], "thickness2");
  g.thickness3 = parsed_double(argv[arg++], "thickness3");
  g.spokes = (int) parsed_long(argv[arg++], "spokes");
  g.nubs = (int) parsed_long(argv[arg++], "nubs");
  g.spoke_thickness = parsed_double(argv[arg++], "spoke_thickness");
  g.wobble = parsed_double(argv[arg++], "wobble");
  g.inverted_p = (Bool) parsed_long(argv[arg++], "inverted");
  g.base_p = (Bool) parsed_long(argv[arg++], "base");
  g.size = (int) parsed_long(argv[arg++], "size");
  for (int i = 0; i < 4; i++) g.color[i] = (GLfloat) parsed_double(argv[arg++], "color");
  for (int i = 0; i < 4; i++) g.color2[i] = (GLfloat) parsed_double(argv[arg++], "color2");

  identity(matrix_stack[0]);
  source_polygons = draw_involute_gear(&g, False);
  if ((size_t) source_polygons != polygon_count) {
    fprintf(stderr, "source polygon census drifted: source=%d captured=%zu\n",
            source_polygons, polygon_count);
    return 3;
  }

  printf("{\"schema\":\"cssgears-native-geometry@1\",\"sourcePolygonCount\":%d,"
         "\"capturedPolygonCount\":%zu,\"polygons\":[", source_polygons, polygon_count);
  for (size_t i = 0; i < polygon_count; i++) {
    captured_polygon *polygon = &polygons[i];
    if (i) putchar(',');
    printf("{\"vertices\":[");
    for (int vertex = 0; vertex < polygon->vertex_count; vertex++) {
      if (vertex) putchar(',');
      putchar('[');
      for (int component = 0; component < 3; component++) {
        if (component) putchar(',');
        print_number(polygon->vertices[vertex].position[component]);
      }
      putchar(']');
    }
    printf("],\"normals\":[");
    for (int vertex = 0; vertex < polygon->vertex_count; vertex++) {
      if (vertex) putchar(',');
      putchar('[');
      for (int component = 0; component < 3; component++) {
        if (component) putchar(',');
        print_number(polygon->vertices[vertex].normal[component]);
      }
      putchar(']');
    }
    printf("],\"color\":[");
    for (int component = 0; component < 4; component++) {
      if (component) putchar(',');
      print_number(polygon->color[component]);
    }
    printf("]}");
  }
  printf("]}\n");

  free(primitive_vertices);
  free(polygons);
  return 0;
}

void
glBegin(GLenum mode)
{
  primitive_mode = mode;
  primitive_count = 0;
}

void
glEnd(void)
{
  if (primitive_mode == GL_QUADS) {
    for (size_t i = 0; i + 3 < primitive_count; i += 4) {
      const int indices[4] = {(int) i, (int) i + 1, (int) i + 2, (int) i + 3};
      emit_polygon(indices, 4);
    }
  } else if (primitive_mode == GL_QUAD_STRIP) {
    for (size_t i = 2; i + 1 < primitive_count; i += 2) {
      const int indices[4] = {(int) i - 2, (int) i - 1, (int) i + 1, (int) i};
      emit_polygon(indices, 4);
    }
  } else if (primitive_mode == GL_TRIANGLE_FAN) {
    for (size_t i = 2; i < primitive_count; i++) {
      const int indices[3] = {0, (int) i - 1, (int) i};
      emit_polygon(indices, 3);
    }
  }
  primitive_count = 0;
}

void
glFrontFace(GLenum mode)
{
  front_face = mode;
}

void
glMaterialfv(GLenum face, GLenum name, const GLfloat *values)
{
  (void) face;
  if (name == GL_AMBIENT_AND_DIFFUSE) memcpy(material_color, values, sizeof(material_color));
}

void
glNormal3f(GLfloat x, GLfloat y, GLfloat z)
{
  const double *matrix = matrix_stack[matrix_depth];
  double transformed[3] = {
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  };
  const double length = sqrt(transformed[0] * transformed[0] +
                             transformed[1] * transformed[1] +
                             transformed[2] * transformed[2]);
  if (length > 0) {
    current_normal[0] = transformed[0] / length;
    current_normal[1] = transformed[1] / length;
    current_normal[2] = transformed[2] / length;
  }
}

void
glVertex3f(GLfloat x, GLfloat y, GLfloat z)
{
  const double *matrix = matrix_stack[matrix_depth];
  captured_vertex *vertex;
  reserve_primitive();
  vertex = &primitive_vertices[primitive_count++];
  vertex->position[0] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  vertex->position[1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  vertex->position[2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  memcpy(vertex->normal, current_normal, sizeof(current_normal));
}

void
glPushMatrix(void)
{
  if (matrix_depth + 1 >= MATRIX_STACK_LIMIT) abort();
  memcpy(matrix_stack[matrix_depth + 1], matrix_stack[matrix_depth], sizeof(matrix_stack[0]));
  matrix_depth++;
}

void
glPopMatrix(void)
{
  if (matrix_depth <= 0) abort();
  matrix_depth--;
}

void
glTranslatef(GLfloat x, GLfloat y, GLfloat z)
{
  double transform[16];
  identity(transform);
  transform[12] = x;
  transform[13] = y;
  transform[14] = z;
  multiply(matrix_stack[matrix_depth], transform);
}

void
glRotatef(GLfloat angle, GLfloat x, GLfloat y, GLfloat z)
{
  double transform[16];
  const double axis_length = sqrt((double) x * x + (double) y * y + (double) z * z);
  const double radians = angle * M_PI / 180.0;
  const double cosine = cos(radians);
  const double sine = sin(radians);
  const double one_minus_cosine = 1 - cosine;
  if (axis_length == 0) return;
  x = (GLfloat) (x / axis_length);
  y = (GLfloat) (y / axis_length);
  z = (GLfloat) (z / axis_length);
  identity(transform);
  transform[0] = x * x * one_minus_cosine + cosine;
  transform[4] = x * y * one_minus_cosine - z * sine;
  transform[8] = x * z * one_minus_cosine + y * sine;
  transform[1] = y * x * one_minus_cosine + z * sine;
  transform[5] = y * y * one_minus_cosine + cosine;
  transform[9] = y * z * one_minus_cosine - x * sine;
  transform[2] = z * x * one_minus_cosine - y * sine;
  transform[6] = z * y * one_minus_cosine + x * sine;
  transform[10] = z * z * one_minus_cosine + cosine;
  multiply(matrix_stack[matrix_depth], transform);
}

void glColor3f(GLfloat red, GLfloat green, GLfloat blue) { (void) red; (void) green; (void) blue; }
void glDisable(GLenum capability) { (void) capability; }
void glEnable(GLenum capability) { (void) capability; }
void glMateriali(GLenum face, GLenum name, GLint value) { (void) face; (void) name; (void) value; }

static void
emit_polygon(const int *indices, int count)
{
  captured_polygon *polygon;
  reserve_polygon();
  polygon = &polygons[polygon_count++];
  polygon->vertex_count = count;
  memcpy(polygon->color, material_color, sizeof(material_color));
  for (int i = 0; i < count; i++) {
    const int source_index = front_face == GL_CW ? indices[count - i - 1] : indices[i];
    polygon->vertices[i] = primitive_vertices[source_index];
  }
}

static void
reserve_primitive(void)
{
  if (primitive_count < primitive_capacity) return;
  primitive_capacity = primitive_capacity ? primitive_capacity * 2 : 128;
  primitive_vertices = realloc(primitive_vertices, primitive_capacity * sizeof(*primitive_vertices));
  if (!primitive_vertices) abort();
}

static void
reserve_polygon(void)
{
  if (polygon_count < polygon_capacity) return;
  polygon_capacity = polygon_capacity ? polygon_capacity * 2 : 512;
  polygons = realloc(polygons, polygon_capacity * sizeof(*polygons));
  if (!polygons) abort();
}

static void
identity(double *matrix)
{
  memset(matrix, 0, 16 * sizeof(*matrix));
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
}

static void
multiply(double *left, const double *right)
{
  double result[16];
  for (int column = 0; column < 4; column++) {
    for (int row = 0; row < 4; row++) {
      result[column * 4 + row] =
        left[0 * 4 + row] * right[column * 4 + 0] +
        left[1 * 4 + row] * right[column * 4 + 1] +
        left[2 * 4 + row] * right[column * 4 + 2] +
        left[3 * 4 + row] * right[column * 4 + 3];
    }
  }
  memcpy(left, result, sizeof(result));
}

static double
parsed_double(const char *text, const char *label)
{
  char *end = NULL;
  const double value = strtod(text, &end);
  if (!end || *end) {
    fprintf(stderr, "invalid %s: %s\n", label, text);
    exit(2);
  }
  return value;
}

static long
parsed_long(const char *text, const char *label)
{
  char *end = NULL;
  const long value = strtol(text, &end, 10);
  if (!end || *end) {
    fprintf(stderr, "invalid %s: %s\n", label, text);
    exit(2);
  }
  return value;
}

static void
print_number(double value)
{
  if (fabs(value) < 1e-12) value = 0;
  printf("%.9g", value);
}
