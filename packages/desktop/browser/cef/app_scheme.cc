#include "app_scheme.h"

#include <filesystem>
#include <system_error>

#include "include/cef_parser.h"
#include "include/cef_request.h"
#include "include/cef_stream.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_stream_resource_handler.h"

namespace {

namespace fs = std::filesystem;

bool IsWithin(const fs::path &root, const fs::path &candidate) {
  auto root_part = root.begin();
  auto candidate_part = candidate.begin();
  for (; root_part != root.end(); ++root_part, ++candidate_part) {
    if (candidate_part == candidate.end() || *root_part != *candidate_part) { return false; }
  }
  return true;
}

class AntAppSchemeFactory final : public CefSchemeHandlerFactory {
public:
  explicit AntAppSchemeFactory(std::string root) {
    std::error_code error;
    root_ = fs::weakly_canonical(fs::path(std::move(root)), error);
    if (error) root_.clear();
  }

  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                       const CefString &scheme_name, CefRefPtr<CefRequest> request) override {
    CEF_REQUIRE_IO_THREAD();
    CefURLParts parts;
    if (root_.empty() || !CefParseURL(request->GetURL(), parts) || CefString(&parts.host).ToString() != "app") {
      return nullptr;
    }

    std::string relative = CefURIDecode(CefString(&parts.path), false, UU_SPACES).ToString();
    while (!relative.empty() && relative.front() == '/')
      relative.erase(0, 1);
    if (relative.empty()) relative = "index.html";

    std::error_code error;
    fs::path file = fs::weakly_canonical(root_ / fs::path(relative), error);
    if (error || !IsWithin(root_, file) || !fs::is_regular_file(file, error)) { return nullptr; }

    CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForFile(file.string());
    if (!stream) return nullptr;
    std::string extension = file.extension().string();
    if (!extension.empty() && extension.front() == '.') extension.erase(0, 1);
    CefString mime = CefGetMimeType(extension);
    if (mime.empty()) mime = "application/octet-stream";
    return new CefStreamResourceHandler(mime, stream);
  }

private:
  fs::path root_;
  IMPLEMENT_REFCOUNTING(AntAppSchemeFactory);
};

} // namespace

bool RegisterAntAppSchemeHandler(const std::string &root) {
  return !root.empty() && CefRegisterSchemeHandlerFactory("ant", "app", new AntAppSchemeFactory(root));
}
