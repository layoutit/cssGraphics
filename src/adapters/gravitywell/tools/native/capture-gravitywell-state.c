#include <math.h>
#include <stdint.h>
#include <stdio.h>

#include "yarandom.h"
#undef ya_rand_init

#define COUNT 15
#define ACTIVE_COUNT 2
#define GRID_WIDTH 32
#define GRID_SEGMENT 16
#define RESOLUTION 1.0f
#define SPEED 1.0f
#define SPEED_BASE 2.5f
#define MASS_EPSILON 0.03f
#define SLOPE_EPSILON 0.06f

typedef struct {
  float mass;
  float ro2, rm2, ri2;
  float ro, radius;
  float x, y, dx, dy;
  float surface_gravity;
} star;

static double f_random(double limit) {
  return (((double) ya_random()) * limit) / ((double) UINT32_MAX);
}

static void new_star(star *stars, int index) {
  star *value = &stars[index];
  const int width = GRID_WIDTH * GRID_SEGMENT;
  value->radius = 2 * (2 + f_random(3) + f_random(3) + f_random(3));
  value->mass = value->radius * 150 * (2 + f_random(3) + f_random(3) + f_random(3));
  value->ro2 = value->mass / MASS_EPSILON;
  value->ro = sqrtf(value->ro2);
  value->rm2 = pow(value->mass * (2.0f / SLOPE_EPSILON), 2.0f / 3.0f);
  value->ri2 = value->radius * value->radius;
  if (value->rm2 < value->ri2) value->rm2 = value->ri2;
  if (value->ro2 < value->rm2) value->ro2 = value->rm2;
  value->x = width * (index == 0 ? 0.5 : (0.35 + f_random(0.3)));
  value->dx = ((f_random(1.0) - 0.5) * 0.1) / RESOLUTION;
  value->dy = (0.1 + f_random(0.6)) / RESOLUTION;
  value->surface_gravity = value->mass / value->ri2;
}

static void isolate_prepared_well(star *value, int index) {
  const int width = GRID_WIDTH * GRID_SEGMENT;
  const float normalized_source_speed = (value->dy * RESOLUTION - 0.1f) / 0.6f;
  const float prepared_frame_speed = 1.0f + normalized_source_speed * 0.6f;
  value->x = width * (index == 0 ? 0.32f : 0.68f);
  value->dx = (index == 0 ? -1.0f : 1.0f) * fabsf(value->dx);
  value->dy = prepared_frame_speed / (SPEED * SPEED_BASE * RESOLUTION);
}

static void move_stars(star *stars) {
  const int width = GRID_WIDTH * GRID_SEGMENT;
  const int height = width;
  for (int index = 0; index < ACTIVE_COUNT; index++) {
    star *value = &stars[index];
    const float offset = SPEED * SPEED_BASE * RESOLUTION;
    value->x += value->dx * offset;
    value->y += value->dy * offset;
    if (value->x < -value->ro || value->y < -value->ro ||
        value->x >= width + value->ro || value->y >= height + value->ro) {
      new_star(stars, index);
      isolate_prepared_well(value, index);
      value->y = -value->ro;
    }
  }
}

static float gravity_at(const star *stars, float x, float y) {
  float total = 0;
  for (int index = 0; index < ACTIVE_COUNT; index++) {
    const star *value = &stars[index];
    const float dx = value->x - x;
    const float dy = value->y - y;
    const float distance_squared = dx * dx + dy * dy;
    if (distance_squared > value->ro2) continue;
    total += distance_squared < value->ri2
      ? value->surface_gravity
      : value->mass / distance_squared;
  }
  return total;
}

static int selected_frame(int frame) {
  return frame == 0 || frame == 1 || frame == 60 || frame == 120 || frame == 239;
}

int main(void) {
  star stars[COUNT] = {0};
  const int samples[][2] = {{0, 0}, {15, 15}, {20, 10}, {31, 31}};
  ya_rand_init(26080802U);
  for (int index = 0; index < COUNT; index++) {
    new_star(stars, index);
    stars[index].y = f_random(stars[index].ro * 2 + GRID_WIDTH * GRID_SEGMENT) - stars[index].ro;
  }
  for (int index = 0; index < ACTIVE_COUNT; index++) {
    isolate_prepared_well(&stars[index], index);
    stars[index].y = GRID_WIDTH * GRID_SEGMENT * (index == 0 ? 0.3f : 0.65f);
  }
  f_random(0.8);
  f_random(0.2);
  for (int frame = 0; frame < 240; frame++) {
    if (selected_frame(frame)) {
      for (int sample = 0; sample < 4; sample++) {
        const int x_index = samples[sample][0];
        const int y_index = samples[sample][1];
        printf("%d,%d,%.9g\n", frame, y_index * GRID_WIDTH + x_index,
               gravity_at(stars, x_index * GRID_SEGMENT, y_index * GRID_SEGMENT));
      }
    }
    move_stars(stars);
  }
  return 0;
}
