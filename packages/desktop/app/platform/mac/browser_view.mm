#import "browser_view.h"

static uint32_t ModifiersForEvent(NSEvent *event) {
  uint32_t modifiers = 0;
  NSEventModifierFlags flags = event.modifierFlags;
  if (flags & NSEventModifierFlagShift) modifiers |= ANT_DESKTOP_MODIFIER_SHIFT;
  if (flags & NSEventModifierFlagControl) modifiers |= ANT_DESKTOP_MODIFIER_CONTROL;
  if (flags & NSEventModifierFlagOption) modifiers |= ANT_DESKTOP_MODIFIER_ALT;
  if (flags & NSEventModifierFlagCommand) modifiers |= ANT_DESKTOP_MODIFIER_COMMAND;
  if (flags & NSEventModifierFlagCapsLock) modifiers |= ANT_DESKTOP_MODIFIER_CAPS_LOCK;
  if (flags & NSEventModifierFlagNumericPad) modifiers |= ANT_DESKTOP_MODIFIER_KEYPAD;
  switch (event.type) {
  case NSEventTypeLeftMouseDown:
  case NSEventTypeLeftMouseUp:
  case NSEventTypeLeftMouseDragged:
    modifiers |= ANT_DESKTOP_MODIFIER_LEFT_BUTTON;
    break;
  case NSEventTypeRightMouseDown:
  case NSEventTypeRightMouseUp:
  case NSEventTypeRightMouseDragged:
    modifiers |= ANT_DESKTOP_MODIFIER_RIGHT_BUTTON;
    break;
  case NSEventTypeOtherMouseDown:
  case NSEventTypeOtherMouseUp:
  case NSEventTypeOtherMouseDragged:
    modifiers |= ANT_DESKTOP_MODIFIER_MIDDLE_BUTTON;
    break;
  default:
    break;
  }
  return modifiers;
}

@implementation AntBrowserView

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (!self) return nil;
  _markedText = [[NSMutableAttributedString alloc] initWithString:@""];
  _selectedTextRange = NSMakeRange(0, 0);
  _nextInputSequence = 1;
  _trustedKeyEvents = [NSMutableDictionary dictionary];
  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.blackColor.CGColor;
  return self;
}

- (BOOL)isFlipped {
  return YES;
}
- (BOOL)acceptsFirstResponder {
  return YES;
}
- (BOOL)canBecomeKeyView {
  return YES;
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return self.acceptsFirstMouseOption;
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  for (NSTrackingArea *area in self.trackingAreas)
    [self removeTrackingArea:area];
  NSTrackingAreaOptions options =
    NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect;
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:options owner:self userInfo:nil]];
}

- (void)sendMessage:(ant_desktop_control_message_t *)message {
  if (!self.controlHandle) return;
  message->magic = ANT_DESKTOP_CONTROL_MAGIC;
  message->size = ANT_DESKTOP_CONTROL_HEADER_SIZE + message->text_length;
  @try {
    [self.controlHandle writeData:[NSData dataWithBytes:message length:message->size]];
  } @catch (NSException *exception) { self.controlHandle = nil; }
}

- (void)fillPosition:(ant_desktop_control_message_t *)message event:(NSEvent *)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  message->x = point.x;
  message->y = point.y;
  message->modifiers = ModifiersForEvent(event);
}

- (void)sendMouse:(NSEvent *)event type:(ant_desktop_control_type_t)type button:(uint32_t)button {
  ant_desktop_control_message_t message = {0};
  message.type = type;
  message.button = button;
  message.click_count = (uint32_t)event.clickCount;
  [self fillPosition:&message event:event];
  [self sendMessage:&message];
}

- (void)mouseDown:(NSEvent *)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  BOOL draggable = NO;
  for (NSDictionary *region in self.draggableRegions) {
    NSRect rect = [region[@"rect"] rectValue];
    if (NSPointInRect(point, rect)) draggable = [region[@"draggable"] boolValue];
  }
  if (draggable) {
    [self.window performWindowDragWithEvent:event];
    return;
  }
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_DOWN button:0];
}
- (void)mouseUp:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_UP button:0];
}
- (void)rightMouseDown:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_DOWN button:1];
}
- (void)rightMouseUp:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_UP button:1];
}
- (void)otherMouseDown:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_DOWN button:2];
}
- (void)otherMouseUp:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_UP button:2];
}

- (void)mouseMoved:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_MOVE button:0];
}
- (void)mouseDragged:(NSEvent *)event {
  [self mouseMoved:event];
}
- (void)rightMouseDragged:(NSEvent *)event {
  [self mouseMoved:event];
}
- (void)otherMouseDragged:(NSEvent *)event {
  [self mouseMoved:event];
}
- (void)mouseEntered:(NSEvent *)event {
  [self mouseMoved:event];
}
- (void)mouseExited:(NSEvent *)event {
  [self sendMouse:event type:ANT_DESKTOP_CONTROL_MOUSE_LEAVE button:0];
}

- (void)scrollWheel:(NSEvent *)event {
  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_SCROLL;
  message.delta_x = event.scrollingDeltaX;
  message.delta_y = event.scrollingDeltaY;
  [self fillPosition:&message event:event];
  [self sendMessage:&message];
}

- (void)sendKey:(NSEvent *)event type:(ant_desktop_control_type_t)type {
  ant_desktop_control_message_t message = {0};
  message.type = type;
  message.sequence = self.nextInputSequence++;
  message.key_code = event.keyCode;
  message.modifiers = ModifiersForEvent(event);
  NSData *text = [event.characters dataUsingEncoding:NSUTF8StringEncoding];
  message.text_length = (uint32_t)MIN(text.length, ANT_DESKTOP_CONTROL_TEXT_CAPACITY);
  if (message.text_length) memcpy(message.text, text.bytes, message.text_length);
  if (type == ANT_DESKTOP_CONTROL_KEY_DOWN) {
    self.trustedKeyEvents[@(message.sequence)] = event;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(),
                   ^{ [self.trustedKeyEvents removeObjectForKey:@(message.sequence)]; });
  }
  [self sendMessage:&message];
}

- (void)keyDown:(NSEvent *)event {
  [self sendKey:event type:ANT_DESKTOP_CONTROL_KEY_DOWN];
  [self.inputContext handleEvent:event];
}
- (void)keyUp:(NSEvent *)event {
  [self sendKey:event type:ANT_DESKTOP_CONTROL_KEY_UP];
}
- (void)flagsChanged:(NSEvent *)event {
  [self sendKey:event type:ANT_DESKTOP_CONTROL_KEY_DOWN];
}

- (BOOL)becomeFirstResponder {
  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_FOCUS;
  message.delta_x = 1;
  [self sendMessage:&message];
  return [super becomeFirstResponder];
}
- (BOOL)resignFirstResponder {
  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_FOCUS;
  message.delta_x = 0;
  [self sendMessage:&message];
  return [super resignFirstResponder];
}

- (void)sendResize {
  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_RESIZE;
  message.x = self.bounds.size.width;
  message.y = self.bounds.size.height;
  message.delta_x = self.window.backingScaleFactor;
  [self sendMessage:&message];
}
- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [self sendResize];
}

- (void)sendGesture:(NSEvent *)event type:(ant_desktop_control_type_t)type delta:(double)delta {
  ant_desktop_control_message_t message = {0};
  message.type = type;
  message.delta_y = delta;
  [self fillPosition:&message event:event];
  [self sendMessage:&message];
}
- (void)magnifyWithEvent:(NSEvent *)event {
  [self sendGesture:event type:ANT_DESKTOP_CONTROL_GESTURE_MAGNIFY delta:event.magnification];
}
- (void)rotateWithEvent:(NSEvent *)event {
  [self sendGesture:event type:ANT_DESKTOP_CONTROL_GESTURE_ROTATE delta:event.rotation];
}
- (void)swipeWithEvent:(NSEvent *)event {
  ant_desktop_control_message_t message = {0};
  message.type = ANT_DESKTOP_CONTROL_GESTURE_SWIPE;
  message.delta_x = event.deltaX;
  message.delta_y = event.deltaY;
  [self fillPosition:&message event:event];
  [self sendMessage:&message];
}

- (void)sendIme:(ant_desktop_control_type_t)type text:(NSString *)text selected:(NSRange)selected {
  ant_desktop_control_message_t message = {0};
  message.type = type;
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  message.text_length = (uint32_t)MIN(data.length, ANT_DESKTOP_CONTROL_TEXT_CAPACITY);
  if (message.text_length) memcpy(message.text, data.bytes, message.text_length);
  message.selection_start = (uint32_t)selected.location;
  message.selection_length = (uint32_t)selected.length;
  [self sendMessage:&message];
}

- (void)insertText:(id)string replacementRange:(NSRange)replacementRange {
  NSString *text = [string isKindOfClass:NSAttributedString.class] ? [string string] : string;
  [self sendIme:ANT_DESKTOP_CONTROL_IME_COMMIT text:text selected:NSMakeRange(0, 0)];
  [self.markedText.mutableString setString:@""];
}
- (void)setMarkedText:(id)string selectedRange:(NSRange)selectedRange replacementRange:(NSRange)replacementRange {
  NSAttributedString *marked =
    [string isKindOfClass:NSAttributedString.class] ? string : [[NSAttributedString alloc] initWithString:string];
  [self.markedText setAttributedString:marked];
  self.selectedTextRange = selectedRange;
  [self sendIme:ANT_DESKTOP_CONTROL_IME_SET text:marked.string selected:selectedRange];
}
- (void)unmarkText {
  [self sendIme:ANT_DESKTOP_CONTROL_IME_FINISH text:@"" selected:NSMakeRange(0, 0)];
  [self.markedText.mutableString setString:@""];
}
- (NSRange)selectedRange {
  return self.selectedTextRange;
}
- (NSRange)markedRange {
  return self.markedText.length ? NSMakeRange(0, self.markedText.length) : NSMakeRange(NSNotFound, 0);
}
- (BOOL)hasMarkedText {
  return self.markedText.length != 0;
}
- (NSArray<NSAttributedStringKey> *)validAttributesForMarkedText {
  return @[];
}
- (NSAttributedString *)attributedSubstringForProposedRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
  if (actualRange) *actualRange = NSMakeRange(NSNotFound, 0);
  return nil;
}
- (NSUInteger)characterIndexForPoint:(NSPoint)point {
  return NSNotFound;
}
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
  if (actualRange) *actualRange = range;
  NSRect rect = [self.window convertRectToScreen:[self convertRect:self.bounds toView:nil]];
  rect.size.height = MAX(1, self.window.backingScaleFactor);
  return rect;
}
- (void)doCommandBySelector:(SEL)selector {
  if ([self respondsToSelector:selector]) [self tryToPerform:selector with:self];
}

- (BOOL)performUnhandledKeySequence:(uint64_t)sequence {
  NSEvent *event = self.trustedKeyEvents[@(sequence)];
  if (!event) return NO;
  [self.trustedKeyEvents removeObjectForKey:@(sequence)];
  return [NSApp.mainMenu performKeyEquivalent:event];
}

- (void)runInputSmoke {
  const ant_desktop_control_type_t types[] = {
    ANT_DESKTOP_CONTROL_MOUSE_MOVE,      ANT_DESKTOP_CONTROL_MOUSE_DOWN,     ANT_DESKTOP_CONTROL_MOUSE_UP,
    ANT_DESKTOP_CONTROL_SCROLL,          ANT_DESKTOP_CONTROL_KEY_DOWN,       ANT_DESKTOP_CONTROL_KEY_UP,
    ANT_DESKTOP_CONTROL_IME_SET,         ANT_DESKTOP_CONTROL_IME_COMMIT,     ANT_DESKTOP_CONTROL_IME_FINISH,
    ANT_DESKTOP_CONTROL_GESTURE_MAGNIFY, ANT_DESKTOP_CONTROL_GESTURE_ROTATE, ANT_DESKTOP_CONTROL_GESTURE_SWIPE,
  };
  for (size_t index = 0; index < sizeof(types) / sizeof(types[0]); index++) {
    ant_desktop_control_message_t message = {0};
    message.type = types[index];
    message.x = 24;
    message.y = 24;
    message.delta_x = 1;
    message.delta_y = 1;
    message.sequence = self.nextInputSequence++;
    message.key_code = 0;
    message.click_count = 1;
    message.text[0] = 'a';
    message.text_length = 1;
    message.selection_length = 1;
    [self sendMessage:&message];
  }
}

@end
