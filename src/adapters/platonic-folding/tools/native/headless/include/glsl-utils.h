#ifndef CSSPLATONICFOLDING_HEADLESS_GLSL_UTILS_H
#define CSSPLATONICFOLDING_HEADLESS_GLSL_UTILS_H

void glsl_CopyMatrix(GLfloat c[16], GLfloat m[16]);
void glsl_Identity(GLfloat c[16]);
void glsl_MultMatrix(GLfloat c[16], GLfloat m[16]);
void glsl_MultMatrixVector(GLfloat o[4], GLfloat m[16], GLfloat v[4]);
void glsl_Rotate(GLfloat c[16], GLfloat angle, GLfloat x, GLfloat y, GLfloat z);
void glsl_Translate(GLfloat c[16], GLfloat tx, GLfloat ty, GLfloat tz);
void glsl_Scale(GLfloat c[16], GLfloat sx, GLfloat sy, GLfloat sz);
void glsl_LookAt(GLfloat c[16], GLfloat eyex, GLfloat eyey, GLfloat eyez,
                 GLfloat centerx, GLfloat centery, GLfloat centerz,
                 GLfloat upx, GLfloat upy, GLfloat upz);
void glsl_Perspective(GLfloat c[16], GLfloat fovy, GLfloat aspect,
                      GLfloat z_near, GLfloat z_far);
void glsl_Orthographic(GLfloat c[16], GLfloat left, GLfloat right,
                       GLfloat bottom, GLfloat top, GLfloat nearval,
                       GLfloat farval);
GLboolean glsl_GetGlAndGlslVersions(GLint *gl_major, GLint *gl_minor,
                                    GLint *glsl_major, GLint *glsl_minor,
                                    GLboolean *gl_gles3);
const GLchar *glsl_GetGLSLVersionString(void);
GLboolean glsl_IsCoreProfile(void);
GLboolean glsl_CompileAndLinkShaders(GLsizei vertex_shader_count,
                                     const GLchar **vertex_shader_source,
                                     GLsizei fragment_shader_count,
                                     const GLchar **fragment_shader_source,
                                     GLuint *shader_program);

#endif
