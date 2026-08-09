#ifndef CSSGRAVITYWELL_HEADLESS_SCREENHACK_I_H
#define CSSGRAVITYWELL_HEADLESS_SCREENHACK_I_H

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define GL_GLEXT_PROTOTYPES 1
#include <OpenGL/gl.h>
#include <OpenGL/glext.h>
#include <OpenGL/glu.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define countof(value) (sizeof(value) / sizeof(*(value)))

typedef int Bool;

#ifndef False
#define False 0
#endif
#ifndef True
#define True 1
#endif

#endif
