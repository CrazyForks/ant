#ifndef ANT_DESKTOP_BROWSER_VIEW_H
#define ANT_DESKTOP_BROWSER_VIEW_H

#import <AppKit/AppKit.h>

#include "../../../ipc/control.h"

@interface AntBrowserView : NSView <NSTextInputClient>
@property(nonatomic, strong) NSFileHandle *controlHandle;
@property(nonatomic, strong) NSMutableAttributedString *markedText;
@property(nonatomic, assign) NSRange selectedTextRange;
@property(nonatomic, assign) uint64_t nextInputSequence;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSEvent *> *trustedKeyEvents;
@property(nonatomic, assign) BOOL acceptsFirstMouseOption;
@property(nonatomic, copy) NSArray<NSDictionary *> *draggableRegions;
- (void)sendResize;
- (void)sendMessage:(ant_desktop_control_message_t *)message;
- (BOOL)performUnhandledKeySequence:(uint64_t)sequence;
- (void)runInputSmoke;
@end

#endif
