#import <objc/message.h>
#import <objc/runtime.h>

#include "../platform.h"
#include "internal.h"

void AttachRemoteContext(ant_desktop_window_state_t *state, uint32_t context_id) {
  AntDesktopWindow *desktop_window = MacWindowForState(state);
  if (!desktop_window) return;
  Class layer_host_class = NSClassFromString(@"CALayerHost");
  SEL setter = sel_registerName("setContextId:");
  if (!layer_host_class || ![layer_host_class instancesRespondToSelector:setter]) {
    ant_desktop_reject_load(state, "CALayerHost is unavailable on this macOS version");
    return;
  }

  NSView *content_view = desktop_window.browserView;
  CALayer *remote_layer = [[layer_host_class alloc] init];
  remote_layer.anchorPoint = CGPointZero;
  remote_layer.position = CGPointZero;
  remote_layer.frame = content_view.bounds;
  remote_layer.contentsScale = desktop_window.window.backingScaleFactor;
  remote_layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  ((void (*)(id, SEL, uint32_t))objc_msgSend)(remote_layer, setter, context_id);

  [desktop_window.remoteLayer removeFromSuperlayer];
  desktop_window.remoteLayer = remote_layer;
  [content_view.layer addSublayer:remote_layer];

  if (state->show_when_ready) ant_desktop_platform_show(state);

  if (getenv("ANT_DESKTOP_INPUT_SMOKE")) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(),
                   ^{ [desktop_window.browserView runInputSmoke]; });
  }

  ant_desktop_resolve_load(state);
}
