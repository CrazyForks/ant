#include "input.h"

#include <algorithm>
#include <string>
#include <vector>

#include "host_state.h"
#include "platform/mac/remote_layer_compositor.h"

namespace {

uint32_t CefModifiers(uint32_t modifiers) {
  uint32_t result = 0;
  if (modifiers & ANT_DESKTOP_MODIFIER_SHIFT) result |= EVENTFLAG_SHIFT_DOWN;
  if (modifiers & ANT_DESKTOP_MODIFIER_CONTROL) result |= EVENTFLAG_CONTROL_DOWN;
  if (modifiers & ANT_DESKTOP_MODIFIER_ALT) result |= EVENTFLAG_ALT_DOWN;
  if (modifiers & ANT_DESKTOP_MODIFIER_COMMAND) result |= EVENTFLAG_COMMAND_DOWN;
  if (modifiers & ANT_DESKTOP_MODIFIER_CAPS_LOCK) result |= EVENTFLAG_CAPS_LOCK_ON;
  if (modifiers & ANT_DESKTOP_MODIFIER_KEYPAD) result |= EVENTFLAG_IS_KEY_PAD;
  if (modifiers & ANT_DESKTOP_MODIFIER_LEFT_BUTTON) result |= EVENTFLAG_LEFT_MOUSE_BUTTON;
  if (modifiers & ANT_DESKTOP_MODIFIER_RIGHT_BUTTON) result |= EVENTFLAG_RIGHT_MOUSE_BUTTON;
  if (modifiers & ANT_DESKTOP_MODIFIER_MIDDLE_BUTTON) result |= EVENTFLAG_MIDDLE_MOUSE_BUTTON;
  return result;
}

} // namespace

bool HandleBrowserInput(CefRefPtr<CefBrowser> browser, const ant_desktop_control_message_t &message,
                        TrustedKeySequences &trusted_key_sequences) {
  CefRefPtr<CefBrowserHost> host = browser->GetHost();
  CefMouseEvent mouse;
  mouse.x = static_cast<int>(message.x);
  mouse.y = static_cast<int>(message.y);
  mouse.modifiers = CefModifiers(message.modifiers);

  switch (message.type) {
  case ANT_DESKTOP_CONTROL_MOUSE_MOVE:
    host->SendMouseMoveEvent(mouse, false);
    return true;
  case ANT_DESKTOP_CONTROL_MOUSE_LEAVE:
    host->SendMouseMoveEvent(mouse, true);
    return true;
  case ANT_DESKTOP_CONTROL_MOUSE_DOWN:
  case ANT_DESKTOP_CONTROL_MOUSE_UP: {
    CefBrowserHost::MouseButtonType button = MBT_LEFT;
    if (message.button == 1) button = MBT_RIGHT;
    if (message.button == 2) button = MBT_MIDDLE;
    host->SendMouseClickEvent(mouse, button, message.type == ANT_DESKTOP_CONTROL_MOUSE_UP,
                              static_cast<int>(message.click_count));
    return true;
  }
  case ANT_DESKTOP_CONTROL_SCROLL:
    host->SendMouseWheelEvent(mouse, static_cast<int>(message.delta_x), static_cast<int>(message.delta_y));
    return true;
  case ANT_DESKTOP_CONTROL_KEY_DOWN:
  case ANT_DESKTOP_CONTROL_KEY_UP: {
    CefKeyEvent key;
    key.type = message.type == ANT_DESKTOP_CONTROL_KEY_DOWN ? KEYEVENT_RAWKEYDOWN : KEYEVENT_KEYUP;
    key.modifiers = CefModifiers(message.modifiers);
    key.native_key_code = static_cast<int>(message.key_code);
    if (message.text_length > 0) {
      std::string text(message.text, message.text_length);
      CefString cef_text(text);
      if (cef_text.length()) {
        key.character = cef_text.c_str()[0];
        key.unmodified_character = cef_text.c_str()[0];
      }
    }
    if (message.type == ANT_DESKTOP_CONTROL_KEY_DOWN) {
      trusted_key_sequences[key.native_key_code] = {message.sequence, std::chrono::steady_clock::now()};
    }
    host->SendKeyEvent(key);
    return true;
  }
  case ANT_DESKTOP_CONTROL_FOCUS:
    host->SetFocus(message.delta_x != 0);
    return true;
  case ANT_DESKTOP_CONTROL_RESIZE:
    g_view_width = std::max(1, static_cast<int>(message.x));
    g_view_height = std::max(1, static_cast<int>(message.y));
    g_device_scale_factor = message.delta_x > 0 ? static_cast<float>(message.delta_x) : 1.0f;
    ResizeRemoteLayer(g_view_width, g_view_height, g_device_scale_factor);
    host->NotifyScreenInfoChanged();
    host->WasResized();
    return true;
  case ANT_DESKTOP_CONTROL_IME_SET: {
    std::string text(message.text, message.text_length);
    std::vector<CefCompositionUnderline> underlines;
    CefRange selection(message.selection_start, message.selection_start + message.selection_length);
    host->ImeSetComposition(text, underlines, CefRange::InvalidRange(), selection);
    return true;
  }
  case ANT_DESKTOP_CONTROL_IME_COMMIT: {
    std::string text(message.text, message.text_length);
    host->ImeCommitText(text, CefRange::InvalidRange(), 0);
    return true;
  }
  case ANT_DESKTOP_CONTROL_IME_FINISH:
    host->ImeFinishComposingText(false);
    return true;
  case ANT_DESKTOP_CONTROL_GESTURE_MAGNIFY:
    mouse.modifiers |= EVENTFLAG_CONTROL_DOWN;
    host->SendMouseWheelEvent(mouse, 0, static_cast<int>(message.delta_y * 1200.0));
    return true;
  case ANT_DESKTOP_CONTROL_GESTURE_ROTATE:
    mouse.modifiers |= EVENTFLAG_ALT_DOWN;
    host->SendMouseWheelEvent(mouse, 0, static_cast<int>(message.delta_y * 10.0));
    return true;
  case ANT_DESKTOP_CONTROL_GESTURE_SWIPE:
    host->SendMouseWheelEvent(mouse, static_cast<int>(message.delta_x * 120.0),
                              static_cast<int>(message.delta_y * 120.0));
    return true;
  default:
    return false;
  }
}
