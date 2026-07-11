#import <Foundation/Foundation.h>

#include <stdio.h>
#include <stdlib.h>
#include <string>

#include "host_app.h"
#include "host_state.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_library_loader.h"
#include "platform/mac/application.h"
#include "platform/mac/remote_layer_compositor.h"

int main(int argc, char *argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) return 1;
  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    CefRefPtr<CefCommandLine> launch_command_line = CefCommandLine::CreateCommandLine();
    launch_command_line->InitFromArgv(argc, argv);
    g_transparent = launch_command_line->HasSwitch("transparent");
    InitializeHostApplication();
    if (!InitializeRemoteLayerCompositor()) {
      fputs("failed to initialize remote Core Animation compositor\n", stderr);
      return 1;
    }

    CefSettings settings;
    settings.no_sandbox = true;
    settings.windowless_rendering_enabled = true;
    settings.background_color = g_transparent ? CefColorSetARGB(0, 0, 0, 0) : CefColorSetARGB(255, 8, 10, 18);
    char ephemeral_root_template[] = "/tmp/ant-chromium-XXXXXX";
    char *ephemeral_root = mkdtemp(ephemeral_root_template);
    if (!ephemeral_root) {
      fputs("failed to create ephemeral Chromium root\n", stderr);
      return 1;
    }
    CefString(&settings.root_cache_path) = ephemeral_root;

    std::string cache_path = launch_command_line->GetSwitchValue("cache-path");
    if (!cache_path.empty()) CefString(&settings.root_cache_path) = cache_path;

    CefRefPtr<CefApp> app = CreateHostApp();
    if (!CefInitialize(main_args, settings, app.get(), nullptr)) { return CefGetExitCode(); }
    CefRunMessageLoop();
    CefShutdown();
    [[NSFileManager defaultManager] removeItemAtPath:[NSString stringWithUTF8String:ephemeral_root] error:nil];
  }
  return 0;
}
