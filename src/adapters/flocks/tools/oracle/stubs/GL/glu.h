#ifndef CSSFLOCKS_ORACLE_GLU_H
#define CSSFLOCKS_ORACLE_GLU_H

#include <GL/gl.h>

struct GLUquadricObj {};

#ifdef __cplusplus
extern "C" {
#endif

GLUquadricObj* gluNewQuadric(void);
void gluDeleteQuadric(GLUquadricObj* quadric);
void gluPerspective(GLdouble fieldOfView, GLdouble aspect, GLdouble nearValue, GLdouble farValue);
void gluSphere(GLUquadricObj* quadric, GLdouble radius, GLint slices, GLint stacks);

#ifdef __cplusplus
}
#endif

#endif
