#include "application.h"
#import <AppKit/AppKit.h>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_helpers.h"

@interface AntChromiumHostApplication : NSApplication <CefAppProtocol> {
@private
  BOOL handlingSendEvent_;
}
@end

@implementation AntChromiumHostApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}
- (void)setHandlingSendEvent:(BOOL)value {
  handlingSendEvent_ = value;
}
- (void)sendEvent:(NSEvent *)event {
  CefScopedSendingEvent sending_event;
  [super sendEvent:event];
}
- (void)terminate:(id)sender {
  CefQuitMessageLoop();
}
@end

void InitializeHostApplication() {
  [AntChromiumHostApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
}

void ShowHostApplication() {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  [NSApp activateIgnoringOtherApps:YES];
}

void HideHostApplication() {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
}
