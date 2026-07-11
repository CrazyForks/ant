#ifndef ANT_DESKTOP_MAC_WINDOW_H
#define ANT_DESKTOP_MAC_WINDOW_H

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include "../../core/window_state.h"
#include "browser_view.h"

@interface AntDesktopNSWindow : NSWindow
@property(nonatomic, assign) BOOL focusableOption;
@end

@interface AntDesktopWindow : NSObject <NSWindowDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTask *hostTask;
@property(nonatomic, strong) CALayer *remoteLayer;
@property(nonatomic, strong) NSMutableString *hostOutput;
@property(nonatomic, strong) AntBrowserView *browserView;
@property(nonatomic, assign) ant_desktop_window_state_t *state;
@end

extern NSMutableDictionary<NSNumber *, AntDesktopWindow *> *g_windows;

AntDesktopWindow *MacWindowForState(ant_desktop_window_state_t *state);

#endif
