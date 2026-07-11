#include "host_state.h"

#include <stdio.h>

#include "include/cef_parser.h"

int g_view_width = 960;
int g_view_height = 600;
float g_device_scale_factor = 2.0f;
bool g_diagnostic_input = false;
bool g_transparent = false;

void EmitHostEvent(const char *type, int code, const CefString &detail) {
  std::string encoded = CefURIEncode(detail, false).ToString();
  printf("EVENT\t%s\t%d\t%s\n", type, code, encoded.c_str());
  fflush(stdout);
}
