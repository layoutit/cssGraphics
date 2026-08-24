/* SPDX-License-Identifier: HPND */
/* Headless fixed-seed oracle for the pinned XScreenSaver galaxy.c equations. */
#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifndef GALAXIES
# define GALAXIES 2
#endif
#if GALAXIES < 2 || GALAXIES > 5
# error GALAXIES must remain inside galaxy.c's prepared two-to-five range
#endif
#define MAX_STARS 3000
#define DELTAT 0.005
#define EPSILON 0.00000001
#define SQRT_EPSILON 0.0001
#define QCONS 0.001
#define COLORBASE 16
#define NCOLORS 64
#define WIDTH 800
#define HEIGHT 600
#define CYCLES 250
#define VECTOR_SIZE 55
#define PREPARED_STARS_PER_GALAXY 950

static const uint32_t initial_vector[VECTOR_SIZE] = {
  3951096678U,1141277249U,2480103125U,2707569682U,299730482U,4259445343U,
  4196601416U,1927830288U,2552754534U,2039360758U,1739546395U,2394763994U,
  2645429346U,578465010U,1138168509U,960347592U,1218805097U,331920724U,
  136757403U,1372238758U,951837919U,912608081U,1641202836U,3597483205U,
  2609610878U,342647964U,1790781987U,3083359110U,126547608U,735593562U,
  1364860169U,88240761U,123161791U,2168127358U,2950153604U,1047427037U,
  1861311165U,2109159457U,890034277U,2381957287U,1711222699U,387884763U,
  3785047504U,3233886172U,1607866416U,4041823072U,984949279U,2748545107U,
  838981238U,1096414934U,1859160272U,1946436445U,1916111696U,3644183052U,
  2082959571U
};

typedef struct { double pos[3], vel[3]; int16_t old_x, old_y, x, y; } Star;
typedef struct {
  int32_t mass, nstars, galcol;
  Star *stars;
  double pos[3], vel[3];
  uint8_t color[3];
} Galaxy;
typedef struct {
  uint32_t random_values[VECTOR_SIZE];
  int random_i1, random_i2;
  Galaxy galaxies[GALAXIES];
  uint8_t palette[NCOLORS][3];
  double scale, rot_x, rot_y;
  int32_t midx, midy, step, generation, global_frame;
  int restart_pending;
} Universe;

static uint32_t rotate_left(uint32_t value, int count) {
  return (value << count) | (value >> (32 - count));
}

static void random_init(Universe *u, uint32_t seed) {
  int i;
  memcpy(u->random_values, initial_vector, sizeof(initial_vector));
  u->random_values[0] += seed;
  for (i = 1; i < VECTOR_SIZE; i++) {
    seed *= 999U;
    seed = rotate_left(seed, 9);
    seed += u->random_values[i - 1] * 1001U;
    seed = rotate_left(seed, 15);
    u->random_values[i] += seed;
  }
  u->random_i1 = u->random_values[0] % VECTOR_SIZE;
  u->random_i2 = (u->random_i1 + 24) % VECTOR_SIZE;
}

static uint32_t ya_random(Universe *u) {
  uint32_t result = u->random_values[u->random_i1] + u->random_values[u->random_i2];
  u->random_values[u->random_i1] = result;
  if (++u->random_i1 >= VECTOR_SIZE) u->random_i1 = 0;
  if (++u->random_i2 >= VECTOR_SIZE) u->random_i2 = 0;
  return result;
}

static int32_t nrand(Universe *u, uint32_t n) {
  return (int32_t)(((uint64_t)ya_random(u) * n) / 0x100000000ULL);
}

static double float_rand(Universe *u) {
  return (double)(ya_random(u) & 0x7fffffffU) / 2147483648.0;
}

static float fsin(double value) { return (float)sin(value); }
static float fcos(double value) { return (float)cos(value); }

static void hsv_to_rgb(int h, double s, double v, uint8_t rgb[3]) {
  double H, p1, p2, p3, f, values[3];
  int i, channel;
  uint16_t component;
  if (s < 0) s = 0; if (s > 1) s = 1;
  if (v < 0) v = 0; if (v > 1) v = 1;
  H = (h % 360) / 60.0;
  i = (int)H;
  f = H - i;
  p1 = v * (1 - s);
  p2 = v * (1 - (s * f));
  p3 = v * (1 - (s * (1 - f)));
  if      (i == 0) { values[0]=v;  values[1]=p3; values[2]=p1; }
  else if (i == 1) { values[0]=p2; values[1]=v;  values[2]=p1; }
  else if (i == 2) { values[0]=p1; values[1]=v;  values[2]=p3; }
  else if (i == 3) { values[0]=p1; values[1]=p2; values[2]=v;  }
  else if (i == 4) { values[0]=p3; values[1]=p1; values[2]=v;  }
  else             { values[0]=v;  values[1]=p1; values[2]=p2; }
  for (channel = 0; channel < 3; channel++) {
    component = (uint16_t)(values[channel] * 65535.0);
    rgb[channel] = (uint8_t)lround((double)component / 257.0);
  }
}

static void make_palette(Universe *u) {
  int i, half = NCOLORS / 2 + 1;
  double saturation = (double)(ya_random(u) % 34 + 66) / 100.0;
  double value = (double)(ya_random(u) % 34 + 66) / 100.0;
  double delta_hue = 359.0 / half;
  for (i = 0; i < half; i++) hsv_to_rgb((int)(i * delta_hue), saturation, value, u->palette[i]);
  for (i = half; i < NCOLORS; i++) memcpy(u->palette[i], u->palette[NCOLORS - i], 3);
}

static void free_galaxies(Universe *u) {
  int i;
  for (i = 0; i < GALAXIES; i++) {
    free(u->galaxies[i].stars);
    u->galaxies[i].stars = NULL;
  }
}

static void start_over(Universe *u) {
  int i, j;
  u->step = 0;
  u->rot_x = u->rot_y = 0;
  u->generation++;
  for (i = 0; i < GALAXIES; i++) {
    Galaxy *g = &u->galaxies[i];
    double matrix[3][3], w1, w2, sinw1, sinw2, cosw1, cosw2, size;
    free(g->stars);
    memset(g, 0, sizeof(*g));
    g->galcol = nrand(u, COLORBASE - 2);
    if (g->galcol > 1) g->galcol += 2;
    g->nstars = nrand(u, MAX_STARS / 2) + MAX_STARS / 2;
    g->stars = (Star *)calloc((size_t)g->nstars, sizeof(Star));
    if (!g->stars) { perror("calloc"); exit(2); }
    w1 = 2.0 * M_PI * float_rand(u);
    w2 = 2.0 * M_PI * float_rand(u);
    sinw1 = fsin(w1); sinw2 = fsin(w2); cosw1 = fcos(w1); cosw2 = fcos(w2);
    matrix[0][0]=cosw2; matrix[0][1]=-sinw1*sinw2; matrix[0][2]=cosw1*sinw2;
    matrix[1][0]=0; matrix[1][1]=cosw1; matrix[1][2]=sinw1;
    matrix[2][0]=-sinw2; matrix[2][1]=-sinw1*cosw2; matrix[2][2]=cosw1*cosw2;
    for (j = 0; j < 3; j++) g->vel[j] = float_rand(u) * 2.0 - 1.0;
    for (j = 0; j < 3; j++) g->pos[j] = -g->vel[j] * DELTAT * CYCLES + float_rand(u) - 0.5;
    g->mass = (int)(float_rand(u) * 1000.0) + 1;
    size = 0.1 * float_rand(u) + 0.15;
    for (j = 0; j < g->nstars; j++) {
      Star *s = &g->stars[j];
      double w = 2.0 * M_PI * float_rand(u);
      double sinw = fsin(w), cosw = fcos(w);
      double d = float_rand(u) * size;
      double h = float_rand(u) * exp(-2.0 * (d / size)) / 5.0 * size;
      double speed;
      if (float_rand(u) < 0.5) h = -h;
      s->pos[0]=matrix[0][0]*d*cosw+matrix[1][0]*d*sinw+matrix[2][0]*h+g->pos[0];
      s->pos[1]=matrix[0][1]*d*cosw+matrix[1][1]*d*sinw+matrix[2][1]*h+g->pos[1];
      s->pos[2]=matrix[0][2]*d*cosw+matrix[1][2]*d*sinw+matrix[2][2]*h+g->pos[2];
      speed = sqrt(g->mass * QCONS / sqrt(d*d + h*h));
      s->vel[0]=(-matrix[0][0]*speed*sinw+matrix[1][0]*speed*cosw+g->vel[0])*DELTAT;
      s->vel[1]=(-matrix[0][1]*speed*sinw+matrix[1][1]*speed*cosw+g->vel[1])*DELTAT;
      s->vel[2]=(-matrix[0][2]*speed*sinw+matrix[1][2]*speed*cosw+g->vel[2])*DELTAT;
    }
    memcpy(g->color, u->palette[(NCOLORS / COLORBASE) * g->galcol], 3);
  }
}

static void init_universe(Universe *u, uint32_t seed) {
  memset(u, 0, sizeof(*u));
  u->generation = -1;
  u->scale = (WIDTH + HEIGHT) / 8.0;
  u->midx = WIDTH / 2;
  u->midy = HEIGHT / 2;
  random_init(u, seed);
  make_palette(u);
  start_over(u);
}

static void advance(Universe *u) {
  int i, j, k;
  double cox, six, cor, sir, eps;
  if (u->restart_pending) { start_over(u); u->restart_pending = 0; }
  u->rot_y += 0.01; u->rot_x += 0.004;
  cox=fcos(u->rot_y); six=fsin(u->rot_y); cor=fcos(u->rot_x); sir=fsin(u->rot_x);
  eps = 1 / (EPSILON * SQRT_EPSILON * DELTAT * DELTAT * QCONS);
  for (i = 0; i < GALAXIES; i++) {
    Galaxy *g = &u->galaxies[i];
    for (j = 0; j < g->nstars; j++) {
      Star *s = &g->stars[j];
      double v0=s->vel[0], v1=s->vel[1], v2=s->vel[2];
      for (k = 0; k < GALAXIES; k++) {
        Galaxy *a=&u->galaxies[k];
        double d0=a->pos[0]-s->pos[0], d1=a->pos[1]-s->pos[1], d2=a->pos[2]-s->pos[2];
        double squared=d0*d0+d1*d1+d2*d2;
        double acceleration = squared > EPSILON
          ? a->mass/(squared*sqrt(squared))*DELTAT*DELTAT*QCONS
          : a->mass/(eps*sqrt(eps));
        v0 += d0*acceleration; v1 += d1*acceleration; v2 += d2*acceleration;
      }
      s->vel[0]=v0; s->vel[1]=v1; s->vel[2]=v2;
      s->pos[0]+=v0; s->pos[1]+=v1; s->pos[2]+=v2;
      s->x=(int16_t)(((cox*s->pos[0])-(six*s->pos[2]))*u->scale+u->midx);
      s->y=(int16_t)(((cor*s->pos[1])-(sir*((six*s->pos[0])+(cox*s->pos[2]))))*u->scale+u->midy);
    }
    for (k = i + 1; k < GALAXIES; k++) {
      Galaxy *other=&u->galaxies[k];
      double d0=other->pos[0]-g->pos[0], d1=other->pos[1]-g->pos[1], d2=other->pos[2]-g->pos[2];
      double squared=d0*d0+d1*d1+d2*d2;
      double acceleration=squared>EPSILON
        ? 1/(squared*sqrt(squared))*DELTAT*QCONS
        : 1/(EPSILON*SQRT_EPSILON)*DELTAT*QCONS;
      d0*=acceleration; d1*=acceleration; d2*=acceleration;
      g->vel[0]+=d0*other->mass; g->vel[1]+=d1*other->mass; g->vel[2]+=d2*other->mass;
      other->vel[0]-=d0*g->mass; other->vel[1]-=d1*g->mass; other->vel[2]-=d2*g->mass;
    }
    g->pos[0]+=g->vel[0]*DELTAT; g->pos[1]+=g->vel[1]*DELTAT; g->pos[2]+=g->vel[2]*DELTAT;
  }
}

static void finish_frame(Universe *u) {
  int i, j;
  for (i = 0; i < GALAXIES; i++) for (j = 0; j < u->galaxies[i].nstars; j++) {
    Star *s=&u->galaxies[i].stars[j]; s->old_x=s->x; s->old_y=s->y;
  }
  u->global_frame++;
  if (++u->step > CYCLES * 4) u->restart_pending = 1;
}

static int write_state_record(FILE *out, Universe *u, int32_t frame, int prefix) {
  int i, j, per = prefix / GALAXIES;
  if (fwrite(&frame, sizeof(frame), 1, out) != 1 ||
      fwrite(&u->generation, sizeof(u->generation), 1, out) != 1 ||
      fwrite(&u->step, sizeof(u->step), 1, out) != 1 ||
      fwrite(&u->rot_x, sizeof(u->rot_x), 1, out) != 1 ||
      fwrite(&u->rot_y, sizeof(u->rot_y), 1, out) != 1) return 0;
  for (i = 0; i < GALAXIES; i++) {
    Galaxy *g=&u->galaxies[i];
    if (fwrite(&g->mass, sizeof(g->mass), 1, out) != 1 ||
        fwrite(&g->nstars, sizeof(g->nstars), 1, out) != 1 ||
        fwrite(&g->galcol, sizeof(g->galcol), 1, out) != 1 ||
        fwrite(g->pos, sizeof(double), 3, out) != 3 || fwrite(g->vel, sizeof(double), 3, out) != 3) return 0;
    for (j = 0; j < per; j++) {
      Star *s=&g->stars[j];
      if (fwrite(s->pos, sizeof(double), 3, out) != 3 || fwrite(s->vel, sizeof(double), 3, out) != 3 ||
          fwrite(&s->x, sizeof(s->x), 1, out) != 1 || fwrite(&s->y, sizeof(s->y), 1, out) != 1) return 0;
    }
  }
  return 1;
}

static int state_mode(uint32_t seed, int prefix, int frames, const char *path) {
  Universe u; FILE *out; char magic[8]={'C','S','S','G','A','L','1','\0'};
  uint32_t header[5]={(uint32_t)seed,(uint32_t)prefix,(uint32_t)(frames+1),GALAXIES,1};
  init_universe(&u, seed);
  out=fopen(path,"wb"); if(!out){perror(path);return 2;}
  fwrite(magic,1,8,out); fwrite(header,sizeof(uint32_t),5,out);
  if(!write_state_record(out,&u,-1,prefix)){perror("write");return 2;}
  for(int frame=0;frame<frames;frame++){
    advance(&u);
    if(!write_state_record(out,&u,frame,prefix)){perror("write");return 2;}
    finish_frame(&u);
  }
  fclose(out); free_galaxies(&u); return 0;
}

static void draw_point(uint8_t *pixels, int16_t x, int16_t y, const uint8_t color[3]) {
  size_t offset;
  if(x<0||x>=WIDTH||y<0||y>=HEIGHT)return;
  offset=((size_t)y*WIDTH+(size_t)x)*3;
  pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2];
}

static void render_source_frame(Universe *u, uint8_t *pixels, int prefix) {
  int i,j,per=prefix/GALAXIES; const uint8_t black[3]={0,0,0};
  for(i=0;i<GALAXIES;i++){
    Galaxy *g=&u->galaxies[i]; int limit=prefix==0?g->nstars:per;
    for(j=0;j<limit;j++)draw_point(pixels,g->stars[j].old_x,g->stars[j].old_y,black);
    for(j=0;j<limit;j++)draw_point(pixels,g->stars[j].x,g->stars[j].y,g->color);
  }
}

static int write_ppm(const char *path, const uint8_t *pixels) {
  FILE *out=fopen(path,"wb"); if(!out){perror(path);return 0;}
  fprintf(out,"P6\n%d %d\n255\n",WIDTH,HEIGHT);
  if(fwrite(pixels,1,(size_t)WIDTH*HEIGHT*3,out)!=(size_t)WIDTH*HEIGHT*3){perror("write");return 0;}
  fclose(out);return 1;
}

static int capture_mode(uint32_t seed,int prefix,int frames,int stride,const char *directory){
  Universe u; uint8_t *pixels; int ordinal=0; char path[2048];
  if(mkdir(directory,0755)&&errno!=EEXIST){perror(directory);return 2;}
  pixels=(uint8_t*)calloc((size_t)WIDTH*HEIGHT,3);if(!pixels){perror("calloc");return 2;}
  init_universe(&u,seed);
  for(int frame=0;frame<frames;frame++){
    if(u.restart_pending) memset(pixels,0,(size_t)WIDTH*HEIGHT*3);
    advance(&u);render_source_frame(&u,pixels,prefix);
    if(frame%stride==0){snprintf(path,sizeof(path),"%s/frame_%04d.ppm",directory,ordinal++);if(!write_ppm(path,pixels))return 2;}
    finish_frame(&u);
  }
  printf("{\"seed\":%u,\"starCount\":%d,\"sourceFrames\":%d,\"stride\":%d,\"capturedFrames\":%d}\n",seed,prefix,frames,stride,ordinal);
  free(pixels);free_galaxies(&u);return 0;
}

static int projection_mode(uint32_t seed,int frames,const char *path){
  Universe u; FILE *out; char magic[8]={'C','S','S','G','A','L','P','1'};
  uint32_t header[4]={seed,(uint32_t)frames,PREPARED_STARS_PER_GALAXY*GALAXIES,GALAXIES};
  int per=PREPARED_STARS_PER_GALAXY;
  init_universe(&u,seed);
  out=fopen(path,"wb");if(!out){perror(path);return 2;}
  fwrite(magic,1,8,out);fwrite(header,sizeof(uint32_t),4,out);
  for(int frame=0;frame<frames;frame++){
    advance(&u);
    fwrite(&frame,sizeof(int32_t),1,out);
    fwrite(&u.generation,sizeof(int32_t),1,out);
    fwrite(&u.step,sizeof(int32_t),1,out);
    for(int galaxy_index=0;galaxy_index<GALAXIES;galaxy_index++){
      Galaxy *g=&u.galaxies[galaxy_index];uint8_t padding=0;
      fwrite(&g->mass,sizeof(int32_t),1,out);
      fwrite(&g->nstars,sizeof(int32_t),1,out);
      fwrite(&g->galcol,sizeof(int32_t),1,out);
      fwrite(g->color,1,3,out);fwrite(&padding,1,1,out);
      for(int star_index=0;star_index<per;star_index++){
        Star *s=&g->stars[star_index];
        fwrite(&s->x,sizeof(int16_t),1,out);fwrite(&s->y,sizeof(int16_t),1,out);
        fwrite(&s->old_x,sizeof(int16_t),1,out);fwrite(&s->old_y,sizeof(int16_t),1,out);
      }
    }
    finish_frame(&u);
  }
  fclose(out);free_galaxies(&u);return 0;
}

int main(int argc,char **argv){
  if(argc==6&&!strcmp(argv[1],"state"))return state_mode((uint32_t)strtoul(argv[2],0,10),atoi(argv[3]),atoi(argv[4]),argv[5]);
  if(argc==7&&!strcmp(argv[1],"capture"))return capture_mode((uint32_t)strtoul(argv[2],0,10),atoi(argv[3]),atoi(argv[4]),atoi(argv[5]),argv[6]);
  if(argc==5&&!strcmp(argv[1],"projection"))return projection_mode((uint32_t)strtoul(argv[2],0,10),atoi(argv[3]),argv[4]);
  fprintf(stderr,"usage: %s state SEED STARS FRAMES OUT | capture SEED STARS FRAMES STRIDE OUT | projection SEED FRAMES OUT\n",argv[0]);
  return 2;
}
