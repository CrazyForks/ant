#include "internal.h"

#include "../platform.h"
#include <errno.h>
#include <float.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

ant_value_t DesktopBrowserWindowCtor(ant_t *js, ant_value_t *args, int nargs) {
  ant_value_t receiver = js_getthis(js);
  ant_desktop_state_t *desktop = is_object_type(receiver) ? ant_desktop_state_from(js_get_proto(js, receiver)) : NULL;
  if (!desktop) return js_mkerr(js, "invalid BrowserWindow constructor");
  NSInteger width = 900;
  NSInteger height = 600;
  NSString *title = @"Ant Desktop";
  ant_value_t options = nargs > 0 ? args[0] : js_mkundef();
  BOOL framed = OptionBool(js, options, "frame", YES);
  BOOL closable = OptionBool(js, options, "closable", YES);
  BOOL minimizable = OptionBool(js, options, "minimizable", YES);
  BOOL resizable = OptionBool(js, options, "resizable", YES);
  BOOL maximizable = OptionBool(js, options, "maximizable", YES);
  BOOL transparent = OptionBool(js, options, "transparent", NO);
  BOOL show = OptionBool(js, options, "show", YES);
  BOOL always_on_top = OptionBool(js, options, "alwaysOnTop", NO);
  BOOL focusable = OptionBool(js, options, "focusable", YES);
  NSString *title_bar_style = OptionString(js, options, "titleBarStyle");
  NSString *vibrancy = OptionString(js, options, "vibrancy");
  NSString *background = OptionString(js, options, "backgroundColor");
  NSString *border_color = OptionString(js, options, "borderColor");
  double border_width = MAX(0, OptionNumber(js, options, "borderWidth", 0));
  double corner_radius = MAX(0, OptionNumber(js, options, "cornerRadius", 10));
  ant_value_t title_bar_overlay = is_object_type(options) ? js_get(js, options, "titleBarOverlay") : js_mkundef();
  BOOL overlay_enabled =
    is_object_type(title_bar_overlay) || (vtype(title_bar_overlay) == T_BOOL && js_truthy(js, title_bar_overlay));
  NSString *capability_error = nil;
  NSString *capability_manifest = CapabilityManifest(js, options, &capability_error);
  if (!capability_manifest) { return js_mkerr(js, "%s", capability_error.UTF8String); }

  if (nargs > 0 && is_object_type(args[0])) {
    ant_value_t value = js_get(js, args[0], "width");
    if (vtype(value) == T_NUM && js_getnum(value) > 0) width = js_getnum(value);
    value = js_get(js, args[0], "height");
    if (vtype(value) == T_NUM && js_getnum(value) > 0) height = js_getnum(value);
    value = js_get(js, args[0], "title");
    if (vtype(value) == T_STR) {
      size_t length = 0;
      const char *text = js_getstr(js, value, &length);
      title = [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding];
    }
  }

  NSWindowStyleMask style = framed ? NSWindowStyleMaskTitled : NSWindowStyleMaskBorderless;
  if (closable && framed) style |= NSWindowStyleMaskClosable;
  if (minimizable && framed) style |= NSWindowStyleMaskMiniaturizable;
  if (resizable) style |= NSWindowStyleMaskResizable;
  BOOL inline_titlebar = [title_bar_style isEqualToString:@"hidden"] ||
                         [title_bar_style isEqualToString:@"hiddenInset"] ||
                         [title_bar_style isEqualToString:@"customButtonsOnHover"] || overlay_enabled;
  if (inline_titlebar) style |= NSWindowStyleMaskFullSizeContentView;
  AntDesktopNSWindow *window = [[AntDesktopNSWindow alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
                                                                     styleMask:style
                                                                       backing:NSBackingStoreBuffered
                                                                         defer:NO];
  window.focusableOption = focusable;
  window.title = title;
  window.releasedWhenClosed = NO;
  window.movable = OptionBool(js, options, "movable", YES);
  window.hasShadow = OptionBool(js, options, "hasShadow", YES);
  window.opaque = !transparent;
  window.backgroundColor = transparent ? NSColor.clearColor : (ColorFromHex(background) ?: NSColor.blackColor);
  window.level = always_on_top ? NSFloatingWindowLevel : NSNormalWindowLevel;
  window.alphaValue = MIN(1, MAX(0, OptionNumber(js, options, "opacity", 1)));
  window.minSize =
    NSMakeSize(MAX(0, OptionNumber(js, options, "minWidth", 0)), MAX(0, OptionNumber(js, options, "minHeight", 0)));
  double max_width = OptionNumber(js, options, "maxWidth", DBL_MAX);
  double max_height = OptionNumber(js, options, "maxHeight", DBL_MAX);
  window.maxSize = NSMakeSize(max_width > 0 ? max_width : DBL_MAX, max_height > 0 ? max_height : DBL_MAX);
  if (OptionBool(js, options, "contentProtection", NO)) { window.sharingType = NSWindowSharingNone; }
  if (OptionBool(js, options, "visibleOnAllWorkspaces", NO)) {
    window.collectionBehavior |= NSWindowCollectionBehaviorCanJoinAllSpaces;
  }
  if (OptionBool(js, options, "hiddenInMissionControl", NO) || OptionBool(js, options, "skipTaskbar", NO)) {
    window.collectionBehavior |= NSWindowCollectionBehaviorTransient;
    window.excludedFromWindowsMenu = YES;
  }
  NSString *tabbing_identifier = OptionString(js, options, "tabbingIdentifier");
  if (tabbing_identifier.length) window.tabbingIdentifier = tabbing_identifier;
  if (!maximizable) { [window standardWindowButton:NSWindowZoomButton].enabled = NO; }
  if (!OptionBool(js, options, "fullscreenable", YES)) {
    window.collectionBehavior |= NSWindowCollectionBehaviorFullScreenNone;
  }
  if (inline_titlebar) {
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    if (@available(macOS 11.0, *)) window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
  }
  AntBrowserView *browser_view = [[AntBrowserView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
  browser_view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  browser_view.acceptsFirstMouseOption = OptionBool(js, options, "acceptFirstMouse", NO);
  if (transparent || vibrancy) browser_view.layer.backgroundColor = NSColor.clearColor.CGColor;
  if (vibrancy) {
    NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
    effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    NSString *visual_effect_state = OptionString(js, options, "visualEffectState");
    if ([visual_effect_state isEqualToString:@"active"]) {
      effect.state = NSVisualEffectStateActive;
    } else if ([visual_effect_state isEqualToString:@"inactive"]) {
      effect.state = NSVisualEffectStateInactive;
    } else {
      effect.state = NSVisualEffectStateFollowsWindowActiveState;
    }
    if ([vibrancy isEqualToString:@"sidebar"]) effect.material = NSVisualEffectMaterialSidebar;
    else if ([vibrancy isEqualToString:@"menu"]) effect.material = NSVisualEffectMaterialMenu;
    else if ([vibrancy isEqualToString:@"popover"]) effect.material = NSVisualEffectMaterialPopover;
    else if ([vibrancy isEqualToString:@"under-window"]) effect.material = NSVisualEffectMaterialUnderWindowBackground;
    else effect.material = NSVisualEffectMaterialWindowBackground;
    [effect addSubview:browser_view];
    window.contentView = effect;
  } else {
    window.contentView = browser_view;
  }
  window.contentView.wantsLayer = YES;
  if (border_width > 0) {
    window.contentView.layer.borderWidth = border_width;
    window.contentView.layer.borderColor = (ColorFromHex(border_color) ?: NSColor.separatorColor).CGColor;
  }
  if (!framed || OptionBool(js, options, "roundedCorners", YES)) {
    window.contentView.layer.cornerRadius = corner_radius;
    window.contentView.layer.masksToBounds = YES;
  }

  ant_value_t traffic_light_position =
    is_object_type(options) ? js_get(js, options, "trafficLightPosition") : js_mkundef();
  if (is_object_type(traffic_light_position)) {
    double traffic_x = OptionNumber(js, traffic_light_position, "x", 12);
    double traffic_y = OptionNumber(js, traffic_light_position, "y", 12);
    NSButton *close_button = [window standardWindowButton:NSWindowCloseButton];
    NSButton *mini_button = [window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *zoom_button = [window standardWindowButton:NSWindowZoomButton];
    if (close_button && mini_button && zoom_button) {
      CGFloat spacing = mini_button.frame.origin.x - close_button.frame.origin.x;
      CGFloat top = close_button.superview.bounds.size.height - traffic_y - close_button.frame.size.height;
      [close_button setFrameOrigin:NSMakePoint(traffic_x, top)];
      [mini_button setFrameOrigin:NSMakePoint(traffic_x + spacing, top)];
      [zoom_button setFrameOrigin:NSMakePoint(traffic_x + spacing * 2, top)];
    }
  }

  AntDesktopWindow *desktop_window = [AntDesktopWindow new];
  desktop_window.window = window;
  desktop_window.browserView = browser_view;
  desktop_window.hostOutput = [NSMutableString string];
  const char *capability_text = capability_manifest.UTF8String ?: "";
  ant_desktop_window_state_t *state = ant_desktop_window_create(js, desktop, capability_text, strlen(capability_text),
                                                                transparent || vibrancy.length > 0);
  if (!state) {
    [window close];
    return js_mkerr(js, "failed to allocate BrowserWindow state");
  }
  desktop_window.state = state;
  state->show_when_ready = show;
  state->platform_data = (__bridge void *)desktop_window;
  window.delegate = desktop_window;

  ant_desktop_window_id_t identifier = state->identifier;
  g_windows[@(identifier)] = desktop_window;

  double x = OptionNumber(js, options, "x", NAN);
  double y = OptionNumber(js, options, "y", NAN);
  if (isfinite(x) || isfinite(y)) {
    NSScreen *screen = window.screen ?: NSScreen.mainScreen;
    NSRect frame = window.frame;
    NSRect visible = screen.visibleFrame;
    if (isfinite(x)) frame.origin.x = visible.origin.x + x;
    if (isfinite(y)) { frame.origin.y = NSMaxY(visible) - y - frame.size.height; }
    [window setFrameOrigin:frame.origin];
  } else if (OptionBool(js, options, "center", YES)) {
    [window center];
  }
  if (OptionBool(js, options, "fullscreen", NO)) { [window toggleFullScreen:nil]; }

  ant_value_t object = js_getthis(js);
  if (!is_object_type(object)) object = js_newobj(js);
  ant_value_t proto = js_instance_proto_from_new_target(js, desktop->browser_window_proto);
  if (is_object_type(proto)) js_set_proto_init(object, proto);
  js_set(js, object, "_nativeId", js_mknum((double)identifier));
  js_set(js, object, "_events", js_mkobj(js));
  ant_value_t web_contents = js_mkobj(js);
  js_set(js, web_contents, "_nativeId", js_mknum((double)identifier));
  js_set(js, web_contents, "openDevTools", js_mkfun(DesktopWebContentsOpenDevTools));
  js_set(js, web_contents, "closeDevTools", js_mkfun(DesktopWebContentsCloseDevTools));
  js_set(js, web_contents, "toggleDevTools", js_mkfun(DesktopWebContentsToggleDevTools));
  js_set(js, web_contents, "inspectElement", js_mkfun(DesktopWebContentsInspectElement));
  js_set(js, web_contents, "isDevToolsOpened", js_mkfun(DesktopWebContentsIsDevToolsOpened));
  js_set(js, web_contents, "reload", js_mkfun(DesktopWebContentsReload));
  js_set(js, web_contents, "send", js_mkfun(DesktopWebContentsSend));
  js_set(js, object, "webContents", web_contents);
  char object_key[32];
  ant_desktop_window_key(identifier, object_key);
  ant_desktop_state_attach(object, desktop);
  ant_desktop_state_attach(web_contents, desktop);
  js_set(js, desktop->window_objects, object_key, object);
  if (nargs > 0 && is_object_type(args[0])) {
    ant_value_t web_preferences = js_get(js, args[0], "webPreferences");
    if (is_object_type(web_preferences)) {
      ant_value_t capabilities = js_get(js, web_preferences, "capabilities");
      if (vtype(capabilities) != T_UNDEF) { js_set(js, object, "preloadCapabilities", capabilities); }
    }
  }
  return object;
}

NSString *HostExecutablePath(void) {
  const char *configured = getenv("ANT_CHROMIUM_HOST");
  if (configured && configured[0]) { return [NSString stringWithUTF8String:configured]; }
  NSString *bundled_host =
    [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/MacOS/Ant Chromium Host"];
  if ([[NSFileManager defaultManager] isExecutableFileAtPath:bundled_host]) { return bundled_host; }
  if (ANT_DESKTOP_DEFAULT_HOST[0]) { return [NSString stringWithUTF8String:ANT_DESKTOP_DEFAULT_HOST]; }
  return nil;
}

ant_value_t LoadURL(ant_t *js, ant_desktop_window_state_t *state, NSString *url, NSString *app_root) {
  AntDesktopWindow *desktop_window = MacWindowForState(state);
  if (ant_desktop_platform_browser_running(state)) {
    return js_mkerr(js, "this BrowserWindow already has a Chromium host");
  }

  NSString *host_path = HostExecutablePath();
  if (!host_path.length || ![[NSFileManager defaultManager] isExecutableFileAtPath:host_path]) {
    return js_mkerr(
      js, "Chromium host is missing; run packages/desktop/scripts/build-browser-host.cjs or set ANT_CHROMIUM_HOST");
  }

  ant_value_t promise = js_mkpromise(js);
  state->load_promise = promise;
  state->load_pending = true;
  [desktop_window.hostOutput setString:@""];

  NSTask *task = [NSTask new];
  NSPipe *stdout_pipe = [NSPipe pipe];
  NSPipe *stderr_pipe = [NSPipe pipe];
  NSPipe *stdin_pipe = [NSPipe pipe];
  task.executableURL = [NSURL fileURLWithPath:host_path];
  NSMutableArray<NSString *> *arguments = [NSMutableArray arrayWithObject:[NSString stringWithFormat:@"--url=%@", url]];
  if (app_root.length) { [arguments addObject:[NSString stringWithFormat:@"--ant-app-root=%@", app_root]]; }
  if (state->capability_manifest_length > 0) {
    [arguments addObject:[NSString stringWithFormat:@"--ant-capabilities=%@",
                                                    [NSString stringWithUTF8String:state->capability_manifest]]];
  }
  if (state->transparent_browser) [arguments addObject:@"--transparent"];
  if (getenv("ANT_DESKTOP_INPUT_SMOKE")) { [arguments addObject:@"--diagnostic-input"]; }
  task.arguments = arguments;
  task.standardOutput = stdout_pipe;
  task.standardError = stderr_pipe;
  task.standardInput = stdin_pipe;
  desktop_window.hostTask = task;

  __weak AntDesktopWindow *weak_window = desktop_window;
  stdout_pipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length == 0) return;
    NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    dispatch_async(dispatch_get_main_queue(), ^{
      AntDesktopWindow *strong_window = weak_window;
      if (!strong_window || !chunk) return;
      ant_desktop_window_state_t *state = strong_window.state;
      if (!state) return;
      [strong_window.hostOutput appendString:chunk];
      for (;;) {
        NSRange newline = [strong_window.hostOutput rangeOfString:@"\n"];
        if (newline.location == NSNotFound) break;
        NSString *line = [[strong_window.hostOutput substringToIndex:newline.location]
          stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        [strong_window.hostOutput deleteCharactersInRange:NSMakeRange(0, NSMaxRange(newline))];
        if ([line hasPrefix:@"EVENT\t"]) {
          NSArray<NSString *> *parts = [line componentsSeparatedByString:@"\t"];
          if (parts.count >= 3) {
            if ([parts[1] isEqualToString:@"devtools-opened"]) {
              state->devtools_open = true;
            } else if ([parts[1] isEqualToString:@"devtools-closed"]) {
              state->devtools_open = false;
            }
            NSString *encoded_detail = parts.count >= 4 ? parts[3] : @"";
            NSString *detail = [encoded_detail stringByRemovingPercentEncoding] ?: encoded_detail;
            const char *detail_text = detail.UTF8String ?: "";
            ant_desktop_emit_window_event(state, parts[1].UTF8String, detail_text, strlen(detail_text),
                                          parts[2].integerValue);
          }
          continue;
        }
        if ([line hasPrefix:@"IPC\t"]) {
          NSArray<NSString *> *parts = [line componentsSeparatedByString:@"\t"];
          if (parts.count == 5) {
            NSString *channel = [parts[3] stringByRemovingPercentEncoding];
            NSString *payload = [parts[4] stringByRemovingPercentEncoding];
            if (channel && payload) {
              const char *channel_text = channel.UTF8String ?: "";
              const char *payload_text = payload.UTF8String ?: "";
              ant_desktop_dispatch_renderer_ipc(state, parts[1].integerValue, strtoull(parts[2].UTF8String, NULL, 10),
                                                channel_text, strlen(channel_text), payload_text, strlen(payload_text));
              continue;
            }
          }
          fprintf(stderr, "invalid Chromium IPC message: %s\n", line.UTF8String);
          continue;
        }
        if ([line hasPrefix:@"DRAGGABLE\t"]) {
          NSMutableArray<NSDictionary *> *regions = [NSMutableArray array];
          NSString *payload = [line substringFromIndex:10];
          for (NSString *item in [payload componentsSeparatedByString:@";"]) {
            if (!item.length) continue;
            NSArray<NSString *> *values = [item componentsSeparatedByString:@","];
            if (values.count != 5) continue;
            NSRect rect =
              NSMakeRect(values[0].doubleValue, values[1].doubleValue, values[2].doubleValue, values[3].doubleValue);
            [regions addObject:@{
              @"rect" : [NSValue valueWithRect:rect],
              @"draggable" : @(values[4].boolValue),
            }];
          }
          strong_window.browserView.draggableRegions = regions;
          continue;
        }
        if ([line hasPrefix:@"UNHANDLED "]) {
          uint64_t sequence = strtoull([line substringFromIndex:10].UTF8String, NULL, 10);
          [strong_window.browserView performUnhandledKeySequence:sequence];
          if (getenv("ANT_DESKTOP_INPUT_SMOKE")) {
            fprintf(stderr, "Ant unhandled input returned: %llu\n", (unsigned long long)sequence);
          }
          continue;
        }
        NSInteger context_id = line.integerValue;
        if (context_id > 0 && !strong_window.remoteLayer) {
          AttachRemoteContext(state, (uint32_t)context_id);
        } else if (state->load_pending) {
          NSString *message = [NSString stringWithFormat:@"invalid Chromium host message: %@", line];
          ant_desktop_reject_load(state, message.UTF8String ?: "invalid Chromium host message");
        }
      }
    });
  };

  stderr_pipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length) fwrite(data.bytes, 1, data.length, stderr);
  };

  task.terminationHandler = ^(NSTask *terminated) {
    dispatch_async(dispatch_get_main_queue(), ^{
      AntDesktopWindow *strong_window = weak_window;
      if (!strong_window) return;
      ant_desktop_window_state_t *state = strong_window.state;
      if (!state) return;
      ant_desktop_emit_window_event(state, terminated.terminationStatus == 0 ? "browser-exit" : "browser-crash", "", 0,
                                    terminated.terminationStatus);
      NSString *message =
        [NSString stringWithFormat:@"Chromium host exited with status %d", terminated.terminationStatus];
      ant_desktop_reject_load(state, message.UTF8String ?: "Chromium host exited");
    });
  };

  NSError *launch_error = nil;
  if (![task launchAndReturnError:&launch_error]) {
    desktop_window.hostTask = nil;
    ant_desktop_reject_load(state, launch_error.localizedDescription.UTF8String ?: "launch failed");
  } else {
    desktop_window.browserView.controlHandle = stdin_pipe.fileHandleForWriting;
    [desktop_window.browserView sendResize];
    [desktop_window.window makeFirstResponder:desktop_window.browserView];
  }
  return promise;
}

ant_value_t DesktopBrowserWindowLoadURL(ant_t *js, ant_value_t *args, int nargs) {
  ant_desktop_window_state_t *state = ant_desktop_window_from_value(js, js_getthis(js));
  if (!state) return js_mkerr(js, "invalid BrowserWindow receiver");
  if (nargs < 1 || vtype(args[0]) != T_STR) { return js_mkerr(js, "loadURL(url) requires a string"); }
  size_t length = 0;
  const char *text = js_getstr(js, args[0], &length);
  NSString *url = [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding];
  return LoadURL(js, state, url, nil);
}

ant_value_t DesktopBrowserWindowLoadFile(ant_t *js, ant_value_t *args, int nargs) {
  ant_desktop_window_state_t *state = ant_desktop_window_from_value(js, js_getthis(js));
  if (!state) return js_mkerr(js, "invalid BrowserWindow receiver");
  if (nargs < 1 || vtype(args[0]) != T_STR) { return js_mkerr(js, "loadFile(path) requires a string"); }
  size_t length = 0;
  const char *text = js_getstr(js, args[0], &length);
  NSString *path = [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding];
  if (!path.isAbsolutePath) {
    path = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:path];
  }
  path = path.stringByStandardizingPath;
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
    return js_mkerr(js, "file does not exist: %s", path.UTF8String);
  }
  NSString *root = path.stringByDeletingLastPathComponent;
  NSString *entry = [path.lastPathComponent
    stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLPathAllowedCharacterSet];
  return LoadURL(js, state, [NSString stringWithFormat:@"ant://app/%@", entry], root);
}
