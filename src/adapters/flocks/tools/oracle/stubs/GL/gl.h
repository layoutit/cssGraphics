#ifndef CSSFLOCKS_ORACLE_GL_H
#define CSSFLOCKS_ORACLE_GL_H

typedef unsigned int GLenum;
typedef unsigned int GLbitfield;
typedef unsigned int GLuint;
typedef float GLfloat;
typedef double GLdouble;
typedef int GLint;
typedef int GLsizei;

#define GL_AMBIENT 0x1200
#define GL_AMBIENT_AND_DIFFUSE 0x1602
#define GL_CCW 0x0901
#define GL_COLOR_BUFFER_BIT 0x00004000
#define GL_COLOR_MATERIAL 0x0B57
#define GL_COMPILE 0x1300
#define GL_CULL_FACE 0x0B44
#define GL_DEPTH_BUFFER_BIT 0x00000100
#define GL_DEPTH_TEST 0x0B71
#define GL_DIFFUSE 0x1201
#define GL_FRONT 0x0404
#define GL_LIGHT0 0x4000
#define GL_LIGHTING 0x0B50
#define GL_LINES 0x0001
#define GL_LINE_SMOOTH 0x0B20
#define GL_LINE_SMOOTH_HINT 0x0C52
#define GL_MODELVIEW 0x1700
#define GL_NICEST 0x1102
#define GL_POINTS 0x0000
#define GL_POINT_SMOOTH 0x0B10
#define GL_POINT_SMOOTH_HINT 0x0C51
#define GL_POSITION 0x1203
#define GL_PROJECTION 0x1701
#define GL_SHININESS 0x1601
#define GL_SPECULAR 0x1202

#ifdef __cplusplus
extern "C" {
#endif

void glBegin(GLenum mode);
void glCallList(GLuint list);
void glClear(GLbitfield mask);
void glClearColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha);
void glColor3f(GLfloat red, GLfloat green, GLfloat blue);
void glColorMaterial(GLenum face, GLenum mode);
void glEnable(GLenum capability);
void glEnd(void);
void glEndList(void);
void glFrontFace(GLenum mode);
void glHint(GLenum target, GLenum mode);
void glLightfv(GLenum light, GLenum parameter, const GLfloat* values);
void glLineWidth(GLfloat width);
void glLoadIdentity(void);
void glMaterialf(GLenum face, GLenum parameter, GLfloat value);
void glMatrixMode(GLenum mode);
void glNewList(GLuint list, GLenum mode);
void glOrtho(GLdouble left, GLdouble right, GLdouble bottom, GLdouble top, GLdouble nearValue, GLdouble farValue);
void glPointSize(GLfloat size);
void glPopMatrix(void);
void glPushMatrix(void);
void glRotatef(GLfloat angle, GLfloat x, GLfloat y, GLfloat z);
void glScalef(GLfloat x, GLfloat y, GLfloat z);
void glTranslatef(GLfloat x, GLfloat y, GLfloat z);
void glVertex3f(GLfloat x, GLfloat y, GLfloat z);
void glViewport(GLint x, GLint y, GLsizei width, GLsizei height);

#ifdef __cplusplus
}
#endif

#endif
