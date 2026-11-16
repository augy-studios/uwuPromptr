#ifndef RUNNER_FLUTTER_WINDOW_H_
#define RUNNER_FLUTTER_WINDOW_H_

#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>

#include <memory>
#include <string>
#include <vector>

#include "win32_window.h"

// The main window, hosting the Flutter view, and the app's own channel to Windows
// (org.uwuapps.cue/desktop, lib/desktop/runner.dart): the Jump List and the taskbar's thumbnail
// buttons for the scripts, and Mica behind the app for the glass look (lib/desktop/backdrop.dart).
class FlutterWindow : public Win32Window {
 public:
  explicit FlutterWindow(const flutter::DartProject& project);
  virtual ~FlutterWindow();

 protected:
  bool OnCreate() override;
  void OnDestroy() override;
  LRESULT MessageHandler(HWND window, UINT const message, WPARAM const wparam,
                         LPARAM const lparam) noexcept override;

 private:
  struct Favourite {
    std::wstring id;
    std::wstring name;
    std::wstring link;
  };

  void SetFavourites(const std::vector<Favourite>& favourites);
  void UpdateJumpList();
  void UpdateThumbButtons();
  void OnThumb(int button);
  // Mica behind the app, or not, light or dark: "blurred" when Windows gave it, else "none".
  std::string SetBackdrop(bool on, bool dark);

  flutter::DartProject project_;
  std::unique_ptr<flutter::FlutterViewController> flutter_controller_;
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;

  std::vector<Favourite> favourites_;
  // Whether the prompter is playing: the middle thumbnail button shows pause, or play.
  bool playing_ = false;
  bool thumbs_added_ = false;
  UINT taskbar_created_ = 0;
  bool backdrop_on_ = false;
  bool backdrop_dark_ = false;
};

#endif  // RUNNER_FLUTTER_WINDOW_H_
