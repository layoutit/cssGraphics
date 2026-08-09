/*
 * cssMaze source-state dumper.
 *
 * The maze generation, placement, and camera routines below are a narrow,
 * headless extraction of XScreenSaver hacks/glx/maze3d.c at
 * 906693799e4fb7581436590cf84ecb2d3c9186ba.
 *
 * Permission to use, copy, modify, and distribute this software and its
 * documentation for any purpose and without fee is hereby granted,
 * provided that the above copyright notice appear in all copies and that
 * both that copyright notice and this permission notice appear in
 * supporting documentation.
 *
 * This file is provided AS IS with no warranties of any kind. The author
 * shall have no liability with respect to the infringement of copyrights,
 * trade secrets or any patents by this file or any part thereof. In no
 * event will the author be liable for any lost revenue or profits or other
 * special, indirect and consequential damages.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#define LOGICAL_ROWS 12
#define LOGICAL_COLUMNS 12
#define ROWS (LOGICAL_ROWS * 2 + 1)
#define COLUMNS (LOGICAL_COLUMNS * 2 + 1)
#define FRAME_DELAY_MICROSECONDS 20000
#define SOURCE_SPEED 1.0f
#define ANGULAR_CONVERSION_FACTOR 90.0f
#define MAX_FRAMES 20000
#define WALL_CAPACITY 640

enum cell_type {
  WALL,
  CELL_UNVISITED,
  CELL,
  START,
  FINISH
};

enum program_state {
  STARTING,
  WALKING,
  TURNING_LEFT,
  TURNING_RIGHT,
  TURNING_AROUND,
  INVERTING,
  FINISHING
};

enum direction {
  NORTH = 0,
  EAST = 90,
  SOUTH = 180,
  WEST = 270
};

typedef struct {
  unsigned row;
  unsigned column;
} Tuple;

typedef struct {
  float x;
  float z;
} Tuplef;

typedef struct {
  Tuplef position;
  float rotation;
  float desired_rotation;
  float remaining_distance;
  unsigned char state;
} Camera;

typedef struct {
  unsigned char grid[ROWS][COLUMNS];
  Tuple walls[WALL_CAPACITY];
  unsigned wall_count;
  Tuple start;
  Tuple finish;
  Camera camera;
  float wall_height;
} Maze;

static unsigned is_odd(unsigned value) { return value % 2; }
static unsigned is_even(unsigned value) { return !is_odd(value); }
static float nearest_half(float value) { return roundf(2.0f * value) / 2.0f; }

static int removable_wall(const Maze *maze, Tuple point) {
  return maze->grid[point.row][point.column] == WALL &&
         point.row > 0 && point.row < ROWS - 1 &&
         point.column > 0 && point.column < COLUMNS - 1;
}

static void add_walls(Maze *maze, Tuple cell) {
  Tuple candidates[4] = {
    {cell.row - 1, cell.column},
    {cell.row + 1, cell.column},
    {cell.row, cell.column - 1},
    {cell.row, cell.column + 1}
  };
  for (unsigned index = 0; index < 4; index++) {
    if (!removable_wall(maze, candidates[index])) continue;
    if (maze->wall_count >= WALL_CAPACITY) {
      fprintf(stderr, "maze wall list overflow\n");
      exit(2);
    }
    maze->walls[maze->wall_count++] = candidates[index];
  }
}

static void add_cells(Maze *maze, Tuple cell, Tuple wall) {
  maze->grid[wall.row][wall.column] = CELL;
  maze->grid[cell.row][cell.column] = CELL;
  add_walls(maze, cell);
}

static void remove_wall(Maze *maze, unsigned index) {
  for (unsigned next = index + 1; next < maze->wall_count; next++) {
    maze->walls[next - 1] = maze->walls[next];
  }
  maze->wall_count--;
}

static void initialize_grid(Maze *maze) {
  for (unsigned row = 0; row < ROWS; row++) {
    for (unsigned column = 0; column < COLUMNS; column++) {
      maze->grid[row][column] = is_odd(row) && is_odd(column)
        ? CELL_UNVISITED
        : WALL;
    }
  }
}

static void build_maze(Maze *maze) {
  Tuple first = {1, 1};
  maze->grid[1][1] = CELL;
  add_walls(maze, first);
  while (maze->wall_count > 0) {
    unsigned index = (unsigned)(random() % maze->wall_count);
    Tuple wall = maze->walls[index];
    Tuple cell;
    if (is_even(wall.row)) {
      if (maze->grid[wall.row - 1][wall.column] == CELL &&
          maze->grid[wall.row + 1][wall.column] == CELL_UNVISITED) {
        cell.row = wall.row + 1;
        cell.column = wall.column;
        add_cells(maze, cell, wall);
      } else if (maze->grid[wall.row + 1][wall.column] == CELL &&
                 maze->grid[wall.row - 1][wall.column] == CELL_UNVISITED) {
        cell.row = wall.row - 1;
        cell.column = wall.column;
        add_cells(maze, cell, wall);
      }
    } else {
      if (maze->grid[wall.row][wall.column - 1] == CELL &&
          maze->grid[wall.row][wall.column + 1] == CELL_UNVISITED) {
        cell.row = wall.row;
        cell.column = wall.column + 1;
        add_cells(maze, cell, wall);
      } else if (maze->grid[wall.row][wall.column + 1] == CELL &&
                 maze->grid[wall.row][wall.column - 1] == CELL_UNVISITED) {
        cell.row = wall.row;
        cell.column = wall.column - 1;
        add_cells(maze, cell, wall);
      }
    }
    remove_wall(maze, index);
  }
}

static Tuple place_object(Maze *maze, unsigned char type) {
  Tuple point = {0, 0};
  while (!(maze->grid[point.row][point.column] == CELL &&
           is_odd(point.row) && is_odd(point.column))) {
    point.row = (unsigned)(random() % ROWS);
    point.column = (unsigned)(random() % COLUMNS);
  }
  maze->grid[point.row][point.column] = type;
  return point;
}

static void place_start_and_finish(Maze *maze) {
  unsigned surrounding = 3;
  while (surrounding >= 3) {
    surrounding = 0;
    maze->start = place_object(maze, CELL);
    if (maze->grid[maze->start.row][maze->start.column + 1] == WALL) surrounding++;
    if (maze->grid[maze->start.row - 1][maze->start.column] == WALL) surrounding++;
    if (maze->grid[maze->start.row][maze->start.column - 1] == WALL) surrounding++;
    if (maze->grid[maze->start.row + 1][maze->start.column] == WALL) surrounding++;
  }
  maze->grid[maze->start.row][maze->start.column] = START;

  if (maze->grid[maze->start.row][maze->start.column + 1] != WALL) {
    maze->camera.position.x = (maze->start.column + 1) / 2.0f;
    maze->camera.position.z = maze->start.row / 2.0f;
    maze->camera.rotation = WEST;
  } else if (maze->grid[maze->start.row - 1][maze->start.column] != WALL) {
    maze->camera.position.x = maze->start.column / 2.0f;
    maze->camera.position.z = (maze->start.row - 1) / 2.0f;
    maze->camera.rotation = SOUTH;
  } else if (maze->grid[maze->start.row][maze->start.column - 1] != WALL) {
    maze->camera.position.x = (maze->start.column - 1) / 2.0f;
    maze->camera.position.z = maze->start.row / 2.0f;
    maze->camera.rotation = EAST;
  } else {
    maze->camera.position.x = maze->start.column / 2.0f;
    maze->camera.position.z = (maze->start.row + 1) / 2.0f;
    maze->camera.rotation = NORTH;
  }
  maze->finish = place_object(maze, FINISH);
}

static void change_state(Camera *camera, Maze *maze) {
  unsigned char in_front;
  unsigned char left;
  unsigned char ahead;
  unsigned char right;
  unsigned x = (unsigned)roundf(camera->position.x * 2);
  unsigned z = (unsigned)roundf(camera->position.z * 2);

  switch ((int)camera->rotation) {
    case NORTH:
      in_front = maze->grid[z - 1][x];
      left = maze->grid[z - 1][x - 1];
      ahead = maze->grid[z - 2][x];
      right = maze->grid[z - 1][x + 1];
      break;
    case EAST:
      in_front = maze->grid[z][x + 1];
      left = maze->grid[z - 1][x + 1];
      ahead = maze->grid[z][x + 2];
      right = maze->grid[z + 1][x + 1];
      break;
    case SOUTH:
      in_front = maze->grid[z + 1][x];
      left = maze->grid[z + 1][x + 1];
      ahead = maze->grid[z + 2][x];
      right = maze->grid[z + 1][x - 1];
      break;
    case WEST:
      in_front = maze->grid[z][x - 1];
      left = maze->grid[z + 1][x - 1];
      ahead = maze->grid[z][x - 2];
      right = maze->grid[z - 1][x - 1];
      break;
    default:
      in_front = left = ahead = right = CELL;
      break;
  }

  if (in_front == FINISH) {
    camera->state = FINISHING;
  } else if (left != WALL) {
    camera->state = TURNING_LEFT;
  } else if (ahead != WALL) {
    camera->state = WALKING;
  } else if (right != WALL) {
    camera->state = TURNING_RIGHT;
  } else {
    camera->state = TURNING_AROUND;
    switch ((int)camera->rotation) {
      case NORTH: camera->desired_rotation = SOUTH; break;
      case EAST: camera->desired_rotation = WEST; break;
      case SOUTH: camera->desired_rotation = NORTH; break;
      case WEST: camera->desired_rotation = EAST; break;
      default: break;
    }
  }
}

static void walk_camera(Camera *camera, char axis, int sign, Maze *maze) {
  float *component = axis == 'x' ? &camera->position.x : &camera->position.z;
  float previous = *component;
  int on_half = ((*component) * 2) == roundf((*component) * 2);
  unsigned prior_bucket = (unsigned)((*component) * 2.0f);
  *component += sign * camera->remaining_distance;
  if (!on_half && (unsigned)((*component) * 2.0f) != prior_bucket) {
    *component = nearest_half(*component);
    camera->remaining_distance -= fabsf(*component - previous);
    change_state(camera, maze);
  } else {
    camera->remaining_distance = 0;
  }
}

static void turn_camera(Camera *camera, Maze *maze) {
  Tuplef pivot;
  float tangent;
  float previous = camera->rotation;
  if (camera->state == TURNING_LEFT) {
    tangent = camera->rotation * ((float)M_PI / 180.0f) + (float)M_PI;
    pivot.x = nearest_half(camera->position.x + 0.5f * cosf(tangent));
    pivot.z = nearest_half(camera->position.z + 0.5f * sinf(tangent));
    camera->rotation -= ANGULAR_CONVERSION_FACTOR * camera->remaining_distance;
    if (previous > WEST && camera->rotation <= WEST) {
      camera->rotation = WEST;
    } else if (previous > SOUTH && camera->rotation <= SOUTH) {
      camera->rotation = SOUTH;
    } else if (previous > EAST && camera->rotation <= EAST) {
      camera->rotation = EAST;
    } else if (previous > NORTH && camera->rotation <= NORTH) {
      camera->rotation = NORTH;
    } else {
      camera->remaining_distance = 0;
    }
    if (camera->remaining_distance != 0) {
      camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - camera->rotation);
    }
    tangent = camera->rotation * ((float)M_PI / 180.0f);
  } else {
    tangent = camera->rotation * ((float)M_PI / 180.0f);
    pivot.x = nearest_half(camera->position.x + 0.5f * cosf(tangent));
    pivot.z = nearest_half(camera->position.z + 0.5f * sinf(tangent));
    camera->rotation += ANGULAR_CONVERSION_FACTOR * camera->remaining_distance;
    if (camera->rotation >= 360) {
      camera->rotation = NORTH;
      camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - 360);
    } else if (previous < WEST && camera->rotation >= WEST) {
      camera->rotation = WEST;
      camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - camera->rotation);
    } else if (previous < SOUTH && camera->rotation >= SOUTH) {
      camera->rotation = SOUTH;
      camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - camera->rotation);
    } else if (previous < EAST && camera->rotation >= EAST) {
      camera->rotation = EAST;
      camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - camera->rotation);
    } else {
      camera->remaining_distance = 0;
    }
    tangent = camera->rotation * ((float)M_PI / 180.0f) + (float)M_PI;
  }

  camera->position.x = pivot.x + 0.5f * cosf(tangent);
  camera->position.z = pivot.z + 0.5f * sinf(tangent);
  if (camera->rotation < 0) camera->rotation += 360;
  if (camera->rotation == NORTH || camera->rotation == EAST ||
      camera->rotation == SOUTH || camera->rotation == WEST) {
    camera->position.x = nearest_half(camera->position.x);
    camera->position.z = nearest_half(camera->position.z);
    change_state(camera, maze);
  }
}

static void turn_around(Camera *camera, Maze *maze) {
  float previous = camera->rotation;
  camera->rotation -= 1.5f * ANGULAR_CONVERSION_FACTOR * camera->remaining_distance;
  if (previous > camera->desired_rotation && camera->rotation <= camera->desired_rotation) {
    camera->rotation = camera->desired_rotation;
    camera->remaining_distance -= ((float)M_PI / 180.0f) * fabsf(previous - camera->rotation);
    change_state(camera, maze);
  } else {
    camera->remaining_distance = 0;
    if (camera->rotation < 0) camera->rotation += 360;
  }
}

static void step_camera(Maze *maze) {
  Camera *camera = &maze->camera;
  float previous_height = maze->wall_height;
  while (camera->remaining_distance > 0) {
    switch (camera->state) {
      case WALKING:
        switch ((int)camera->rotation) {
          case NORTH: walk_camera(camera, 'z', -1, maze); break;
          case EAST: walk_camera(camera, 'x', 1, maze); break;
          case SOUTH: walk_camera(camera, 'z', 1, maze); break;
          case WEST: walk_camera(camera, 'x', -1, maze); break;
          default: camera->rotation = 90 * roundf(camera->rotation / 90.0f); break;
        }
        break;
      case TURNING_LEFT:
      case TURNING_RIGHT:
        turn_camera(camera, maze);
        break;
      case TURNING_AROUND:
        turn_around(camera, maze);
        break;
      case STARTING:
        maze->wall_height += 0.48f * camera->remaining_distance;
        if (maze->wall_height > 1.0f) {
          maze->wall_height = 1.0f;
          camera->remaining_distance = fabsf(previous_height - maze->wall_height);
          change_state(camera, maze);
        } else {
          camera->remaining_distance = 0;
        }
        break;
      case FINISHING:
        if (maze->wall_height <= 0) {
          maze->wall_height = 0;
          camera->remaining_distance = 0;
        } else {
          maze->wall_height -= 0.48f * camera->remaining_distance;
          if (maze->wall_height < 0) maze->wall_height = 0;
          camera->remaining_distance = 0;
        }
        break;
      default:
        camera->remaining_distance = 0;
        break;
    }
  }
}

static char cell_character(unsigned char cell) {
  if (cell == WALL) return '#';
  if (cell == START) return 'S';
  if (cell == FINISH) return 'F';
  return '.';
}

int main(int argc, char **argv) {
  long seed = 26080701;
  if (argc > 1) {
    char *end = NULL;
    seed = strtol(argv[1], &end, 10);
    if (!end || *end != '\0' || seed <= 0) {
      fprintf(stderr, "seed must be a positive integer\n");
      return 2;
    }
  }

  Maze maze = {0};
  srandom((unsigned)seed);
  initialize_grid(&maze);
  build_maze(&maze);
  place_start_and_finish(&maze);
  maze.camera.state = STARTING;
  maze.wall_height = 0;

  printf("{\"schema\":\"cssmaze-native-state@1\",\"seed\":%ld,", seed);
  printf("\"logicalRows\":%d,\"logicalColumns\":%d,", LOGICAL_ROWS, LOGICAL_COLUMNS);
  printf("\"gridRows\":%d,\"gridColumns\":%d,", ROWS, COLUMNS);
  printf("\"frameDelayMicroseconds\":%d,\"speed\":%.9g,", FRAME_DELAY_MICROSECONDS, SOURCE_SPEED);
  printf("\"start\":[%u,%u],\"finish\":[%u,%u],", maze.start.row, maze.start.column, maze.finish.row, maze.finish.column);
  printf("\"grid\":[");
  for (unsigned row = 0; row < ROWS; row++) {
    if (row) putchar(',');
    putchar('"');
    for (unsigned column = 0; column < COLUMNS; column++) putchar(cell_character(maze.grid[row][column]));
    putchar('"');
  }
  printf("],\"frames\":[");

  int frame_count = 0;
  int complete = 0;
  for (int tick = 0; tick < MAX_FRAMES; tick++) {
    if (tick) putchar(',');
    printf("[%d,%.9g,%.9g,%.9g,%.9g,%u]", tick,
           maze.camera.position.x, maze.camera.position.z,
           maze.camera.rotation, maze.wall_height, maze.camera.state);
    frame_count++;
    if (maze.camera.state == FINISHING && maze.wall_height <= 0) {
      complete = 1;
      break;
    }
    maze.camera.remaining_distance = SOURCE_SPEED * 1.6f *
      (FRAME_DELAY_MICROSECONDS / 1000000.0f);
    step_camera(&maze);
  }
  printf("],\"frameCount\":%d,\"completeTraversal\":%s}\n", frame_count, complete ? "true" : "false");
  return complete ? 0 : 3;
}
