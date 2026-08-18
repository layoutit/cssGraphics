#ifndef CSSFLIPFLOP_HEADLESS_XLOCKMORE_H
#define CSSFLIPFLOP_HEADLESS_XLOCKMORE_H

#include "screenhackI.h"
#include "yarandom.h"

typedef struct Display Display;
typedef struct Screen Screen;
typedef struct Visual Visual;
typedef unsigned long Window;
typedef unsigned long Colormap;
typedef unsigned long KeySym;
typedef void *GLXContext;

typedef struct {
  short x, y;
  unsigned short width, height;
} XRectangle;

typedef union XEvent {
  struct { int type; } xany;
  struct { int type; } xkey;
  struct { int type; unsigned int button; unsigned int state; int x; int y; } xbutton;
  struct { int type; int x; int y; } xmotion;
} XEvent;

typedef struct {
  Screen *screen;
  Colormap colormap;
} XWindowAttributes;

typedef struct {
  int screen;
  int width;
  int height;
  int count;
  Bool wireframe_p;
  Bool fps_p;
  int polygon_count;
  Display *display;
  Window window;
  XWindowAttributes xgwa;
} ModeInfo;

typedef struct {
  const char *option;
  const char *specifier;
  int arg_kind;
  const char *value;
} XrmOptionDescRec;

typedef struct {
  void *var;
  const char *name;
  const char *class_name;
  const char *default_value;
  int type;
} argtype;

typedef struct {
  int option_count;
  XrmOptionDescRec *options;
  int variable_count;
  argtype *variables;
  void *defaults;
} ModeSpecOpt;

enum { XrmoptionNoArg = 0, XrmoptionSepArg = 1 };
enum { t_Bool = 1, t_Float = 2, t_Int = 3, t_String = 4 };
enum { ButtonPress = 4, ButtonRelease = 5, MotionNotify = 6, Button1 = 1 };

#define ENTRYPOINT
#define XSCREENSAVER_MODULE(name, symbol)
#define XSCREENSAVER_MODULE_2(name, symbol, prefix)
#define MI_SCREEN(mi) ((mi)->screen)
#define MI_WIDTH(mi) ((mi)->width)
#define MI_HEIGHT(mi) ((mi)->height)
#define MI_IS_WIREFRAME(mi) ((mi)->wireframe_p)
#define MI_DISPLAY(mi) ((mi)->display)
#define MI_WINDOW(mi) ((mi)->window)
#define MI_INIT(mi, storage) do { \
  if (!(storage)) (storage) = calloc(1, sizeof(*(storage))); \
  if (!(storage)) abort(); \
} while (0)
#define MI_CLEARWINDOW(mi) do { (void)(mi); } while (0)

GLXContext *init_GL(ModeInfo *mi);
Bool glXMakeCurrent(Display *display, Window window, GLXContext context);
void glXSwapBuffers(Display *display, Window window);
void do_fps(ModeInfo *mi);
Bool screenhack_event_helper(Display *display, Window window, XEvent *event);
double current_device_rotation(void);

#endif
