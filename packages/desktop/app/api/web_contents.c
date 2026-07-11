#include "desktop_core.h"

#include "../platform/platform.h"

static ant_value_t DesktopWebContentsControl(ant_t *js, ant_desktop_control_type_t type) {
  ant_desktop_window_state_t *window = ant_desktop_window_from_value(js, js_getthis(js));

  if (!window) return js_mkerr(js, "invalid WebContents receiver");
  ant_desktop_control_message_t message = {0};
  message.type = type;

  if (!ant_desktop_platform_send_control(window, &message))
    return js_mkerr(js, "Chromium is not running for this BrowserWindow");

  return js_mkundef();
}

ant_value_t DesktopWebContentsOpenDevTools(ant_t *js, ant_value_t *args, int nargs) {
  return DesktopWebContentsControl(js, ANT_DESKTOP_CONTROL_OPEN_DEVTOOLS);
}

ant_value_t DesktopWebContentsCloseDevTools(ant_t *js, ant_value_t *args, int nargs) {
  return DesktopWebContentsControl(js, ANT_DESKTOP_CONTROL_CLOSE_DEVTOOLS);
}

ant_value_t DesktopWebContentsToggleDevTools(ant_t *js, ant_value_t *args, int nargs) {
  return DesktopWebContentsControl(js, ANT_DESKTOP_CONTROL_TOGGLE_DEVTOOLS);
}

ant_value_t DesktopWebContentsInspectElement(ant_t *js, ant_value_t *args, int nargs) {
  ant_desktop_window_state_t *window = ant_desktop_window_from_value(js, js_getthis(js));
  if (!window) return js_mkerr(js, "invalid WebContents receiver");
  if (nargs < 2 || vtype(args[0]) != T_NUM || vtype(args[1]) != T_NUM)
    return js_mkerr(js, "inspectElement(x, y) requires coordinates");

  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_INSPECT_ELEMENT;
  message.x = js_getnum(args[0]);
  message.y = js_getnum(args[1]);

  if (!ant_desktop_platform_send_control(window, &message))
    return js_mkerr(js, "Chromium is not running for this BrowserWindow");

  return js_mkundef();
}

ant_value_t DesktopWebContentsIsDevToolsOpened(ant_t *js, ant_value_t *args, int nargs) {
  ant_desktop_window_state_t *window = ant_desktop_window_from_value(js, js_getthis(js));
  if (!window) return js_mkerr(js, "invalid WebContents receiver");
  return window->devtools_open ? js_true : js_false;
}

ant_value_t DesktopWebContentsReload(ant_t *js, ant_value_t *args, int nargs) {
  return DesktopWebContentsControl(js, ANT_DESKTOP_CONTROL_RELOAD);
}

ant_value_t DesktopWebContentsSend(ant_t *js, ant_value_t *args, int nargs) {
  ant_desktop_window_state_t *window = ant_desktop_window_from_value(js, js_getthis(js));
  if (!window) return js_mkerr(js, "invalid WebContents receiver");
  if (nargs < 1 || vtype(args[0]) != T_STR) return js_mkerr(js, "webContents.send(channel, value) requires a channel");

  size_t channel_length = 0;
  const char *channel = js_getstr(js, args[0], &channel_length);
  if (!ant_desktop_has_capability(window, "receive", channel, channel_length))
    return js_mkerr(js, "IPC receive channel is not granted: %.*s", (int)channel_length, channel);

  ant_value_t encode = window->desktop->encode;
  if (!is_callable(encode)) return js_mkerr(js, "desktop IPC bridge is unavailable");

  ant_value_t value = nargs > 1 ? args[1] : js_mkundef();
  ant_value_t encoded = ant_desktop_call_function(js, encode, js_glob(js), &value, 1);

  if (is_err(encoded)) return encoded;
  if (vtype(encoded) != T_STR) return js_mkerr(js, "IPC encoding failed");

  size_t payload_length = 0;
  const char *payload = js_getstr(js, encoded, &payload_length);

  if (!SendIpcControl(window, ANT_DESKTOP_CONTROL_IPC_EVENT, 0, channel, channel_length, payload, payload_length))
    return js_mkerr(js, "IPC event is too large or Chromium is not running");

  return js_mkundef();
}
