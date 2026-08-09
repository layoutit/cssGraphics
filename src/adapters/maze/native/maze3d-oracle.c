/*
 * Headless visual oracle for cssMaze's shared XScreenSaver Maze3D first slice.
 *
 * This translation unit reuses the exact seeded generation and camera state
 * extraction in maze3d-state.c, then renders the pinned source's projection,
 * wall, floor, and ceiling draw calls through a hidden native OpenGL context.
 * It deliberately excludes source features that the browser first slice also
 * excludes: panes, rats, inverters, overlay, acid modes, and floating images.
 */

#define GL_SILENCE_DEPRECATION
#include <GLFW/glfw3.h>
#include <OpenGL/glu.h>
#include <png.h>

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define main cssmaze_state_dump_main
#include "maze3d-state.c"
#undef main

#define ORACLE_WIDTH 960
#define ORACLE_HEIGHT 540

typedef struct {
  GLuint wall;
  GLuint floor;
  GLuint ceiling;
} Textures;

static void fail(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(2);
}

static long parse_positive(const char *value, const char *label) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno || !end || *end != '\0' || parsed < 0 || parsed > INT_MAX) {
    fprintf(stderr, "%s must be a non-negative integer\n", label);
    exit(2);
  }
  return parsed;
}

static GLuint load_png_texture(const char *path) {
  png_image image;
  memset(&image, 0, sizeof(image));
  image.version = PNG_IMAGE_VERSION;
  if (!png_image_begin_read_from_file(&image, path)) {
    fprintf(stderr, "unable to read texture %s: %s\n", path, image.message);
    exit(2);
  }
  image.format = PNG_FORMAT_RGBA;
  png_bytep pixels = malloc(PNG_IMAGE_SIZE(image));
  if (!pixels) fail("unable to allocate texture pixels");
  if (!png_image_finish_read(&image, NULL, pixels, 0, NULL)) {
    fprintf(stderr, "unable to decode texture %s: %s\n", path, image.message);
    free(pixels);
    exit(2);
  }

  GLuint texture = 0;
  glGenTextures(1, &texture);
  glBindTexture(GL_TEXTURE_2D, texture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)image.width,
               (GLsizei)image.height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
  free(pixels);
  png_image_free(&image);
  return texture;
}

static void draw_wall_segment(float x0, float z0, float x1, float z1,
                              float wall_height) {
  glBegin(GL_QUADS);
  glTexCoord2f(0, 0); glVertex3f(x0, 0, z0);
  glTexCoord2f(1, 0); glVertex3f(x1, 0, z1);
  glTexCoord2f(1, 1); glVertex3f(x1, wall_height, z1);
  glTexCoord2f(0, 1); glVertex3f(x0, wall_height, z0);
  glEnd();
}

static void draw_walls(const Maze *maze, GLuint texture) {
  glBindTexture(GL_TEXTURE_2D, texture);
  for (unsigned row = 0; row < ROWS; row++) {
    for (unsigned column = 0; column < COLUMNS; column++) {
      if (maze->grid[row][column] != WALL) continue;
      if (is_odd(row) && is_even(column)) {
        float x = column / 2.0f;
        float z = (float)(row / 2);
        draw_wall_segment(x, z, x, z + 1, maze->wall_height);
      } else if (is_even(row) && is_odd(column)) {
        float x = (float)(column / 2);
        float z = row / 2.0f;
        draw_wall_segment(x, z, x + 1, z, maze->wall_height);
      }
    }
  }
}

static void draw_horizontal(GLuint texture, float y) {
  glBindTexture(GL_TEXTURE_2D, texture);
  glBegin(GL_QUADS);
  glTexCoord2f(0, 0); glVertex3f(0, y, 0);
  glTexCoord2f(LOGICAL_COLUMNS, 0); glVertex3f(LOGICAL_COLUMNS, y, 0);
  glTexCoord2f(LOGICAL_COLUMNS, LOGICAL_ROWS);
  glVertex3f(LOGICAL_COLUMNS, y, LOGICAL_ROWS);
  glTexCoord2f(0, LOGICAL_ROWS); glVertex3f(0, y, LOGICAL_ROWS);
  glEnd();
}

static void render_frame(const Maze *maze, const Textures *textures) {
  glViewport(0, 0, ORACLE_WIDTH, ORACLE_HEIGHT);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  gluPerspective(90, (double)ORACLE_WIDTH / ORACLE_HEIGHT, 0.05, 100);
  glRotatef(maze->camera.rotation, 0, 1, 0);
  glTranslatef(-maze->camera.position.x, -0.5f, -maze->camera.position.z);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glColor3f(1, 1, 1);
  draw_walls(maze, textures->wall);
  draw_horizontal(textures->ceiling, 1);
  draw_horizontal(textures->floor, 0);
  glFinish();
}

static void write_ppm(const char *path) {
  size_t stride = ORACLE_WIDTH * 3;
  size_t size = stride * ORACLE_HEIGHT;
  unsigned char *pixels = malloc(size);
  if (!pixels) fail("unable to allocate frame pixels");
  glReadPixels(0, 0, ORACLE_WIDTH, ORACLE_HEIGHT, GL_RGB,
               GL_UNSIGNED_BYTE, pixels);
  FILE *file = fopen(path, "wb");
  if (!file) {
    fprintf(stderr, "unable to open frame output %s\n", path);
    free(pixels);
    exit(2);
  }
  fprintf(file, "P6\n%d %d\n255\n", ORACLE_WIDTH, ORACLE_HEIGHT);
  for (int row = ORACLE_HEIGHT - 1; row >= 0; row--) {
    if (fwrite(pixels + row * stride, 1, stride, file) != stride) {
      fclose(file);
      free(pixels);
      fail("unable to write frame pixels");
    }
  }
  fclose(file);
  free(pixels);
}

int main(int argc, char **argv) {
  if (argc != 8) {
    fprintf(stderr, "usage: %s SEED START COUNT OUTPUT_DIR WALL FLOOR CEILING\n", argv[0]);
    return 2;
  }
  long seed = parse_positive(argv[1], "seed");
  long start = parse_positive(argv[2], "start");
  long count = parse_positive(argv[3], "count");
  if (seed < 1 || count < 1 || start + count > MAX_FRAMES) fail("invalid capture range");

  if (!glfwInit()) fail("unable to initialize GLFW");
  glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
  glfwWindowHint(GLFW_DOUBLEBUFFER, GLFW_FALSE);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
  GLFWwindow *window = glfwCreateWindow(ORACLE_WIDTH, ORACLE_HEIGHT,
                                        "cssMaze native oracle", NULL, NULL);
  if (!window) {
    glfwTerminate();
    fail("unable to create hidden native OpenGL context");
  }
  glfwMakeContextCurrent(window);
  glEnable(GL_DEPTH_TEST);
  glEnable(GL_TEXTURE_2D);
  glDisable(GL_CULL_FACE);
  glShadeModel(GL_FLAT);
  glClearColor(0, 0, 0, 1);

  Textures textures = {
    .wall = load_png_texture(argv[5]),
    .floor = load_png_texture(argv[6]),
    .ceiling = load_png_texture(argv[7]),
  };
  Maze maze = {0};
  srandom((unsigned)seed);
  initialize_grid(&maze);
  build_maze(&maze);
  place_start_and_finish(&maze);
  maze.camera.state = STARTING;
  maze.wall_height = 0;

  long written = 0;
  for (long tick = 0; tick < start + count; tick++) {
    if (tick >= start) {
      char path[PATH_MAX];
      snprintf(path, sizeof(path), "%s/frame_%04ld.ppm", argv[4], written);
      render_frame(&maze, &textures);
      write_ppm(path);
      written++;
    }
    maze.camera.remaining_distance = SOURCE_SPEED * 1.6f *
      (FRAME_DELAY_MICROSECONDS / 1000000.0f);
    step_camera(&maze);
  }

  glDeleteTextures(1, &textures.wall);
  glDeleteTextures(1, &textures.floor);
  glDeleteTextures(1, &textures.ceiling);
  glfwDestroyWindow(window);
  glfwTerminate();
  printf("{\"seed\":%ld,\"startTick\":%ld,\"frameCount\":%ld,"
         "\"width\":%d,\"height\":%d}\n",
         seed, start, written, ORACLE_WIDTH, ORACLE_HEIGHT);
  return 0;
}
