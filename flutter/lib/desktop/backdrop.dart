// The window behind the glass look (lib/theme/theme.dart): the system's own glass, so the app's
// see-through page shows the desktop blurred behind it, as the system's own apps do.
//
//   Windows  Mica (Windows 11; on 21H2 by its older switch). Windows 10 has none: the app draws
//            its own frost.
//   macOS    a vibrancy view behind the app (NSVisualEffectView), light or dark with the app.
//   Linux    a see-through window where the desktop composites, and the compositor's blur where
//            it offers one to apps (KWin's, which Deepin's window manager is built on). Elsewhere
//            (most Wayland desktops, COSMIC included) see-through only, frosted more heavily by
//            the app.
//
// The runner says what it managed (Runner.setBackdrop), and the theme thickens the page to suit
// (ThemeController.backdrop). Only the main window: the mini remotes keep their own look.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../theme/theme.dart';
import 'desk.dart';
import 'runner.dart';

class WindowBackdrop {
  WindowBackdrop._();

  static String? _applied;
  static Future<void> _queue = Future.value();

  static void start() {
    ThemeController.I.addListener(_sync);
    // Full screen and the title bar's style can reset what the window was given: again after each.
    Desktop.fullScreen.addListener(_again);
    Desktop.onShown.add(_again);
    _sync();
  }

  static void _again() {
    _applied = null;
    _sync();
  }

  static void _sync() {
    final t = ThemeController.I;
    final on = t.isGlass;
    final dark = t.brightness == Brightness.dark;
    final want = '$on/$dark';
    if (want == _applied) return;
    final wasOn = _applied?.startsWith('true') ?? false;
    _applied = want;
    // Off and never on: nothing to undo, and the window stays as window_manager made it.
    if (!on && !wasOn) {
      t.setBackdrop(Backdrop.none);
      return;
    }
    _queue = _queue.then((_) async {
      final got = await Runner.setBackdrop(on: on, dark: dark);
      // Turning Mica off gives back the frame window_manager drew for the hidden title bar.
      if (!on && wasOn && Platform.isWindows) {
        try {
          await windowManager.setTitleBarStyle(TitleBarStyle.hidden, windowButtonVisibility: true);
        } catch (_) {}
      }
      t.setBackdrop(on ? got : Backdrop.none);
    });
  }
}
