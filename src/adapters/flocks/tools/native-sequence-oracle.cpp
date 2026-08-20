// SPDX-License-Identifier: GPL-2.0-or-later
#include <OpenGL/OpenGL.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
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

constexpr int kWidth = 1280;
constexpr int kHeight = 800;
constexpr int kRootCount = 324;
constexpr float kCameraDistance = 568.0f;
CGLContextObj context = nullptr;
CGLPixelFormatObj pixelFormat = nullptr;
GLuint framebuffer = 0;
GLuint colorbuffer = 0;
GLuint depthbuffer = 0;

struct RootState {
  float x;
  float y;
  float z;
  float vx;
  float vy;
  float vz;
  float hue;
};

using Frame = std::vector<RootState>;

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

std::vector<Frame> readStates(const std::string& path) {
  std::ifstream input(path);
  if (!input) throw std::runtime_error("unable to open state CSV");
  std::string line;
  if (!std::getline(input, line) || line != "ordinal,root,x,y,z,vx,vy,vz,hue") {
    throw std::runtime_error("state CSV header drifted");
  }
  std::vector<Frame> frames;
  while (std::getline(input, line)) {
    std::replace(line.begin(), line.end(), ',', ' ');
    std::istringstream row(line);
    int ordinal = -1;
    int root = -1;
    RootState state{};
    if (!(row >> ordinal >> root >> state.x >> state.y >> state.z >> state.vx >> state.vy >> state.vz >> state.hue) ||
        ordinal < 0 || root < 0 || root >= kRootCount) {
      throw std::runtime_error("malformed state CSV row");
    }
    if (static_cast<int>(frames.size()) <= ordinal) frames.resize(static_cast<size_t>(ordinal + 1));
    if (static_cast<int>(frames[ordinal].size()) != root) throw std::runtime_error("state CSV root order drifted");
    frames[ordinal].push_back(state);
  }
  if (frames.empty() || std::any_of(frames.begin(), frames.end(), [](const Frame& frame) {
    return frame.size() != kRootCount;
  })) throw std::runtime_error("state CSV frame cardinality drifted");
  return frames;
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

void renderFrame(const Frame& frame) {
  glViewport(0, 0, kWidth, kHeight);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  gluPerspective(50.0, static_cast<double>(kWidth) / kHeight, 0.1, 2000.0);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
  glTranslatef(0.0f, 0.0f, -kCameraDistance);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  for (const RootState& state : frame) {
    float red = 0.0f;
    float green = 0.0f;
    float blue = 0.0f;
    hsl2rgb(state.hue, 1.0f, 1.0f, red, green, blue);
    const float speed = std::sqrt(state.vx * state.vx + state.vy * state.vy + state.vz * state.vz);
    const float directionX = speed > 0.0f ? state.vx / speed : 0.0f;
    const float directionY = speed > 0.0f ? state.vy / speed : 0.0f;
    const float directionZ = speed > 0.0f ? state.vz / speed : 0.0f;
    const float stretch = std::max(speed * 0.04f, 1.0f);
    glColor3f(red, green, blue);
    glPushMatrix();
    glTranslatef(state.x, state.y, state.z);
    glRotatef(std::atan2(-directionX, -directionZ) * R2D, 0.0f, 1.0f, 0.0f);
    glRotatef(std::asin(std::clamp(directionY, -1.0f, 1.0f)) * R2D, 1.0f, 0.0f, 0.0f);
    glScalef(1.0f, 1.0f, stretch);
    glCallList(1);
    glPopMatrix();
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: cssflocks-native-sequence-oracle <states.csv> <frames-directory>\n";
    return 2;
  }
  try {
    const std::vector<Frame> frames = readStates(argv[1]);
    createContext();
    rsRandGen().seed(1);
    setDefaults();
    reshape(1280, 720);
    initSaver();
    for (size_t ordinal = 0; ordinal < frames.size(); ordinal += 1) {
      renderFrame(frames[ordinal]);
      char name[64];
      std::snprintf(name, sizeof(name), "/frame_%04zu.ppm", ordinal);
      if (!writePpm(std::string(argv[2]) + name)) throw std::runtime_error("failed to write native frame");
    }
    std::cout << "{\"schema\":\"cssflocks-native-sequence-oracle@1\",\"frameCount\":" << frames.size()
              << ",\"rootCount\":" << kRootCount << ",\"renderer\":\""
              << reinterpret_cast<const char*>(glGetString(GL_RENDERER)) << "\"}\n";
    cleanUp();
    destroyContext();
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    if (context) destroyContext();
    return 3;
  }
}
