/* SPDX-License-Identifier: HPND */
#define main capture_cityflow_color_main
#include "capture-cityflow.c"
#undef main

static void draw_visibility_ids(ModeInfo *mi, unsigned char *visible, Bool advance);
static void emit_face(cube *box, int face, unsigned int encoded_id);

int
main(int argc, char **argv)
{
  ModeInfo mi;
  unsigned int seed;
  int width;
  int height;
  int frame_count;
  size_t row_bytes;
  unsigned char *visible;
  FILE *stream;
  FILE *height_stream = NULL;
  double *heights = NULL;

  if (argc != 7 && argc != 8) {
    fprintf(stderr, "usage: %s output.bin seed count width height frames [float64-heights.bin]\n", argv[0]);
    return 2;
  }
  seed = (unsigned int)parse_positive(argv[2], "seed");
  width = (int)parse_positive(argv[4], "width");
  height = (int)parse_positive(argv[5], "height");
  frame_count = (int)parse_positive(argv[6], "frames");
  memset(&mi, 0, sizeof(mi));
  mi.width = width;
  mi.height = height;
  mi.count = (int)parse_positive(argv[3], "count");
  row_bytes = ((size_t)mi.count * 3 + 7) / 8;
  visible = calloc(row_bytes, 1);
  if (!visible) abort();
  stream = fopen(argv[1], "wb");
  if (!stream) {
    perror("open visibility output");
    return 3;
  }
  if (argc == 8) {
    height_stream = fopen(argv[7], "rb");
    heights = malloc((size_t)mi.count * sizeof(*heights));
    if (!height_stream || !heights) {
      perror("open visibility heights");
      return 4;
    }
  }

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
    if (height_stream) {
      if (fread(heights, sizeof(*heights), (size_t)mi.count, height_stream) != (size_t)mi.count) {
        fprintf(stderr, "visibility heights ended at frame %d\n", frame);
        return 5;
      }
      for (int box_index = 0; box_index < mi.count; box_index++) {
        ccs[MI_SCREEN(&mi)].cubes[box_index].h = (GLfloat)heights[box_index];
      }
    }
    memset(visible, 0, row_bytes);
    draw_visibility_ids(&mi, visible, !height_stream);
    if (fwrite(visible, 1, row_bytes, stream) != row_bytes) return 6;
  }

  if (height_stream && fclose(height_stream) != 0) return 7;
  if (fclose(stream) != 0) return 8;
  free(heights);
  free(visible);
  free_cube(&mi);
  free(ccs);
  ccs = NULL;
  destroy_offscreen_context();
  return 0;
}

static void
draw_visibility_ids(ModeInfo *mi, unsigned char *visible, Bool advance)
{
  cube_configuration *cc = &ccs[MI_SCREEN(mi)];
  int width = MI_WIDTH(mi);
  int height = MI_HEIGHT(mi);
  size_t pixel_count = (size_t)width * (size_t)height;
  unsigned char *rgba = malloc(pixel_count * 4);
  if (!rgba) abort();

  if (advance) {
    interference(mi);
    animate_cubes(mi);
  }
  glDisable(GL_LIGHTING);
  glDisable(GL_DITHER);
  glEnable(GL_DEPTH_TEST);
  glEnable(GL_CULL_FACE);
  glShadeModel(GL_FLAT);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glPushMatrix();
  glRotatef(current_device_rotation(), 0, 0, 1);
  gltrackball_rotate(cc->trackball);
  glRotatef(-180, 1, 0, 0);
  glScalef(15, 15, 15);
  glRotatef(-90, 1, 0, 0);
  glTranslatef(-0.18, 0, -0.18);
  glRotatef(37, 1, 0, 0);
  glRotatef(20, 0, 0, 1);
  glScalef(2.1, 2.1, 2.1);
  glBegin(GL_QUADS);
  for (int box_index = 0; box_index < cc->ncubes; box_index++) {
    for (int face = 0; face < 3; face++) {
      emit_face(&cc->cubes[box_index], face, (unsigned int)(box_index * 3 + face + 1));
    }
  }
  glEnd();
  glPopMatrix();
  glFinish();
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  if (glGetError() != GL_NO_ERROR) abort();
  for (size_t pixel = 0; pixel < pixel_count; pixel++) {
    unsigned int encoded_id = (unsigned int)rgba[pixel * 4] |
      ((unsigned int)rgba[pixel * 4 + 1] << 8);
    if (encoded_id == 0 || encoded_id > (unsigned int)cc->ncubes * 3) continue;
    unsigned int face_index = encoded_id - 1;
    visible[face_index >> 3] |= 1 << (face_index & 7);
  }
  free(rgba);
}

static void
emit_face(cube *box, int face, unsigned int encoded_id)
{
  GLfloat cth = box->cth;
  GLfloat sth = box->sth;
  GLfloat x = cth * box->x + sth * box->y;
  GLfloat y = -sth * box->x + cth * box->y;
  GLfloat w = box->w / 2;
  GLfloat h = box->h / 2;
  GLfloat d = box->d / 2;
  GLfloat bottom = 5;
  GLfloat xw = cth * w, xd = sth * d;
  GLfloat yw = -sth * w, yd = cth * d;
  glColor3ub(encoded_id & 255, (encoded_id >> 8) & 255, 0);
  if (face == 0) {
    glVertex3f(x+xw+xd, y+yw+yd, -h);
    glVertex3f(x+xw-xd, y+yw-yd, -h);
    glVertex3f(x-xw-xd, y-yw-yd, -h);
    glVertex3f(x-xw+xd, y-yw+yd, -h);
  } else if (face == 1) {
    glVertex3f(x+xw+xd, y+yw+yd, bottom);
    glVertex3f(x+xw+xd, y+yw+yd, -h);
    glVertex3f(x-xw+xd, y-yw+yd, -h);
    glVertex3f(x-xw+xd, y-yw+yd, bottom);
  } else {
    glVertex3f(x+xw-xd, y+yw-yd, -h);
    glVertex3f(x+xw+xd, y+yw+yd, -h);
    glVertex3f(x+xw+xd, y+yw+yd, bottom);
    glVertex3f(x+xw-xd, y+yw-yd, bottom);
  }
}
