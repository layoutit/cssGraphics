#ifndef CSSPLATONICFOLDING_HEADLESS_SCREENHACK_I_H
#define CSSPLATONICFOLDING_HEADLESS_SCREENHACK_I_H

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

#define GL_GLEXT_PROTOTYPES 1
#include <OpenGL/gl.h>
#include <OpenGL/glext.h>
#include <OpenGL/glu.h>

#ifndef GL_CONTEXT_PROFILE_MASK
#define GL_CONTEXT_PROFILE_MASK 0x9126
#endif
#ifndef GL_CONTEXT_CORE_PROFILE_BIT
#define GL_CONTEXT_CORE_PROFILE_BIT 0x00000001
#endif
#ifndef glBindVertexArray
#define glBindVertexArray glBindVertexArrayAPPLE
#define glGenVertexArrays glGenVertexArraysAPPLE
#define glDeleteVertexArrays glDeleteVertexArraysAPPLE
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define countof(value) (sizeof(value) / sizeof(*(value)))
#define MIN(left, right) ((left) < (right) ? (left) : (right))

typedef int Bool;

#ifndef False
#define False 0
#endif
#ifndef True
#define True 1
#endif

#endif
