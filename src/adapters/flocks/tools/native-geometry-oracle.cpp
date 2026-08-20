// SPDX-License-Identifier: GPL-2.0-or-later
#include <OpenGL/OpenGL.h>
#include <array>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

#include <GL/gl.h>
#include <GL/glu.h>

bool isSuspended = false;
bool checkingPassword = false;
void* xdisplay = nullptr;
unsigned long xwindow = 0;
extern "C" void glXSwapBuffers(void*, unsigned long) {}

#ifndef CSSFLOCKS_SOURCE_PATH
#error "CSSFLOCKS_SOURCE_PATH must name the pinned upstream flocks.cpp"
#endif

#include CSSFLOCKS_SOURCE_PATH

namespace {

constexpr int kWidth = 640;
constexpr int kHeight = 640;
CGLContextObj context = nullptr;
CGLPixelFormatObj pixelFormat = nullptr;
GLuint framebuffer = 0;
GLuint colorbuffer = 0;
GLuint depthbuffer = 0;

struct Triangle {
  std::array<std::array<float, 3>, 3> vertices;
};

void createContext() {
  CGLPixelFormatAttribute attributes[] = {
    kCGLPFAOpenGLProfile, static_cast<CGLPixelFormatAttribute>(kCGLOGLPVersion_Legacy),
    kCGLPFAAccelerated,
    kCGLPFAAllowOfflineRenderers,
    kCGLPFAColorSize, static_cast<CGLPixelFormatAttribute>(24),
    kCGLPFAAlphaSize, static_cast<CGLPixelFormatAttribute>(8),
    kCGLPFADepthSize, static_cast<CGLPixelFormatAttribute>(24),
    static_cast<CGLPixelFormatAttribute>(0),
  };
  GLint count = 0;
  if (CGLChoosePixelFormat(attributes, &pixelFormat, &count) != kCGLNoError || !pixelFormat) std::abort();
  if (CGLCreateContext(pixelFormat, nullptr, &context) != kCGLNoError || !context) std::abort();
  if (CGLSetCurrentContext(context) != kCGLNoError) std::abort();
  glGenFramebuffersEXT(1, &framebuffer);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, framebuffer);
  glGenRenderbuffersEXT(1, &colorbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, colorbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_RGBA8, kWidth, kHeight);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT, GL_RENDERBUFFER_EXT, colorbuffer);
  glGenRenderbuffersEXT(1, &depthbuffer);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, depthbuffer);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_DEPTH_COMPONENT24, kWidth, kHeight);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_DEPTH_ATTACHMENT_EXT, GL_RENDERBUFFER_EXT, depthbuffer);
  if (glCheckFramebufferStatusEXT(GL_FRAMEBUFFER_EXT) != GL_FRAMEBUFFER_COMPLETE_EXT) std::abort();
  glDrawBuffer(GL_COLOR_ATTACHMENT0_EXT);
  glReadBuffer(GL_COLOR_ATTACHMENT0_EXT);
}

void destroyContext() {
  if (depthbuffer) glDeleteRenderbuffersEXT(1, &depthbuffer);
  if (colorbuffer) glDeleteRenderbuffersEXT(1, &colorbuffer);
  if (framebuffer) glDeleteFramebuffersEXT(1, &framebuffer);
  CGLSetCurrentContext(nullptr);
  if (context) CGLDestroyContext(context);
  if (pixelFormat) CGLDestroyPixelFormat(pixelFormat);
}

std::array<float, 3> recoverObjectVertex(float windowX, float windowY, float windowZ) {
  return {
    windowX / static_cast<float>(kWidth) * 6.0f - 3.0f,
    windowY / static_cast<float>(kHeight) * 6.0f - 3.0f,
    (1.0f - windowZ * 2.0f) * 3.0f,
  };
}

std::vector<Triangle> parseFeedback(const std::array<float, 4096>& feedback, int count, bool recoverObject) {
  std::vector<Triangle> triangles;
  int index = 0;
  while (index < count) {
    const GLenum token = static_cast<GLenum>(feedback[index++]);
    if (token != GL_POLYGON_TOKEN || index >= count) std::abort();
    const int vertexCount = static_cast<int>(feedback[index++]);
    if (vertexCount < 3 || index + vertexCount * 3 > count) std::abort();
    std::vector<std::array<float, 3>> polygon;
    for (int vertex = 0; vertex < vertexCount; vertex += 1) {
      polygon.push_back(recoverObject
        ? recoverObjectVertex(feedback[index], feedback[index + 1], feedback[index + 2])
        : std::array<float, 3>{feedback[index], feedback[index + 1], feedback[index + 2]});
      index += 3;
    }
    for (int vertex = 1; vertex + 1 < vertexCount; vertex += 1) {
      const Triangle triangle{{polygon[0], polygon[vertex], polygon[vertex + 1]}};
      const auto& a = triangle.vertices[0];
      const auto& b = triangle.vertices[1];
      const auto& c = triangle.vertices[2];
      const float abX = b[0] - a[0];
      const float abY = b[1] - a[1];
      const float abZ = b[2] - a[2];
      const float acX = c[0] - a[0];
      const float acY = c[1] - a[1];
      const float acZ = c[2] - a[2];
      const float crossX = abY * acZ - abZ * acY;
      const float crossY = abZ * acX - abX * acZ;
      const float crossZ = abX * acY - abY * acX;
      if (crossX * crossX + crossY * crossY + crossZ * crossZ > 1e-8f) triangles.push_back(triangle);
    }
  }
  return triangles;
}

std::vector<Triangle> captureTopology() {
  std::array<float, 4096> feedback{};
  glDisable(GL_CULL_FACE);
  glDisable(GL_LIGHTING);
  glViewport(0, 0, kWidth, kHeight);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  glOrtho(-3.0, 3.0, -3.0, 3.0, -3.0, 3.0);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
  glFeedbackBuffer(static_cast<GLsizei>(feedback.size()), GL_3D, feedback.data());
  glRenderMode(GL_FEEDBACK);
  glCallList(1);
  const GLint count = glRenderMode(GL_RENDER);
  if (count <= 0) std::abort();
  return parseFeedback(feedback, count, true);
}

std::vector<Triangle> captureProjectedBug() {
  std::array<float, 4096> feedback{};
  reshape(1280, 720);
  glEnable(GL_CULL_FACE);
  glEnable(GL_LIGHTING);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
  glTranslatef(0.0f, 0.0f, -static_cast<float>(wide * 2));
  frameTime = 1.0f / 60.0f;
  for (int frame = 0; frame < 1200; frame += 1) {
    for (int index = 0; index < dLeaders; index += 1) lBugs[index].update(lBugs);
    for (int index = 0; index < dFollowers; index += 1) fBugs[index].update(lBugs);
  }
  glFeedbackBuffer(static_cast<GLsizei>(feedback.size()), GL_3D, feedback.data());
  glRenderMode(GL_FEEDBACK);
  lBugs[0].update(lBugs);
  const GLint count = glRenderMode(GL_RENDER);
  if (count <= 0) std::abort();
  return parseFeedback(feedback, count, false);
}

bool writePpm(const std::string& path) {
  std::vector<unsigned char> rgba(static_cast<size_t>(kWidth) * kHeight * 4);
  std::vector<unsigned char> row(static_cast<size_t>(kWidth) * 3);
  glFinish();
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, kWidth, kHeight, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
  FILE* stream = std::fopen(path.c_str(), "wb");
  if (!stream) return false;
  std::fprintf(stream, "P6\n%d %d\n255\n", kWidth, kHeight);
  for (int y = kHeight - 1; y >= 0; y -= 1) {
    const unsigned char* source = rgba.data() + static_cast<size_t>(y) * kWidth * 4;
    for (int x = 0; x < kWidth; x += 1) {
      row[x * 3] = source[x * 4];
      row[x * 3 + 1] = source[x * 4 + 1];
      row[x * 3 + 2] = source[x * 4 + 2];
    }
    if (std::fwrite(row.data(), 1, row.size(), stream) != row.size()) {
      std::fclose(stream);
      return false;
    }
  }
  return std::fclose(stream) == 0;
}

void renderIsolatedFrames(const std::string& directory) {
  glEnable(GL_DEPTH_TEST);
  glEnable(GL_CULL_FACE);
  glEnable(GL_LIGHTING);
  glEnable(GL_LIGHT0);
  glViewport(0, 0, kWidth, kHeight);
  for (int frame = 0; frame < 12; frame += 1) {
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    gluPerspective(50.0, 1.0, 0.1, 2000.0);
    glMatrixMode(GL_MODELVIEW);
    glLoadIdentity();
    glTranslatef(0.0f, 0.0f, -14.0f);
    glRotatef(15.0f, 1.0f, 0.0f, 0.0f);
    glRotatef(static_cast<float>(frame * 30), 0.0f, 1.0f, 0.0f);
    glScalef(1.0f, 1.0f, 1.6f);
    glColor3f(0.15f, 0.8f, 1.0f);
    glCallList(1);
    char name[64];
    std::snprintf(name, sizeof(name), "/native-%03d.ppm", frame);
    if (!writePpm(directory + name)) std::abort();
  }
}

void printVector(const float* values, int count) {
  std::cout << '[';
  for (int index = 0; index < count; index += 1) {
    if (index) std::cout << ',';
    std::cout << values[index];
  }
  std::cout << ']';
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: cssflocks-native-geometry-oracle <frames-directory>\n";
    return 2;
  }
  createContext();
  rsRandGen().seed(1);
  setDefaults();
  reshape(1280, 720);
  float projection[16];
  glGetFloatv(GL_PROJECTION_MATRIX, projection);
  initSaver();
  GLint frontFace = 0;
  GLint cullFaceMode = 0;
  float ambient[4];
  float diffuse[4];
  float specular[4];
  float position[4];
  glGetIntegerv(GL_FRONT_FACE, &frontFace);
  glGetIntegerv(GL_CULL_FACE_MODE, &cullFaceMode);
  glGetLightfv(GL_LIGHT0, GL_AMBIENT, ambient);
  glGetLightfv(GL_LIGHT0, GL_DIFFUSE, diffuse);
  glGetLightfv(GL_LIGHT0, GL_SPECULAR, specular);
  glGetLightfv(GL_LIGHT0, GL_POSITION, position);
  const bool cullEnabled = glIsEnabled(GL_CULL_FACE) == GL_TRUE;
  const bool lightingEnabled = glIsEnabled(GL_LIGHTING) == GL_TRUE;
  const std::vector<Triangle> triangles = captureTopology();
  const std::vector<Triangle> projectedTriangles = captureProjectedBug();
  const std::array<float, 3> projectedPosition = {lBugs[0].x, lBugs[0].y, lBugs[0].z};
  const std::array<float, 3> projectedVelocity = {lBugs[0].xSpeed, lBugs[0].ySpeed, lBugs[0].zSpeed};
  renderIsolatedFrames(argv[1]);

  std::cout << std::setprecision(9);
  std::cout << "{\"schema\":\"cssflocks-native-geometry-oracle@1\",\"renderer\":\""
            << reinterpret_cast<const char*>(glGetString(GL_RENDERER)) << "\",\"triangleCount\":" << triangles.size()
            << ",\"frontFace\":" << frontFace << ",\"cullFaceMode\":" << cullFaceMode
            << ",\"cullEnabled\":" << (cullEnabled ? "true" : "false")
            << ",\"lightingEnabled\":" << (lightingEnabled ? "true" : "false")
            << ",\"projectionMatrix\":";
  printVector(projection, 16);
  std::cout << ",\"light\":{\"ambient\":";
  printVector(ambient, 4);
  std::cout << ",\"diffuse\":";
  printVector(diffuse, 4);
  std::cout << ",\"specular\":";
  printVector(specular, 4);
  std::cout << ",\"position\":";
  printVector(position, 4);
  std::cout << "},\"triangles\":[";
  for (size_t triangleIndex = 0; triangleIndex < triangles.size(); triangleIndex += 1) {
    if (triangleIndex) std::cout << ',';
    std::cout << '[';
    for (int vertex = 0; vertex < 3; vertex += 1) {
      if (vertex) std::cout << ',';
      printVector(triangles[triangleIndex].vertices[vertex].data(), 3);
    }
    std::cout << ']';
  }
  std::cout << "],\"projectedBug\":{\"position\":";
  printVector(projectedPosition.data(), 3);
  std::cout << ",\"velocity\":";
  printVector(projectedVelocity.data(), 3);
  std::cout << ",\"triangles\":[";
  for (size_t triangleIndex = 0; triangleIndex < projectedTriangles.size(); triangleIndex += 1) {
    if (triangleIndex) std::cout << ',';
    std::cout << '[';
    for (int vertex = 0; vertex < 3; vertex += 1) {
      if (vertex) std::cout << ',';
      printVector(projectedTriangles[triangleIndex].vertices[vertex].data(), 3);
    }
    std::cout << ']';
  }
  std::cout << "]}}\n";
  cleanUp();
  destroyContext();
  return triangles.size() == 6 ? 0 : 3;
}
