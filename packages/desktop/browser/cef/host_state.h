#ifndef ANT_DESKTOP_CEF_HOST_STATE_H
#define ANT_DESKTOP_CEF_HOST_STATE_H

#include "include/cef_base.h"

extern int g_view_width;
extern int g_view_height;
extern float g_device_scale_factor;
extern bool g_diagnostic_input;
extern bool g_transparent;

void EmitHostEvent(const char *type, int code, const CefString &detail);

#endif
