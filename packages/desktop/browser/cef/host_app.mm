#import <AppKit/AppKit.h>

#include "host_app.h"

#include <string>

#include "app_scheme.h"
#include "host_client.h"
#include "host_state.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/cef_request_context.h"
#include "include/wrapper/cef_helpers.h"

namespace {

class HostAppImpl : public CefApp, public CefBrowserProcessHandler {
public:
  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override {
    RegisterAntCustomSchemes(registrar);
  }

  void OnBeforeCommandLineProcessing(const CefString &process_type, CefRefPtr<CefCommandLine> command_line) override {
    if (!process_type.empty()) return;
    command_line->AppendSwitchWithValue("disable-features",
                                        "NativeNotifications,SystemNotifications,NewMacNotificationAPI");
    command_line->AppendSwitch("disable-notifications");
    command_line->AppendSwitch("use-mock-keychain");
    command_line->AppendSwitchWithValue("lang", "en-US");
  }

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }

  void OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> command_line) override {
    CefRefPtr<CefCommandLine> global = CefCommandLine::GetGlobalCommandLine();
    if (!global) return;
    std::string manifest = global->GetSwitchValue("ant-capabilities");
    if (!manifest.empty()) { command_line->AppendSwitchWithValue("ant-capabilities", manifest); }
  }

  void OnContextInitialized() override {
    CEF_REQUIRE_UI_THREAD();
    CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
    std::string url = command_line->GetSwitchValue("url");
    std::string app_root = command_line->GetSwitchValue("ant-app-root");
    if (!app_root.empty() && !RegisterAntAppSchemeHandler(app_root)) {
      fputs("failed to register ant://app scheme handler\n", stderr);
      CefQuitMessageLoop();
      return;
    }
    g_diagnostic_input = command_line->HasSwitch("diagnostic-input");
    if (url.empty()) {
      url = "data:text/html,<body style='background:%23101018;color:white'>"
            "<h1>Ant Chromium host</h1></body>";
    }

    parent_window_ = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, g_view_width, g_view_height)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
    parent_window_.releasedWhenClosed = NO;
    CefWindowInfo window_info;
    window_info.SetAsWindowless((__bridge void *)parent_window_.contentView);
    window_info.shared_texture_enabled = true;
    window_info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
    CefBrowserSettings browser_settings;
    browser_settings.background_color = g_transparent ? CefColorSetARGB(0, 0, 0, 0) : CefColorSetARGB(255, 8, 10, 18);
    client_ = CreateHostClient(command_line->GetSwitchValue("ant-capabilities"));
    // Each Ant browser host process has its own temporary root, so the global
    // context is still an isolated in-memory profile. CEF DevTools requires
    // this profile identity to match the Chrome-style inspector browser.
    request_context_ = CefRequestContext::GetGlobalContext();
    CefBrowserHost::CreateBrowser(window_info, client_, url, browser_settings, nullptr, request_context_);
    StartHostControlPipe(client_);
  }

private:
  CefRefPtr<HostClient> client_;
  CefRefPtr<CefRequestContext> request_context_;
  NSWindow *__strong parent_window_;
  IMPLEMENT_REFCOUNTING(HostAppImpl);
};

} // namespace

CefRefPtr<CefApp> CreateHostApp() {
  return new HostAppImpl;
}
