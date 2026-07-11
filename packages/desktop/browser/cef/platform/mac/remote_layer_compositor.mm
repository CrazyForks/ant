#import <AppKit/AppKit.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>

#include <dlfcn.h>
#include <stdio.h>

#include "../../host_state.h"
#include "remote_layer_compositor.h"

typedef uint32_t CGSConnectionID;
typedef CGSConnectionID (*CGSMainConnectionIDFunction)(void);

@interface CAContext : NSObject
+ (instancetype)contextWithCGSConnection:(CGSConnectionID)connection options:(NSDictionary *)options;
@property(readonly) uint32_t contextId;
@property(strong) CALayer *layer;
@end

@interface CALayer (AntIOSurfaceContents)
- (void)setContentsChanged;
@end

CGSConnectionID GetMainConnectionID() {
  void *skylight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY | RTLD_LOCAL);
  if (!skylight) return 0;
  auto get_connection = reinterpret_cast<CGSMainConnectionIDFunction>(dlsym(skylight, "CGSMainConnectionID"));
  return get_connection ? get_connection() : 0;
}

class RemoteLayerCompositor {
public:
  bool Initialize() {
    root_layer_ = [CALayer layer];
    root_layer_.anchorPoint = CGPointZero;
    root_layer_.position = CGPointZero;
    root_layer_.frame = CGRectMake(0, 0, 960, 600);
    root_layer_.geometryFlipped = YES;
    root_layer_.opaque = !g_transparent;
    root_layer_.backgroundColor = g_transparent ? NSColor.clearColor.CGColor : NSColor.blackColor.CGColor;
    surface_layer_ = [CALayer layer];
    surface_layer_.anchorPoint = CGPointZero;
    surface_layer_.position = CGPointZero;
    surface_layer_.frame = root_layer_.bounds;
    surface_layer_.contentsGravity = kCAGravityTopLeft;
    surface_layer_.opaque = !g_transparent;
    [root_layer_ addSublayer:surface_layer_];

    Class context_class = NSClassFromString(@"CAContext");
    CGSConnectionID connection = GetMainConnectionID();
    if (!context_class || connection == 0) return false;
    context_ = [context_class contextWithCGSConnection:connection options:@{}];
    if (!context_) return false;
    context_.layer = root_layer_;
    [CATransaction flush];
    return true;
  }

  void Present(const CefAcceleratedPaintInfo &info) {
    @autoreleasepool {
      IOSurfaceRef surface = static_cast<IOSurfaceRef>(info.shared_texture_io_surface);
      if (!surface) return;
      NSUInteger width = IOSurfaceGetWidth(surface);
      NSUInteger height = IOSurfaceGetHeight(surface);
      if (!width || !height) return;

      if (!reported_first_frame_) {
        reported_first_frame_ = true;
        fprintf(stderr, "Chromium direct IOSurface frame: %lux%lu\n", static_cast<unsigned long>(width),
                static_cast<unsigned long>(height));
      }
      CGFloat scale = g_device_scale_factor > 0 ? g_device_scale_factor : 1;
      CGSize logical_size = CGSizeMake(width / scale, height / scale);
      [CATransaction begin];
      [CATransaction setDisableActions:YES];
      id contents = (__bridge id)surface;
      if (contents == surface_layer_.contents && [surface_layer_ respondsToSelector:@selector(setContentsChanged)]) {
        [surface_layer_ setContentsChanged];
      } else {
        surface_layer_.contents = contents;
      }
      surface_layer_.contentsScale = scale;
      surface_layer_.frame = CGRectMake(0, 0, logical_size.width, logical_size.height);
      root_layer_.frame = surface_layer_.frame;
      [CATransaction commit];

      if (!published_context_) {
        published_context_ = true;
        printf("%u\n", context_.contextId);
        fflush(stdout);
      }
    }
  }

  void Resize(int width, int height, float scale) {
    if (width <= 0 || height <= 0) return;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    root_layer_.frame = CGRectMake(0, 0, width, height);
    surface_layer_.frame = root_layer_.bounds;
    surface_layer_.contentsScale = scale > 0 ? scale : 1.0f;
    [CATransaction commit];
  }

private:
  CALayer *__strong root_layer_;
  CALayer *__strong surface_layer_;
  CAContext *__strong context_;
  bool reported_first_frame_ = false;
  bool published_context_ = false;
};

RemoteLayerCompositor g_compositor;

bool InitializeRemoteLayerCompositor() {
  return g_compositor.Initialize();
}

void PresentRemoteLayer(const CefAcceleratedPaintInfo &info) {
  g_compositor.Present(info);
}

void ResizeRemoteLayer(int width, int height, float scale) {
  g_compositor.Resize(width, height, scale);
}
