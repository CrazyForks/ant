#include "../platform.h"
#include "internal.h"

NSMutableDictionary<NSNumber *, AntDesktopWindow *> *g_windows;

const char *ant_desktop_platform_resources_path(void) {
  return NSBundle.mainBundle.resourcePath.fileSystemRepresentation;
}

@implementation AntDesktopNSWindow
- (BOOL)canBecomeKeyWindow {
  return self.focusableOption;
}
- (BOOL)canBecomeMainWindow {
  return self.focusableOption;
}
@end

@implementation AntDesktopWindow

- (void)windowWillClose:(NSNotification *)notification {
  (void)notification;
  ant_desktop_window_state_t *state = self.state;
  if (!state) return;
  ant_desktop_emit_window_event(state, "closed", "", 0, 0);
  [self.hostTask terminate];
  [g_windows removeObjectForKey:@(state->identifier)];
  state->platform_data = NULL;
  self.state = NULL;
  ant_desktop_release_window_object(state);
  if (ant_desktop_window_count() == 0) [NSApp terminate:nil];
}

@end

AntDesktopWindow *MacWindowForState(ant_desktop_window_state_t *state) {
  return state && state->platform_data ? (__bridge AntDesktopWindow *)state->platform_data : nil;
}

bool ant_desktop_platform_send_control(ant_desktop_window_state_t *state, const ant_desktop_control_message_t *source) {
  AntDesktopWindow *window = MacWindowForState(state);
  if (!window.browserView.controlHandle || !source) return false;
  ant_desktop_control_message_t message = *source;
  [window.browserView sendMessage:&message];
  return true;
}

bool ant_desktop_platform_browser_running(ant_desktop_window_state_t *state) {
  return MacWindowForState(state).hostTask.running;
}

void ant_desktop_platform_close(ant_desktop_window_state_t *state) {
  [MacWindowForState(state).window close];
}

void ant_desktop_platform_show(ant_desktop_window_state_t *state) {
  state->show_when_ready = false;
  [MacWindowForState(state).window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

void ant_desktop_platform_hide(ant_desktop_window_state_t *state) {
  state->show_when_ready = false;
  [MacWindowForState(state).window orderOut:nil];
}

void ant_desktop_platform_minimize(ant_desktop_window_state_t *state) {
  [MacWindowForState(state).window miniaturize:nil];
}

void ant_desktop_platform_restore(ant_desktop_window_state_t *state) {
  [MacWindowForState(state).window deminiaturize:nil];
}

void ant_desktop_platform_maximize(ant_desktop_window_state_t *state) {
  [MacWindowForState(state).window zoom:nil];
}

void ant_desktop_platform_set_always_on_top(ant_desktop_window_state_t *state, bool enabled) {
  MacWindowForState(state).window.level = enabled ? NSFloatingWindowLevel : NSNormalWindowLevel;
}

void ant_desktop_platform_set_title(ant_desktop_window_state_t *state, const char *title, size_t length) {
  MacWindowForState(state).window.title = [[NSString alloc] initWithBytes:title
                                                                   length:length
                                                                 encoding:NSUTF8StringEncoding];
}

void ant_desktop_platform_set_full_screen(ant_desktop_window_state_t *state, bool enabled) {
  NSWindow *window = MacWindowForState(state).window;
  bool current = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  if (enabled != current) [window toggleFullScreen:nil];
}

void ant_desktop_platform_quit(void) {
  [NSApp terminate:nil];
}

void ant_desktop_platform_shutdown_all_windows(void) {
  for (AntDesktopWindow *window in g_windows.allValues.copy) {
    [window.hostTask terminate];
  }
}
