// SPDX-License-Identifier: GPL-2.0-or-later
#include <array>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <vector>

#include <GL/gl.h>
#include <GL/glu.h>

namespace {

struct TransformCapture {
  std::array<float, 3> translation{0.0f, 0.0f, 0.0f};
  std::array<float, 2> rotationDegrees{0.0f, 0.0f};
  float scaleZ = 1.0f;
  int translationCount = 0;
  int rotationCount = 0;
  int scaleCount = 0;
};

TransformCapture capture;
GLUquadricObj quadric;

void resetCapture() {
  capture = TransformCapture{};
}

}  // namespace

extern "C" {
void glBegin(GLenum) {}
void glCallList(GLuint) {}
void glClear(GLbitfield) {}
void glClearColor(GLfloat, GLfloat, GLfloat, GLfloat) {}
void glColor3f(GLfloat, GLfloat, GLfloat) {}
void glColorMaterial(GLenum, GLenum) {}
void glEnable(GLenum) {}
void glEnd(void) {}
void glEndList(void) {}
void glFrontFace(GLenum) {}
void glHint(GLenum, GLenum) {}
void glLightfv(GLenum, GLenum, const GLfloat*) {}
void glLineWidth(GLfloat) {}
void glLoadIdentity(void) {}
void glMaterialf(GLenum, GLenum, GLfloat) {}
void glMatrixMode(GLenum) {}
void glNewList(GLuint, GLenum) {}
void glOrtho(GLdouble, GLdouble, GLdouble, GLdouble, GLdouble, GLdouble) {}
void glPointSize(GLfloat) {}
void glPopMatrix(void) {}
void glPushMatrix(void) {}
void glRotatef(GLfloat angle, GLfloat x, GLfloat y, GLfloat z) {
  if (capture.rotationCount < 2) capture.rotationDegrees[capture.rotationCount] = angle;
  capture.rotationCount += 1;
  (void)x;
  (void)y;
  (void)z;
}
void glScalef(GLfloat, GLfloat, GLfloat z) {
  capture.scaleZ = z;
  capture.scaleCount += 1;
}
void glTranslatef(GLfloat x, GLfloat y, GLfloat z) {
  capture.translation = {x, y, z};
  capture.translationCount += 1;
}
void glVertex3f(GLfloat, GLfloat, GLfloat) {}
void glViewport(GLint, GLint, GLsizei, GLsizei) {}
GLUquadricObj* gluNewQuadric(void) { return &quadric; }
void gluDeleteQuadric(GLUquadricObj*) {}
void gluPerspective(GLdouble, GLdouble, GLdouble, GLdouble) {}
void gluSphere(GLUquadricObj*, GLdouble, GLint, GLint) {}
void glXSwapBuffers(void*, unsigned long) {}
}

bool isSuspended = false;
bool checkingPassword = false;
void* xdisplay = nullptr;
unsigned long xwindow = 0;

#ifndef CSSFLOCKS_SOURCE_PATH
#error "CSSFLOCKS_SOURCE_PATH must name the pinned upstream flocks.cpp"
#endif

#include CSSFLOCKS_SOURCE_PATH

namespace {

constexpr std::array<int, 10> kSampleIndices = {0, 1, 2, 3, 4, 5, 17, 103, 323, 1003};
constexpr int kFrameCount = 600;
constexpr float kFrameSeconds = 1.0f / 60.0f;

bool sampled(int index) {
  for (const int sample : kSampleIndices) {
    if (sample == index) return true;
  }
  return false;
}

void dumpBug(int frameIndex, int index, const bug& value, bool drawn) {
  float directionX = 0.0f;
  float directionY = 0.0f;
  float directionZ = 0.0f;
  float stretch = 1.0f;
  const float scaledX = value.xSpeed * 0.04f;
  const float scaledY = value.ySpeed * 0.04f;
  const float scaledZ = value.zSpeed * 0.04f;
  const float speedScale = std::sqrt(scaledX * scaledX + scaledY * scaledY + scaledZ * scaledZ);
  if (speedScale > 0.0f) {
    directionX = scaledX / speedScale;
    directionY = scaledY / speedScale;
    directionZ = scaledZ / speedScale;
    stretch = speedScale * static_cast<float>(dStretch) * 0.05f;
    if (stretch < 1.0f) stretch = 1.0f;
  }
  std::cout << frameIndex << ',' << index << ',' << value.type << ','
            << (value.type ? value.leader : -1) << ',' << value.h << ','
            << value.x << ',' << value.y << ',' << value.z << ','
            << value.xSpeed << ',' << value.ySpeed << ',' << value.zSpeed << ','
            << directionX << ',' << directionY << ',' << directionZ << ',' << stretch << ','
            << (drawn ? 1 : 0) << ','
            << capture.translation[0] << ',' << capture.translation[1] << ',' << capture.translation[2] << ','
            << capture.rotationDegrees[0] << ',' << capture.rotationDegrees[1] << ',' << capture.scaleZ << ','
            << capture.translationCount << ',' << capture.rotationCount << ',' << capture.scaleCount << ','
            << (drawn ? value.r : 0.0f) << ',' << (drawn ? value.g : 0.0f) << ','
            << (drawn ? value.b : 0.0f) << '\n';
}

void dumpInitialState() {
  resetCapture();
  for (int index = 0; index < dLeaders; index += 1) {
    if (sampled(index)) dumpBug(-1, index, lBugs[index], false);
  }
  for (int followerIndex = 0; followerIndex < dFollowers; followerIndex += 1) {
    const int index = dLeaders + followerIndex;
    if (sampled(index)) dumpBug(-1, index, fBugs[followerIndex], false);
  }
}

void updateAndDumpFrame(int frameIndex) {
  frameTime = kFrameSeconds;
  for (int index = 0; index < dLeaders; index += 1) {
    resetCapture();
    lBugs[index].update(lBugs);
    if (sampled(index)) dumpBug(frameIndex, index, lBugs[index], true);
  }
  for (int followerIndex = 0; followerIndex < dFollowers; followerIndex += 1) {
    resetCapture();
    fBugs[followerIndex].update(lBugs);
    const int index = dLeaders + followerIndex;
    if (sampled(index)) dumpBug(frameIndex, index, fBugs[followerIndex], true);
  }
}

}  // namespace

int main(int argc, char** argv) {
  const unsigned int seed = argc > 1 ? static_cast<unsigned int>(std::strtoul(argv[1], nullptr, 10)) : 1u;
  rsRandGen().seed(seed);
  setDefaults();
  reshape(1280, 720);
  initSaver();

  std::cout << std::setprecision(9);
  std::cout << "frame,index,type,leader,hue,x,y,z,xSpeed,ySpeed,zSpeed,directionX,directionY,directionZ,stretch,drawn,translateX,translateY,translateZ,rotateY,rotateX,scaleZ,translationCount,rotationCount,scaleCount,r,g,b\n";
  dumpInitialState();
  for (int frameIndex = 0; frameIndex < kFrameCount; frameIndex += 1) updateAndDumpFrame(frameIndex);
  cleanUp();
  return 0;
}
