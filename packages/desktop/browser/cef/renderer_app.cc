#include "renderer_app.h"

#include <map>
#include <stdio.h>
#include <string>

#include "../../ipc/capabilities.h"
#include "app_scheme.h"
#include "include/cef_command_line.h"
#include "include/cef_process_message.h"
#include "include/cef_render_process_handler.h"
#include "include/cef_v8.h"
#include "renderer_bridge.h"

namespace {

class IpcV8Handler : public CefV8Handler {
public:
  explicit IpcV8Handler(std::set<std::string> capabilities) : capabilities_(std::move(capabilities)) {}

  bool Execute(const CefString &name, CefRefPtr<CefV8Value> object, const CefV8ValueList &arguments,
               CefRefPtr<CefV8Value> &retval, CefString &exception) override {
    if (name != "antNativeIpc" || arguments.size() != 4 || !arguments[0]->IsInt() ||
        !(arguments[1]->IsDouble() || arguments[1]->IsInt() || arguments[1]->IsUInt()) || !arguments[2]->IsString() ||
        !arguments[3]->IsString()) {
      exception = "invalid Ant IPC call";
      return true;
    }
    int operation = arguments[0]->GetIntValue();
    std::string access = operation == 0 ? "send" : "invoke";
    std::string channel = arguments[2]->GetStringValue();
    if (!capabilities_.contains(access + ":" + channel)) {
      exception = "Ant IPC channel is not granted: " + access + ":" + channel;
      return true;
    }
    CefRefPtr<CefV8Context> context = CefV8Context::GetCurrentContext();
    if (!context || !context->GetFrame()) {
      exception = "Ant IPC context is unavailable";
      return true;
    }
    CefRefPtr<CefProcessMessage> message = CefProcessMessage::Create("ant.ipc");
    CefRefPtr<CefListValue> values = message->GetArgumentList();
    values->SetInt(0, operation);
    values->SetDouble(1, arguments[1]->GetDoubleValue());
    values->SetString(2, channel);
    values->SetString(3, arguments[3]->GetStringValue());
    context->GetFrame()->SendProcessMessage(PID_BROWSER, message);
    retval = CefV8Value::CreateBool(true);
    return true;
  }

private:
  const std::set<std::string> capabilities_;
  IMPLEMENT_REFCOUNTING(IpcV8Handler);
};

class RendererApp : public CefApp, public CefRenderProcessHandler {
public:
  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override {
    RegisterAntCustomSchemes(registrar);
  }

  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override {
    return this;
  }

  void OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefV8Context> context) override {
    if (!frame->IsMain()) return;
    if (!capabilities_loaded_) {
      CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
      if (command_line) {
        manifest_ = command_line->GetSwitchValue("ant-capabilities");
        capabilities_ = ant::desktop::ParseCapabilities(manifest_);
      }
      capabilities_loaded_ = true;
    }
    std::string source(reinterpret_cast<const char *>(ant_desktop_ipc_bridge_source),
                       ant_desktop_ipc_bridge_source_len);
    CefRefPtr<CefV8Value> factory;
    CefRefPtr<CefV8Exception> exception;
    context->Eval(source, "ant://preload/ipc.js", 1, factory, exception);
    if (exception) {
      fprintf(stderr, "Ant IPC preload failed: %s\n", exception->GetMessage().ToString().c_str());
      return;
    }
    CefRefPtr<CefV8Value> bindings = CefV8Value::CreateObject(nullptr, nullptr);
    bindings->SetValue("capabilityManifest", CefV8Value::CreateString(manifest_), V8_PROPERTY_ATTRIBUTE_READONLY);
    bindings->SetValue("nativeIpc", CefV8Value::CreateFunction("antNativeIpc", new IpcV8Handler(capabilities_)),
                       V8_PROPERTY_ATTRIBUTE_READONLY);
    CefV8ValueList arguments{bindings};
    CefRefPtr<CefV8Value> bridge = factory->ExecuteFunction(nullptr, arguments);
    if (!bridge || !bridge->IsObject()) {
      fputs("Ant IPC preload did not return a bridge\n", stderr);
      return;
    }
    receivers_[browser->GetIdentifier()] = bridge->GetValue("receive");
  }

  void OnContextReleased(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                         CefRefPtr<CefV8Context> context) override {
    if (frame->IsMain()) receivers_.erase(browser->GetIdentifier());
  }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    if (source_process != PID_BROWSER || !frame->IsMain()) return false;
    if (message->GetName() != "ant.ipc.reply" && message->GetName() != "ant.ipc.event") { return false; }
    CefRefPtr<CefV8Context> context = frame->GetV8Context();
    if (!context || !context->Enter()) return true;
    auto receiver_entry = receivers_.find(browser->GetIdentifier());
    CefRefPtr<CefV8Value> receiver = receiver_entry == receivers_.end() ? nullptr : receiver_entry->second;
    if (receiver && receiver->IsFunction()) {
      CefRefPtr<CefListValue> values = message->GetArgumentList();
      CefV8ValueList args;
      args.push_back(CefV8Value::CreateInt(values->GetInt(0)));
      args.push_back(CefV8Value::CreateDouble(values->GetDouble(1)));
      args.push_back(CefV8Value::CreateString(values->GetString(2)));
      args.push_back(CefV8Value::CreateString(values->GetString(3)));
      receiver->ExecuteFunction(context->GetGlobal(), args);
    }
    context->Exit();
    return true;
  }

private:
  std::string manifest_;
  std::set<std::string> capabilities_;
  std::map<int, CefRefPtr<CefV8Value>> receivers_;
  bool capabilities_loaded_ = false;
  IMPLEMENT_REFCOUNTING(RendererApp);
};

} // namespace

CefRefPtr<CefApp> CreateAntRendererApp() {
  return new RendererApp;
}
