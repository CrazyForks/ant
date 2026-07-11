#ifndef ANT_DESKTOP_INTERNAL_H
#define ANT_DESKTOP_INTERNAL_H

#include "../../api/desktop_core.h"
#include "window.h"

#ifndef ANT_DESKTOP_DEFAULT_HOST
#define ANT_DESKTOP_DEFAULT_HOST ""
#endif

extern NSMutableArray *g_menu_targets;
void AttachRemoteContext(ant_desktop_window_state_t *window, uint32_t context_id);
BOOL OptionBool(ant_t *js, ant_value_t options, const char *name, BOOL fallback);
double OptionNumber(ant_t *js, ant_value_t options, const char *name, double fallback);
NSString *OptionString(ant_t *js, ant_value_t options, const char *name);
NSString *CapabilityManifest(ant_t *js, ant_value_t options, NSString **error);
NSColor *ColorFromHex(NSString *value);

#endif
