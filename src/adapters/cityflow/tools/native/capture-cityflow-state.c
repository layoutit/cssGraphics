/* SPDX-License-Identifier: HPND */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "yarandom.h"

#undef ya_rand_init

#define MAXPOINTS 50
#define PALETTE_SIZE 256
#define WAVE_COUNT 6
#define WAVE_RADIUS 256
#define TEXTURE_SIZE 512
#define WAVE_STEP 0.025
#define PI 3.14159265358979323846

typedef struct { unsigned short red, green, blue; } color;
typedef struct { double xth, yth; int x, y; } wave;
typedef struct {
  int source_index;
  float x, y, z, cth, sth, w, d;
} cube;

static void hsv_to_rgb(int h, double s, double v,
                       unsigned short *r, unsigned short *g, unsigned short *b) {
  if (s < 0) s = 0;
  if (v < 0) v = 0;
  if (s > 1) s = 1;
  if (v > 1) v = 1;
  double H = (h % 360) / 60.0;
  int i = H;
  double f = H - i;
  double p1 = v * (1 - s);
  double p2 = v * (1 - s * f);
  double p3 = v * (1 - s * (1 - f));
  double R, G, B;
  if (i == 0) { R = v; G = p3; B = p1; }
  else if (i == 1) { R = p2; G = v; B = p1; }
  else if (i == 2) { R = p1; G = v; B = p3; }
  else if (i == 3) { R = p1; G = p2; B = v; }
  else if (i == 4) { R = p3; G = p1; B = v; }
  else { R = v; G = p1; B = p2; }
  *r = R * 65535;
  *g = G * 65535;
  *b = B * 65535;
}

static void make_color_ramp(int h1, double s1, double v1,
                            int h2, double s2, double v2,
                            color *colors, int color_count) {
  int ncolors = color_count / 2 + 1;
  double dh = (h2 - h1) / (double)ncolors;
  double ds = (s2 - s1) / ncolors;
  double dv = (v2 - v1) / ncolors;
  for (int i = 0; i < ncolors; i++)
    hsv_to_rgb((int)(h1 + i * dh), s1 + i * ds, v1 + i * dv,
               &colors[i].red, &colors[i].green, &colors[i].blue);
  for (int i = ncolors; i < color_count; i++) colors[i] = colors[color_count - i];
}

static void make_color_path(int npoints, int *h, double *s, double *v,
                            color *colors, int color_count) {
  if (npoints == 2) {
    make_color_ramp(h[0], s[0], v[0], h[1], s[1], v[1], colors, color_count);
    return;
  }
  int ncolors[MAXPOINTS] = {0};
  double dh[MAXPOINTS] = {0}, ds[MAXPOINTS] = {0}, dv[MAXPOINTS] = {0};
  double hue_distance[MAXPOINTS] = {0}, edge[MAXPOINTS] = {0};
  double circumference = 0;
  for (int i = 0; i < npoints; i++) {
    int j = (i + 1) % npoints;
    double distance = fabs((h[i] - h[j]) / 360.0);
    if (distance > 0.5) distance = 0.5 - (distance - 0.5);
    hue_distance[i] = distance;
  }
  for (int i = 0; i < npoints; i++) {
    int j = (i + 1) % npoints;
    edge[i] = sqrt(hue_distance[i] * hue_distance[j] +
                   (s[j] - s[i]) * (s[j] - s[i]) +
                   (v[j] - v[i]) * (v[j] - v[i]));
    circumference += edge[i];
  }
  for (int i = 0; i < npoints; i++) {
    int j = (i + 1) % npoints;
    ncolors[i] = color_count * edge[i] / circumference;
    if (ncolors[i] > 0) {
      dh[i] = 360 * hue_distance[i] / ncolors[i];
      ds[i] = (s[j] - s[i]) / ncolors[i];
      dv[i] = (v[j] - v[i]) / ncolors[i];
    }
  }
  int output = 0;
  for (int i = 0; i < npoints; i++) {
    int distance = h[(i + 1) % npoints] - h[i];
    int direction = distance >= 0 ? -1 : 1;
    if (distance <= 180 && distance >= -180) direction = -direction;
    for (int j = 0; j < ncolors[i]; j++, output++) {
      double hue = h[i] + j * dh[i] * direction;
      if (hue < 0) hue += 360;
      else if (hue > 360) hue -= 0;
      hsv_to_rgb((int)hue, s[i] + j * ds[i], v[i] + j * dv[i],
                 &colors[output].red, &colors[output].green, &colors[output].blue);
    }
  }
  while (output < color_count) {
    colors[output] = colors[output - 1];
    output++;
  }
}

static void make_smooth_colormap(color *colors) {
  int selector = random() % 20;
  int npoints = selector <= 5 ? 2 : selector <= 15 ? 3 : selector <= 18 ? 4 : 5;
  int h[MAXPOINTS];
  double s[MAXPOINTS], v[MAXPOINTS];
  double total_s = 0, total_v = 0;
  int loop = 0;
repick_all:
  for (int i = 0; i < npoints; i++) {
repick_one:
    if (++loop > 10000) abort();
    h[i] = random() % 360;
    s[i] = frand(1.0);
    v[i] = frand(0.8) + 0.2;
    if (i > 0) {
      int j = i + 1 == npoints ? 0 : i - 1;
      double dh = fabs(h[j] / 360.0 - h[i] / 360.0);
      if (dh > 0.5) dh = 0.5 - (dh - 0.5);
      double distance = sqrt(dh * dh + (s[j] - s[i]) * (s[j] - s[i]) +
                             (v[j] - v[i]) * (v[j] - v[i]));
      if (distance < 0.2) goto repick_one;
    }
    total_s += s[i];
    total_v += v[i];
  }
  if (total_s / npoints < 0.2 || total_v / npoints < 0.3) goto repick_all;
  make_color_path(npoints, h, s, v, colors, PALETTE_SIZE);
}

static int compare_cubes(const void *left, const void *right) {
  const cube *a = left, *b = right;
  return (int)(b->y * 10000) - (int)(a->y * 10000);
}

int main(int argc, char **argv) {
  unsigned int seed = argc > 1 ? (unsigned int)strtoul(argv[1], 0, 10) : 26081702;
  int count = argc > 2 ? atoi(argv[2]) : 800;
  int tick = argc > 3 ? atoi(argv[3]) : 0;
  ya_rand_init(seed);
  color palette[PALETTE_SIZE] = {0};
  make_smooth_colormap(palette);
  wave waves[WAVE_COUNT] = {0};
  for (int i = 0; i < WAVE_COUNT; i++) {
    waves[i].xth = frand(2.0) * PI;
    waves[i].yth = frand(2.0) * PI;
  }
  cube *cubes = calloc((size_t)count, sizeof(*cubes));
  float minimum_x = 0, maximum_x = 0, minimum_y = 0, maximum_y = 0;
  float scale = 1.8 / sqrt(count);
  for (int i = 0; i < count; i++) {
    double theta = -frand(12) * PI / 180;
    cube *item = &cubes[i];
    item->source_index = i;
    item->x = frand(1) - 0.5;
    item->y = frand(1) - 0.5;
    item->z = frand(0.12);
    item->cth = cos(theta);
    item->sth = sin(theta);
    item->w = scale * (frand(1) + 0.2);
    item->d = scale * (frand(1) + 0.2);
    if (item->x < minimum_x) minimum_x = item->x;
    if (item->x > maximum_x) maximum_x = item->x;
    if (item->y < minimum_y) minimum_y = item->y;
    if (item->y > maximum_y) maximum_y = item->y;
  }
  qsort(cubes, (size_t)count, sizeof(*cubes), compare_cubes);
  int heights[WAVE_RADIUS];
  for (int i = 0; i < WAVE_RADIUS; i++) {
    float maximum = PALETTE_SIZE * (WAVE_RADIUS - i) / (float)WAVE_RADIUS;
    heights[i] = (maximum + maximum * cos(i / 50.0)) / 2.0;
  }
  for (int step = 0; step <= tick; step++) {
    for (int i = 0; i < WAVE_COUNT; i++) {
      waves[i].xth += WAVE_STEP;
      if (waves[i].xth > 2 * PI) waves[i].xth -= 2 * PI;
      waves[i].yth += WAVE_STEP;
      if (waves[i].yth > 2 * PI) waves[i].yth -= 2 * PI;
      waves[i].x = TEXTURE_SIZE / 2 + cos(waves[i].xth) * TEXTURE_SIZE / 2;
      waves[i].y = TEXTURE_SIZE / 2 + cos(waves[i].yth) * TEXTURE_SIZE / 2;
    }
  }
  printf("{\"seed\":%u,\"count\":%d,\"tick\":%d,", seed, count, tick);
  printf("\"palette\":[");
  int palette_indices[] = {0, 1, 64, 128, 192, 255};
  for (int i = 0; i < 6; i++) {
    color c = palette[palette_indices[i]];
    printf("%s[%u,%u,%u]", i ? "," : "", c.red, c.green, c.blue);
  }
  printf("],\"waves\":[");
  for (int i = 0; i < WAVE_COUNT; i++)
    printf("%s[%.17g,%.17g,%d,%d]", i ? "," : "", waves[i].xth, waves[i].yth, waves[i].x, waves[i].y);
  printf("],\"boxes\":[");
  int sample_count = count < 8 ? count : 8;
  for (int i = 0; i < sample_count; i++) {
    cube *item = &cubes[i];
    float fx = (item->x - minimum_x) / (maximum_x - minimum_x);
    float fy = (item->y - minimum_y) / (maximum_y - minimum_y);
    int sample_x = (int)(TEXTURE_SIZE * fx) % TEXTURE_SIZE;
    int sample_y = (int)(TEXTURE_SIZE * fy) % TEXTURE_SIZE;
    int value = 0;
    for (int j = 0; j < WAVE_COUNT; j++) {
      int dx = sample_x - waves[j].x, dy = sample_y - waves[j].y;
      int distance = sqrt(dx * dx + dy * dy);
      value += distance >= WAVE_RADIUS ? 0 : heights[distance];
    }
    value *= 0.4;
    if (value > 255) value = 255;
    float height = item->z + value / 256.0 / 2.5 + 0.1;
    int color_index = ((int)(height * PALETTE_SIZE * 0.7)) % PALETTE_SIZE;
    printf("%s[%d,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%d,%d,%.9g,%d]",
           i ? "," : "", item->source_index, item->x, item->y, item->z,
           item->cth, item->sth, item->w, item->d, sample_x, sample_y, height, color_index);
  }
  printf("]}\n");
  free(cubes);
  return 0;
}
