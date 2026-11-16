// The runner's own channel (docs/flutter-desktop-app-spec.md §2.7), for what no package does:
//   Windows  the Jump List (the scripts) and the taskbar's thumbnail buttons (previous script,
//            start and stop, next script) (windows/runner/flutter_window.cpp)
//   macOS    the Dock menu and badge (macos/Runner/AppDelegate.swift)
//   all      the window's own glass behind the app, for the glass look (backdrop.dart): Mica on
//            Windows 11, a vibrancy view on macOS, a see-through window and the compositor's
//            blur on Linux (linux/runner/my_application.cc)
// Events back: 'thumb' with 'toggle', 'previous' or 'next', 'dock' with a script id, 'open' with a
// link and 'activate' (macOS). What a runner doesn't do is quietly nothing.
import 'package:flutter/services.dart';

import '../theme/theme.dart';

class Runner {
  Runner._();

  static const _channel = MethodChannel('org.uwuapps.cue/desktop');

  /// Set by desktop_main.dart.
  static void Function(String id)? onThumb;
  static void Function(String scriptId)? onDock;

  /// A link opened from elsewhere (macOS), or a click on the Dock icon (`null`).
  static void Function(String? link)? onOpen;

  static void listen() {
    _channel.setMethodCallHandler((call) async {
      final args = call.arguments;
      switch (call.method) {
        case 'thumb':
          onThumb?.call('$args');
        case 'dock':
          onDock?.call('$args');
        case 'open':
          onOpen?.call(args is String ? args : null);
        case 'activate':
          onOpen?.call(null);
      }
      return null;
    });
  }

  static Future<void> _call(String method, [Object? args]) async {
    try {
      await _channel.invokeMethod(method, args);
    } catch (_) {
      // Not on this system.
    }
  }

  /// The scripts, [{ code, name }], for the Jump List, thumbnail buttons and Dock menu.
  static Future<void> setFavourites(List<Map<String, Object?>> favs) => _call('setFavourites', {
    'items': [
      for (final f in favs) {'id': '${f['code']}', 'name': '${f['name']}', 'link': 'uwu://cue/s/${f['code']}'},
    ],
  });

  /// Whether the prompter is playing, for the taskbar's start and stop button (Windows).
  static Future<void> setPlaying(bool on) => _call('setPlaying', on);

  /// The Dock's badge (macOS): a few characters, or '' for none.
  static Future<void> setBadge(String text) => _call('setBadge', text);

  /// The window's own glass behind the app, on or off, light or dark: what the system gave
  /// ('blurred', 'clear' or 'none'), and nothing where the runner can't.
  static Future<Backdrop> setBackdrop({required bool on, required bool dark}) async {
    try {
      final r = await _channel.invokeMethod<String>('setBackdrop', {'on': on, 'dark': dark});
      return Backdrop.values.firstWhere((b) => b.name == r, orElse: () => Backdrop.none);
    } catch (_) {
      return Backdrop.none;
    }
  }
}
