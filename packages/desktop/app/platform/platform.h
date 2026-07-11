#ifndef ANT_DESKTOP_PLATFORM_H
#define ANT_DESKTOP_PLATFORM_H

#include <stdbool.h>
#include <stddef.h>

#include "../../ipc/control.h"
#include "../core/window_state.h"

bool ant_desktop_platform_send_control(ant_desktop_window_state_t *window,
                                       const ant_desktop_control_message_t *message);

bool ant_desktop_platform_browser_running(ant_desktop_window_state_t *window);
void ant_desktop_platform_close(ant_desktop_window_state_t *window);
void ant_desktop_platform_show(ant_desktop_window_state_t *window);
void ant_desktop_platform_hide(ant_desktop_window_state_t *window);
void ant_desktop_platform_minimize(ant_desktop_window_state_t *window);
void ant_desktop_platform_restore(ant_desktop_window_state_t *window);
void ant_desktop_platform_maximize(ant_desktop_window_state_t *window);
void ant_desktop_platform_set_always_on_top(ant_desktop_window_state_t *window, bool enabled);
void ant_desktop_platform_set_title(ant_desktop_window_state_t *window, const char *title, size_t length);
void ant_desktop_platform_set_full_screen(ant_desktop_window_state_t *window, bool enabled);
void ant_desktop_platform_quit(void);
void ant_desktop_platform_shutdown_all_windows(void);
const char *ant_desktop_platform_resources_path(void);

#endif
