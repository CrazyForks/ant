#include "host_client.h"

#include <algorithm>
#include <chrono>
#include <errno.h>
#include <stdio.h>
#include <string>
#include <thread>
#include <unistd.h>
#include <unordered_map>

#include "../../ipc/capabilities.h"
#include "host_state.h"
#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/cef_display_handler.h"
#include "include/cef_drag_handler.h"
#include "include/cef_keyboard_handler.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"
#include "include/cef_parser.h"
#include "include/cef_permission_handler.h"
#include "include/cef_render_handler.h"
#include "include/cef_request_handler.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "input.h"
#include "ipc.h"
#include "platform/mac/application.h"
#include "platform/mac/remote_layer_compositor.h"

namespace {

class HostClientImpl : public HostClient,
                       public CefRenderHandler,
                       public CefLifeSpanHandler,
                       public CefLoadHandler,
                       public CefKeyboardHandler,
                       public CefDisplayHandler,
                       public CefDragHandler,
                       public CefPermissionHandler,
                       public CefRequestHandler {
public:
  explicit HostClientImpl(const std::string &capability_manifest)
      : capabilities_(ant::desktop::ParseCapabilities(capability_manifest)) {}

  CefRefPtr<CefRenderHandler> GetRenderHandler() override {
    return this;
  }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override {
    return this;
  }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override {
    return this;
  }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override {
    return this;
  }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override {
    return this;
  }
  CefRefPtr<CefDragHandler> GetDragHandler() override {
    return this;
  }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override {
    return this;
  }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override {
    return this;
  }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    if (source_process != PID_RENDERER || message->GetName() != "ant.ipc" || !frame || !frame->IsMain()) return false;
    CefRefPtr<CefListValue> values = message->GetArgumentList();
    if (!values || values->GetSize() < 4) return true;
    int operation = values->GetInt(0);
    double request_id = values->GetDouble(1);
    std::string channel = values->GetString(2);
    std::string payload = values->GetString(3);
    const char *access = operation == 0 ? "send" : operation == 1 ? "invoke" : nullptr;
    if (!access || channel.empty() || !capabilities_.contains(std::string(access) + ":" + channel)) {
      if (operation == 1) {
        SendRendererIpc(
          browser, 1, request_id, "",
          R"({"version":1,"value":{"t":"err","id":1,"n":"SecurityError","m":"IPC capability denied","s":""}})");
      }
      return true;
    }
    std::string encoded_channel = CefURIEncode(channel, false).ToString();
    std::string encoded_payload = CefURIEncode(payload, false).ToString();
    printf("IPC\t%d\t%.0f\t%s\t%s\n", operation, request_id, encoded_channel.c_str(), encoded_payload.c_str());
    fflush(stdout);
    return true;
  }

  void GetViewRect(CefRefPtr<CefBrowser> browser, CefRect &rect) override {
    rect = CefRect(0, 0, g_view_width, g_view_height);
  }

  bool GetScreenInfo(CefRefPtr<CefBrowser> browser, CefScreenInfo &screen_info) override {
    screen_info.device_scale_factor = g_device_scale_factor;
    screen_info.depth = 24;
    screen_info.depth_per_component = 8;
    screen_info.is_monochrome = false;
    screen_info.rect = CefRect(0, 0, g_view_width, g_view_height);
    screen_info.available_rect = screen_info.rect;
    return true;
  }

  void OnPaint(CefRefPtr<CefBrowser> browser, PaintElementType type, const RectList &dirty_rects, const void *buffer,
               int width, int height) override {
    if (!software_paint_reported_) {
      software_paint_reported_ = true;
      fputs("CEF fell back to software painting\n", stderr);
    }
  }

  void OnAcceleratedPaint(CefRefPtr<CefBrowser> browser, PaintElementType type, const RectList &dirty_rects,
                          const CefAcceleratedPaintInfo &info) override {
    if (type == PET_VIEW) PresentRemoteLayer(info);
  }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    if (!browser_) {
      browser_ = browser;
    } else {
      devtools_browser_ = browser;
      EmitHostEvent("devtools-opened", 0, "");
    }
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    CEF_REQUIRE_UI_THREAD();
    if (browser == devtools_browser_) {
      devtools_browser_ = nullptr;
      HideHostApplication();
      EmitHostEvent("devtools-closed", 0, "");
      return;
    }
    if (browser != browser_) return;
    browser_ = nullptr;
    CefQuitMessageLoop();
  }

  void OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser, CefWindowInfo &window_info, CefRefPtr<CefClient> &client,
                             CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra_info,
                             bool *use_default_window) override {
    CEF_REQUIRE_UI_THREAD();
    ShowHostApplication();
    *use_default_window = true;
    EmitHostEvent("devtools-opened", 0, "");
  }

  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool is_loading, bool can_go_back,
                            bool can_go_forward) override {
    EmitHostEvent(is_loading ? "loading" : "ready", 0, browser->GetMainFrame()->GetURL());
  }

  void OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, TransitionType transition_type) override {
    if (frame->IsMain()) EmitHostEvent("navigation-start", 0, frame->GetURL());
  }

  void OnLoadEnd(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int http_status_code) override {
    if (frame->IsMain()) {
      EmitHostEvent("navigation-commit", http_status_code, frame->GetURL());
      fprintf(stderr, "Chromium rendered %s\n", frame->GetURL().ToString().c_str());
    }
  }

  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode error_code,
                   const CefString &error_text, const CefString &failed_url) override {
    if (error_code != ERR_ABORTED) {
      EmitHostEvent("navigation-error", static_cast<int>(error_code), failed_url);
      fprintf(stderr, "Chromium failed to load %s: %s (%d)\n", failed_url.ToString().c_str(),
              error_text.ToString().c_str(), static_cast<int>(error_code));
    }
  }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString &title) override {
    EmitHostEvent("title", 0, title);
  }

  void OnDraggableRegionsChanged(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                 const std::vector<CefDraggableRegion> &regions) override {
    if (!frame || !frame->IsMain()) return;
    fputs("DRAGGABLE\t", stdout);
    for (size_t index = 0; index < regions.size(); index++) {
      const CefDraggableRegion &region = regions[index];
      if (index) fputc(';', stdout);
      fprintf(stdout, "%d,%d,%d,%d,%d", region.bounds.x, region.bounds.y, region.bounds.width, region.bounds.height,
              region.draggable ? 1 : 0);
    }
    fputc('\n', stdout);
    fflush(stdout);
  }

  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int error_code,
                                 const CefString &error_string) override {
    EmitHostEvent("renderer-crash", error_code, error_string);
  }

  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &requesting_origin,
                              uint32_t requested_permissions,
                              CefRefPtr<CefPermissionPromptCallback> callback) override {
    EmitHostEvent("permission-request", static_cast<int>(requested_permissions), requesting_origin);
    callback->Continue(CEF_PERMISSION_RESULT_DENY);
    return true;
  }

  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                      const CefString &requesting_origin, uint32_t requested_permissions,
                                      CefRefPtr<CefMediaAccessCallback> callback) override {
    EmitHostEvent("permission-request", static_cast<int>(requested_permissions), requesting_origin);
    callback->Cancel();
    return true;
  }

  bool OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) override {
    auto found = trusted_key_sequences_.find(event.native_key_code);
    if (found == trusted_key_sequences_.end()) return false;
    auto age = std::chrono::steady_clock::now() - found->second.second;
    if (age > std::chrono::seconds(1)) {
      trusted_key_sequences_.erase(found);
      return false;
    }
    printf("UNHANDLED %llu\n", static_cast<unsigned long long>(found->second.first));
    fflush(stdout);
    trusted_key_sequences_.erase(found);
    return true;
  }

  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                     bool *is_keyboard_shortcut) override {
    auto found = trusted_key_sequences_.find(event.native_key_code);
    if (found != trusted_key_sequences_.end()) { *is_keyboard_shortcut = true; }
    return false;
  }

  void HandleControl(ant_desktop_control_message_t message) override {
    CEF_REQUIRE_UI_THREAD();
    if (!browser_) return;
    if (g_diagnostic_input) {
      fprintf(stderr, "Ant input forwarded: %u\n", message.type);
      fflush(stderr);
    }
    CefRefPtr<CefBrowserHost> host = browser_->GetHost();
    if (HandleBrowserInput(browser_, message, trusted_key_sequences_)) return;
    switch (message.type) {
    case ANT_DESKTOP_CONTROL_OPEN_DEVTOOLS: {
      CefWindowInfo window_info;
      CefBrowserSettings settings;
      host->ShowDevTools(window_info, nullptr, settings, CefPoint());
      break;
    }
    case ANT_DESKTOP_CONTROL_CLOSE_DEVTOOLS:
      host->CloseDevTools();
      HideHostApplication();
      EmitHostEvent("devtools-closed", 0, "");
      break;
    case ANT_DESKTOP_CONTROL_TOGGLE_DEVTOOLS:
      if (host->HasDevTools()) {
        host->CloseDevTools();
        HideHostApplication();
        EmitHostEvent("devtools-closed", 0, "");
      } else {
        host->ShowDevTools(CefWindowInfo(), nullptr, CefBrowserSettings(), CefPoint());
      }
      break;
    case ANT_DESKTOP_CONTROL_INSPECT_ELEMENT:
      host->ShowDevTools(CefWindowInfo(), nullptr, CefBrowserSettings(),
                         CefPoint(static_cast<int>(message.x), static_cast<int>(message.y)));
      break;
    case ANT_DESKTOP_CONTROL_RELOAD:
      browser_->Reload();
      break;
    case ANT_DESKTOP_CONTROL_IPC_RESOLVE:
    case ANT_DESKTOP_CONTROL_IPC_REJECT: {
      std::string payload(message.text, message.text_length);
      SendRendererIpc(browser_, message.type == ANT_DESKTOP_CONTROL_IPC_RESOLVE ? 0 : 1,
                      static_cast<double>(message.sequence), "", payload);
      break;
    }
    case ANT_DESKTOP_CONTROL_IPC_EVENT: {
      if (message.selection_start > message.text_length) break;
      std::string channel(message.text, message.selection_start);
      if (!capabilities_.contains("receive:" + channel)) break;
      std::string payload(message.text + message.selection_start, message.text_length - message.selection_start);
      SendRendererIpc(browser_, 2, 0, channel, payload);
      break;
    }
    default:
      break;
    }
  }

private:
  bool software_paint_reported_ = false;
  CefRefPtr<CefBrowser> browser_;
  CefRefPtr<CefBrowser> devtools_browser_;
  const std::set<std::string> capabilities_;
  TrustedKeySequences trusted_key_sequences_;
  IMPLEMENT_REFCOUNTING(HostClientImpl);
};

bool ReadFull(int fd, void *buffer, size_t size) {
  char *output = static_cast<char *>(buffer);
  size_t offset = 0;
  while (offset < size) {
    ssize_t count = read(fd, output + offset, size - offset);
    if (count == 0) return false;
    if (count < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    offset += static_cast<size_t>(count);
  }
  return true;
}

void ReadControlPipe(CefRefPtr<HostClient> client) {
  for (;;) {
    ant_desktop_control_message_t message = {};
    if (!ReadFull(STDIN_FILENO, &message, sizeof(uint32_t) * 2)) return;
    if (message.magic != ANT_DESKTOP_CONTROL_MAGIC || message.size < ANT_DESKTOP_CONTROL_HEADER_SIZE ||
        message.size > sizeof(message)) {
      fputs("invalid Ant desktop control message\n", stderr);
      return;
    }
    if (!ReadFull(STDIN_FILENO, reinterpret_cast<char *>(&message) + sizeof(uint32_t) * 2,
                  message.size - sizeof(uint32_t) * 2))
      return;
    if (message.text_length > ANT_DESKTOP_CONTROL_TEXT_CAPACITY ||
        message.size != ANT_DESKTOP_CONTROL_HEADER_SIZE + message.text_length) {
      fputs("invalid Ant desktop control payload\n", stderr);
      return;
    }
    CefPostTask(TID_UI, base::BindOnce(&HostClient::HandleControl, client, message));
  }
}

} // namespace

CefRefPtr<HostClient> CreateHostClient(const std::string &capability_manifest) {
  return new HostClientImpl(capability_manifest);
}

void StartHostControlPipe(CefRefPtr<HostClient> client) {
  std::thread(ReadControlPipe, client).detach();
}
