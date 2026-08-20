#ifndef CSSFLOCKS_ORACLE_RSXSCREENSAVER_H
#define CSSFLOCKS_ORACLE_RSXSCREENSAVER_H

#include <string>

extern bool isSuspended;
extern bool checkingPassword;
extern void* xdisplay;
extern unsigned long xwindow;

inline constexpr bool kStatistics = false;

class rsTimer {
public:
  double tick() { return 1.0 / 60.0; }
};

template <typename Value>
void getArgumentsValue(int, char**, const std::string&, Value&, Value, Value) {}

using std::to_string;

#ifdef __cplusplus
extern "C" {
#endif
void glXSwapBuffers(void* display, unsigned long window);
#ifdef __cplusplus
}
#endif

#endif
