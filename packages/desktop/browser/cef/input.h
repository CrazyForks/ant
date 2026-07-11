#ifndef ANT_DESKTOP_CEF_INPUT_H
#define ANT_DESKTOP_CEF_INPUT_H

#include <chrono>
#include <stdint.h>
#include <unordered_map>
#include <utility>

#include "../../ipc/control.h"
#include "include/cef_browser.h"

using TrustedKeySequences = std::unordered_map<int, std::pair<uint64_t, std::chrono::steady_clock::time_point>>;

bool HandleBrowserInput(CefRefPtr<CefBrowser> browser, const ant_desktop_control_message_t &message,
                        TrustedKeySequences &trusted_key_sequences);

#endif
