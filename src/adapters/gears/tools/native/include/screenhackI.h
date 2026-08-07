#ifndef __SCREENHACK_I_H__
#define __SCREENHACK_I_H__

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define countof(value) (sizeof(value) / sizeof(*(value)))

typedef int Bool;
typedef float GLfloat;
typedef int GLint;
typedef unsigned int GLuint;
typedef unsigned int GLenum;

#define False 0
#define True 1

#define GL_AMBIENT_AND_DIFFUSE 0x1602
#define GL_CCW 0x0901
#define GL_CW 0x0900
#define GL_FRONT 0x0404
#define GL_LIGHTING 0x0B50
#define GL_LINES 0x0001
#define GL_LINE_LOOP 0x0002
#define GL_QUADS 0x0007
#define GL_QUAD_STRIP 0x0008
#define GL_SHININESS 0x1601
#define GL_SPECULAR 0x1202
#define GL_TRIANGLE_FAN 0x0006

extern const char *progname;

void glBegin(GLenum mode);
void glColor3f(GLfloat red, GLfloat green, GLfloat blue);
void glDisable(GLenum capability);
void glEnable(GLenum capability);
void glEnd(void);
void glFrontFace(GLenum mode);
void glMaterialfv(GLenum face, GLenum name, const GLfloat *values);
void glMateriali(GLenum face, GLenum name, GLint value);
void glNormal3f(GLfloat x, GLfloat y, GLfloat z);
void glPopMatrix(void);
void glPushMatrix(void);
void glRotatef(GLfloat angle, GLfloat x, GLfloat y, GLfloat z);
void glTranslatef(GLfloat x, GLfloat y, GLfloat z);
void glVertex3f(GLfloat x, GLfloat y, GLfloat z);

#endif
