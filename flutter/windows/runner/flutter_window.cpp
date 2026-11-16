#include "flutter_window.h"

#include <dwmapi.h>
#include <objbase.h>
#include <propkey.h>
#include <propvarutil.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <wrl/client.h>

#include <optional>

#include "desktop_multi_window/desktop_multi_window_plugin.h"
#include "flutter/generated_plugin_registrant.h"

#pragma comment(lib, "propsys.lib")

using Microsoft::WRL::ComPtr;

namespace {

constexpr wchar_t kAppId[] = L"org.uwuapps.cue";
constexpr int kThumbPrevious = 1001;
constexpr int kThumbPlay = 1002;
constexpr int kThumbNext = 1003;

// The window attributes for Mica, which older SDKs don't name.
constexpr DWORD kDwmUseImmersiveDarkMode = 20;
// Windows 11 22H2 and later: the system backdrop, with 2 for Mica (DWMSBT_MAINWINDOW).
constexpr DWORD kDwmSystemBackdropType = 38;
constexpr int kBackdropAuto = 0;
constexpr int kBackdropMica = 2;
// Windows 11 21H2's switch for the same, before the backdrop type existed.
constexpr DWORD kDwmMicaEffect = 1029;

// Windows' own build number, which GetVersionEx won't always tell.
DWORD WindowsBuild() {
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = ::GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return 0;
  auto get = reinterpret_cast<RtlGetVersionFn>(::GetProcAddress(ntdll, "RtlGetVersion"));
  if (!get) return 0;
  RTL_OSVERSIONINFOW info = {};
  info.dwOSVersionInfoSize = sizeof(info);
  if (get(&info) != 0) return 0;
  return info.dwBuildNumber;
}

std::wstring Widen(const std::string& s) {
  if (s.empty()) return std::wstring();
  int n = ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(n, L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), w.data(), n);
  return w;
}

std::wstring ExePath() {
  wchar_t path[MAX_PATH];
  ::GetModuleFileNameW(nullptr, path, MAX_PATH);
  return path;
}

// A white 16 px glyph for a thumbnail button, drawn in code: an arrow left or right, or for start
// and stop, the play triangle while stopped and the pause bars while playing.
HICON GlyphIcon(int kind, bool playing) {
  const int size = 16;
  BITMAPV5HEADER bi = {};
  bi.bV5Size = sizeof(bi);
  bi.bV5Width = size;
  bi.bV5Height = -size;
  bi.bV5Planes = 1;
  bi.bV5BitCount = 32;
  bi.bV5Compression = BI_BITFIELDS;
  bi.bV5RedMask = 0x00FF0000;
  bi.bV5GreenMask = 0x0000FF00;
  bi.bV5BlueMask = 0x000000FF;
  bi.bV5AlphaMask = 0xFF000000;
  void* bits = nullptr;
  HDC dc = ::GetDC(nullptr);
  HBITMAP colour = ::CreateDIBSection(dc, reinterpret_cast<BITMAPINFO*>(&bi), DIB_RGB_COLORS, &bits, nullptr, 0);
  ::ReleaseDC(nullptr, dc);
  if (!colour || !bits) return nullptr;
  auto* px = static_cast<uint32_t*>(bits);
  auto set = [&](int x, int y) {
    if (x >= 0 && x < size && y >= 0 && y < size) px[y * size + x] = 0xFFFFFFFF;
  };
  for (int i = 0; i < size * size; i++) px[i] = 0;
  if (kind == kThumbPrevious || kind == kThumbNext) {
    for (int i = 0; i < 6; i++) {
      for (int t = 0; t < 2; t++) {
        int x = (kind == kThumbNext) ? 5 + i + t : 10 - i - t;
        set(x, 2 + i);
        set(x, 13 - i);
      }
    }
  } else if (playing) {
    // Two bars.
    for (int y = 3; y <= 12; y++) {
      for (int x : {4, 5, 6, 9, 10, 11}) set(x, y);
    }
  } else {
    // A filled triangle pointing right.
    for (int x = 0; x < 9; x++) {
      for (int y = 2 + x / 2; y <= 13 - x / 2; y++) set(4 + x, y);
    }
  }
  HBITMAP mask = ::CreateBitmap(size, size, 1, 1, nullptr);
  ICONINFO info = {};
  info.fIcon = TRUE;
  info.hbmColor = colour;
  info.hbmMask = mask;
  HICON icon = ::CreateIconIndirect(&info);
  ::DeleteObject(colour);
  ::DeleteObject(mask);
  return icon;
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  // Each desktop widget is a window of its own with an engine of its own
  // (lib/desktop/widgets_window.dart): it gets the same plugins.
  DesktopMultiWindowSetWindowCreatedCallback([](void* controller) {
    auto* view_controller = reinterpret_cast<flutter::FlutterViewController*>(controller);
    RegisterPlugins(view_controller->engine());
  });

  channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(), "org.uwuapps.cue/desktop",
      &flutter::StandardMethodCodec::GetInstance());
  channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() == "setFavourites") {
      std::vector<Favourite> favourites;
      const auto* args = std::get_if<flutter::EncodableMap>(call.arguments());
      if (args) {
        auto it = args->find(flutter::EncodableValue("items"));
        if (it != args->end()) {
          if (const auto* list = std::get_if<flutter::EncodableList>(&it->second)) {
            for (const auto& item : *list) {
              const auto* m = std::get_if<flutter::EncodableMap>(&item);
              if (!m) continue;
              Favourite f;
              auto get = [&](const char* key) -> std::wstring {
                auto v = m->find(flutter::EncodableValue(key));
                if (v == m->end()) return L"";
                const auto* s = std::get_if<std::string>(&v->second);
                return s ? Widen(*s) : L"";
              };
              f.id = get("id");
              f.name = get("name");
              f.link = get("link");
              if (!f.link.empty()) favourites.push_back(f);
            }
          }
        }
      }
      SetFavourites(favourites);
      result->Success();
    } else if (call.method_name() == "setPlaying") {
      const auto* on = std::get_if<bool>(call.arguments());
      playing_ = on && *on;
      UpdateThumbButtons();
      result->Success();
    } else if (call.method_name() == "setBadge") {
      result->Success();
    } else if (call.method_name() == "setBackdrop") {
      bool on = false;
      bool dark = false;
      if (const auto* args = std::get_if<flutter::EncodableMap>(call.arguments())) {
        auto get = [&](const char* key) {
          auto v = args->find(flutter::EncodableValue(key));
          if (v == args->end()) return false;
          const auto* b = std::get_if<bool>(&v->second);
          return b && *b;
        };
        on = get("on");
        dark = get("dark");
      }
      result->Success(flutter::EncodableValue(SetBackdrop(on, dark)));
    } else {
      result->NotImplemented();
    }
  });
  taskbar_created_ = ::RegisterWindowMessageW(L"TaskbarButtonCreated");

  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  channel_ = nullptr;
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

void FlutterWindow::SetFavourites(const std::vector<Favourite>& favourites) {
  favourites_ = favourites;
  UpdateJumpList();
  UpdateThumbButtons();
}

// The Jump List (right-click the taskbar icon): one task per script, "Name", starting the
// exe with its uwu://cue/ link, which the running copy is handed (lib/desktop/desk.dart).
void FlutterWindow::UpdateJumpList() {
  ComPtr<ICustomDestinationList> list;
  if (FAILED(::CoCreateInstance(CLSID_DestinationList, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&list)))) return;
  list->SetAppID(kAppId);
  UINT max_slots = 0;
  ComPtr<IObjectArray> removed;
  if (FAILED(list->BeginList(&max_slots, IID_PPV_ARGS(&removed)))) return;
  ComPtr<IObjectCollection> tasks;
  if (FAILED(::CoCreateInstance(CLSID_EnumerableObjectCollection, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&tasks)))) {
    list->AbortList();
    return;
  }
  const std::wstring exe = ExePath();
  for (const auto& f : favourites_) {
    ComPtr<IShellLinkW> link;
    if (FAILED(::CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link)))) continue;
    link->SetPath(exe.c_str());
    link->SetArguments((L"\"" + f.link + L"\"").c_str());
    link->SetIconLocation(exe.c_str(), 0);
    link->SetDescription(f.name.c_str());
    ComPtr<IPropertyStore> props;
    if (SUCCEEDED(link.As(&props))) {
      PROPVARIANT title;
      if (SUCCEEDED(::InitPropVariantFromString(f.name.c_str(), &title))) {
        props->SetValue(PKEY_Title, title);
        props->Commit();
        ::PropVariantClear(&title);
      }
    }
    tasks->AddObject(link.Get());
  }
  ComPtr<IObjectArray> array;
  if (!favourites_.empty() && SUCCEEDED(tasks.As(&array))) list->AddUserTasks(array.Get());
  list->CommitList();
}

// The taskbar's thumbnail buttons (hover the taskbar icon): the previous script, start and stop,
// and the next script. All three work the prompter without bringing the window forward; previous
// and next are left out with fewer than two scripts, as there's nothing to switch to.
void FlutterWindow::UpdateThumbButtons() {
  ComPtr<ITaskbarList3> taskbar;
  if (FAILED(::CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&taskbar)))) return;
  if (FAILED(taskbar->HrInit())) return;
  THUMBBUTTON buttons[3] = {};
  const int ids[3] = {kThumbPrevious, kThumbPlay, kThumbNext};
  const wchar_t* tips[3] = {L"Previous script", playing_ ? L"Stop" : L"Start", L"Next script"};
  const bool few = favourites_.size() < 2;
  for (int i = 0; i < 3; i++) {
    buttons[i].dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
    buttons[i].iId = ids[i];
    buttons[i].hIcon = GlyphIcon(ids[i], playing_);
    wcsncpy_s(buttons[i].szTip, tips[i], _TRUNCATE);
    buttons[i].dwFlags = (few && ids[i] != kThumbPlay) ? THBF_HIDDEN : THBF_ENABLED;
  }
  HWND hwnd = GetHandle();
  if (!thumbs_added_) {
    if (SUCCEEDED(taskbar->ThumbBarAddButtons(hwnd, 3, buttons))) thumbs_added_ = true;
  } else {
    taskbar->ThumbBarUpdateButtons(hwnd, 3, buttons);
  }
  for (auto& b : buttons) {
    if (b.hIcon) ::DestroyIcon(b.hIcon);
  }
}

// Mica behind the app, for the glass look: the frame stretched over the whole window so the
// backdrop shows wherever the app draws nothing, Mica as the backdrop, and the window light or
// dark with the app (Mica takes its tint from that). Windows 10 has no Mica: "none", and the app
// draws its own frost. Off, the frame goes back to nothing and the backdrop to the system's
// choice; the app then asks window_manager for its hidden title bar's frame again.
std::string FlutterWindow::SetBackdrop(bool on, bool dark) {
  HWND hwnd = GetHandle();
  if (!hwnd) return "none";
  // Never on: nothing to undo, and window_manager's frame stays as it drew it.
  if (!on && !backdrop_on_) return "none";
  const DWORD build = WindowsBuild();
  const bool has_mica = build >= 22000;
  backdrop_on_ = on && has_mica;
  backdrop_dark_ = dark;
  // With the frame over the whole window, DWM would draw its own caption buttons over the app's
  // (lib/desktop/chrome.dart): without the system menu style it draws none.
  if (has_mica) {
    LONG style = ::GetWindowLongW(hwnd, GWL_STYLE);
    LONG want = backdrop_on_ ? (style & ~WS_SYSMENU) : (style | WS_SYSMENU);
    if (want != style) {
      ::SetWindowLongW(hwnd, GWL_STYLE, want);
      ::SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
  }
  if (on) {
    BOOL d = dark ? TRUE : FALSE;
    ::DwmSetWindowAttribute(hwnd, kDwmUseImmersiveDarkMode, &d, sizeof(d));
  }
  if (!has_mica) return "none";
  MARGINS margins = {0, 0, 0, 0};
  if (backdrop_on_) margins = {-1, -1, -1, -1};
  ::DwmExtendFrameIntoClientArea(hwnd, &margins);
  HRESULT hr;
  if (build >= 22621) {
    int type = backdrop_on_ ? kBackdropMica : kBackdropAuto;
    hr = ::DwmSetWindowAttribute(hwnd, kDwmSystemBackdropType, &type, sizeof(type));
  } else {
    BOOL mica = backdrop_on_ ? TRUE : FALSE;
    hr = ::DwmSetWindowAttribute(hwnd, kDwmMicaEffect, &mica, sizeof(mica));
  }
  if (!on) {
    // The frame light or dark with Windows again, as Win32Window keeps it.
    DWORD light = 1;
    DWORD size = sizeof(light);
    if (::RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                       L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size) == ERROR_SUCCESS) {
      BOOL d = light == 0 ? TRUE : FALSE;
      ::DwmSetWindowAttribute(hwnd, kDwmUseImmersiveDarkMode, &d, sizeof(d));
    }
    return "none";
  }
  if (FAILED(hr)) {
    margins = {0, 0, 0, 0};
    ::DwmExtendFrameIntoClientArea(hwnd, &margins);
    ::SetWindowLongW(hwnd, GWL_STYLE, ::GetWindowLongW(hwnd, GWL_STYLE) | WS_SYSMENU);
    backdrop_on_ = false;
    return "none";
  }
  return "blurred";
}

// The app does each: start and stop, or the script before or after the open one in its list
// (lib/desktop/desktop_main.dart), so they follow whatever's open rather than a count kept here.
void FlutterWindow::OnThumb(int button) {
  if (!channel_) return;
  const char* what = button == kThumbPrevious ? "previous" : button == kThumbNext ? "next" : "toggle";
  channel_->InvokeMethod("thumb", std::make_unique<flutter::EncodableValue>(std::string(what)));
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  // Explorer restarted, or the taskbar button just appeared: the buttons go on again.
  if (taskbar_created_ != 0 && message == taskbar_created_) {
    thumbs_added_ = false;
    if (!favourites_.empty()) UpdateThumbButtons();
  }

  // Windows' own light or dark changed: the window keeps the app's while Mica is on.
  if (message == WM_DWMCOLORIZATIONCOLORCHANGED && backdrop_on_) {
    LRESULT r = Win32Window::MessageHandler(hwnd, message, wparam, lparam);
    BOOL d = backdrop_dark_ ? TRUE : FALSE;
    ::DwmSetWindowAttribute(hwnd, kDwmUseImmersiveDarkMode, &d, sizeof(d));
    return r;
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
    case WM_COMMAND:
      if (HIWORD(wparam) == THBN_CLICKED) {
        OnThumb(LOWORD(wparam));
        return 0;
      }
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
