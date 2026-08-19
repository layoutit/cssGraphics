// SPDX-License-Identifier: GPL-2.0-or-later
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl.h>
#include <OpenGL/glu.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

struct Particle {
  float matrix[16];
  float color[3];
};

static CGLContextObj context;
static CGLPixelFormatObj pixelFormat;
static GLuint framebuffer;
static GLuint colorbuffer;
static GLuint depthbuffer;

static void createContext(int width, int height) {
  CGLPixelFormatAttribute attributes[] = {
    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_Legacy,
    kCGLPFAAccelerated,
    kCGLPFAAllowOfflineRenderers,
    kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
    kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
    kCGLPFADepthSize, (CGLPixelFormatAttribute)24,
    (CGLPixelFormatAttribute)0,
  };
  GLint count = 0;
  if (CGLChoosePixelFormat(attributes, &pixelFormat, &count) != kCGLNoError || !pixelFormat) std::abort();
  if (CGLCreateContext(pixelFormat, nullptr, &context) != kCGLNoError || !context) std::abort();
  if (CGLSetCurrentContext(context) != kCGLNoError) std::abort();
  glGenFramebuffersEXT(1, &framebuffer);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, framebuffer);
  glGenRenderbuffersEXT(1, &colorbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, colorbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_RGBA8, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT, GL_RENDERBUFFER_EXT, colorbuffer);
  glGenRenderbuffersEXT(1, &depthbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, depthbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_DEPTH_COMPONENT24, width, height);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_DEPTH_ATTACHMENT_EXT, GL_RENDERBUFFER_EXT, depthbuffer);
  if (glCheckFramebufferStatusEXT(GL_FRAMEBUFFER_EXT) != GL_FRAMEBUFFER_COMPLETE_EXT) std::abort();
}

static std::vector<Particle> readState(const char* path) {
  FILE* stream = std::fopen(path, "rb");
  if (!stream) std::abort();
  char magic[4];
  uint32_t count;
  if (std::fread(magic, 1, 4, stream) != 4 || std::memcmp(magic, "CYC2", 4) != 0 ||
      std::fread(&count, sizeof(count), 1, stream) != 1) std::abort();
  std::vector<Particle> particles(count);
  for (Particle& particle : particles) {
    if (std::fread(particle.matrix, sizeof(float), 16, stream) != 16 ||
        std::fread(particle.color, sizeof(float), 3, stream) != 3) std::abort();
  }
  std::fclose(stream);
  return particles;
}

static void writePpm(const char* path, int width, int height) {
  std::vector<unsigned char> rgba((size_t)width * height * 4);
  std::vector<unsigned char> row((size_t)width * 3);
  glFinish();
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
  FILE* stream = std::fopen(path, "wb");
  if (!stream) std::abort();
  std::fprintf(stream, "P6\n%d %d\n255\n", width, height);
  for (int y = height - 1; y >= 0; y -= 1) {
    const unsigned char* source = rgba.data() + (size_t)y * width * 4;
    for (int x = 0; x < width; x += 1) {
      row[x * 3] = source[x * 4];
      row[x * 3 + 1] = source[x * 4 + 1];
      row[x * 3 + 2] = source[x * 4 + 2];
    }
    std::fwrite(row.data(), 1, row.size(), stream);
  }
  std::fclose(stream);
}

int main(int argc, char** argv) {
  if (argc != 5 && argc != 6) {
    std::fprintf(stderr, "usage: %s state.bin output.ppm width height [particle-index]\n", argv[0]);
    return 2;
  }
  const int width = std::atoi(argv[3]);
  const int height = std::atoi(argv[4]);
  const std::vector<Particle> particles = readState(argv[1]);
  const int selectedParticle = argc == 6 ? std::atoi(argv[5]) : -1;
  if (selectedParticle >= (int)particles.size()) return 2;
  createContext(width, height);
  glViewport(0, 0, width, height);
  glEnable(GL_DEPTH_TEST);
  glFrontFace(GL_CCW);
  glEnable(GL_CULL_FACE);
  glClearColor(0, 0, 0, 1);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  gluPerspective(80, (double)width / height, 50, 3000);
  glTranslatef(0, 0, -400);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
  glEnable(GL_LIGHTING);
  glEnable(GL_LIGHT0);
  const float ambient[4] = {0.25f, 0.25f, 0.25f, 0};
  const float diffuse[4] = {1, 1, 1, 0};
  const float specular[4] = {1, 1, 1, 0};
  const float position[4] = {400, -200, 400, 0};
  glLightfv(GL_LIGHT0, GL_AMBIENT, ambient);
  glLightfv(GL_LIGHT0, GL_DIFFUSE, diffuse);
  glLightfv(GL_LIGHT0, GL_SPECULAR, specular);
  glLightfv(GL_LIGHT0, GL_POSITION, position);
  glEnable(GL_COLOR_MATERIAL);
  glMaterialf(GL_FRONT, GL_SHININESS, 20);
  glColorMaterial(GL_FRONT, GL_SPECULAR);
  glColor3f(0.7f, 0.7f, 0.7f);
  glColorMaterial(GL_FRONT, GL_AMBIENT_AND_DIFFUSE);
  GLUquadricObj* sphere = gluNewQuadric();
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  for (int particleIndex = 0; particleIndex < (int)particles.size(); particleIndex += 1) {
    if (selectedParticle >= 0 && particleIndex != selectedParticle) continue;
    const Particle& particle = particles[particleIndex];
    glColor3f(particle.color[0], particle.color[1], particle.color[2]);
    glPushMatrix();
    glMultMatrixf(particle.matrix);
    gluSphere(sphere, 1.75, 3, 2);
    glPopMatrix();
  }
  gluDeleteQuadric(sphere);
  writePpm(argv[2], width, height);
  return 0;
}
