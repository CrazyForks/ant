#ifndef ANT_DESKTOP_CEF_HOST_CLIENT_H
#define ANT_DESKTOP_CEF_HOST_CLIENT_H

#include <string>

#include "../../ipc/control.h"
#include "include/cef_client.h"

class HostClient : public CefClient {
public:
  virtual void HandleControl(ant_desktop_control_message_t message) = 0;
};

CefRefPtr<HostClient> CreateHostClient(const std::string &capability_manifest);
void StartHostControlPipe(CefRefPtr<HostClient> client);

#endif
